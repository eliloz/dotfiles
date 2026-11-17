/**
 * /lab and the `lab` tool: grow and test agents, and run checks, in a private Herdr Lab window.
 * Modelled on herdr-pi-lab (0.5.0).
 *
 * Starting and stopping labs goes through cli.mjs (also the `lab` shell command), so Pi and a shell run the
 * same code. Following a run (widget, result message, `wait`) reads the lab's own files through core.mjs.
 *
 *   /lab new <Agent> [job]   sends new-agent.md into this conversation: interview, expectations (your OK),
 *                            agent.md, then the lab through the `lab` tool
 *   /lab test <Agent>        returns at once; a checklist widget follows the run and the result arrives
 *                            as a message here. The lab stays open; /lab stop closes it
 *   /lab report <Agent>      the latest report
 *   /lab test FILE [N]       a check from lab-scenarios.md (unchanged)
 */
import { type ChildProcess, spawn } from "node:child_process";
import { realpathSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Markdown, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getMarkdownTheme, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
// @ts-ignore: plain ESM shared with the `lab` shell command
import { ARG_HINT, completions, help } from "./help.mjs";
// @ts-ignore
import * as core from "./core.mjs";
// @ts-ignore
import { FORMAT, NAME, testTarget } from "./expectations.mjs";
// @ts-ignore
import { headline } from "./report.mjs";
// @ts-ignore
import { latestReport, newAgentBrief, projectAgents, reportExcerpt } from "./agents.mjs";

const CLI = path.join(path.dirname(realpathSync(fileURLToPath(import.meta.url))), "cli.mjs");
const MSG = "lab-result";
const NEW = "lab-new";
const WIDGET = "lab";
const MARK: Record<string, string> = { pass: "✓", fail: "✗", running: "◐", pending: "○" };
const VALUE_FLAGS = new Set(["--model", "--agent-model", "--tester-model", "--seconds", "--run"]);

/** Shell-like split: "quoted words" stay one argument. */
export function tokenize(s: string): string[] {
	const out: string[] = [];
	const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? m[3]));
	return out;
}
/** The words of `test …` that are not options or option values. */
const positionals = (args: string[]) => args.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1]));
const isFileIn = (cwd: string) => (f: string) => { try { return statSync(path.resolve(cwd, f)).isFile(); } catch { return false; } };

/** Runs cli.mjs. Every "· progress" line on stderr goes to onLine. */
function runCli(args: string[], cwd: string, onLine: (l: string) => void, onSpawn?: (c: ChildProcess) => void): Promise<{ code: number; out: string; err: string }> {
	return new Promise((resolve) => {
		const child = spawn("node", [CLI, ...args], { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
		onSpawn?.(child);
		let out = "";
		let err = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => {
			err += d;
			for (const l of String(d).split("\n")) if (l.startsWith("· ")) onLine(l.slice(2).trim());
		});
		child.on("error", (e) => resolve({ code: 2, out, err: `${err}${e.message}` }));
		child.on("exit", (code) => resolve({ code: code ?? 2, out, err }));
	});
}

/** stdout plus any stderr that is not a "· progress" line. */
const resultText = ({ out, err }: { out: string; err: string }) => {
	const problems = err.trim().split("\n").filter((l) => l && !l.startsWith("· ")).join("\n");
	return [out.trim(), problems].filter(Boolean).join("\n");
};
const runIdOf = (line: string) => /^run (lab-[0-9a-f]{6})$/.exec(line)?.[1];

/** The finished run as Markdown: headline, one line per expectation, the report path. */
function resultMessage(project: string, r: any, s: any) {
	return [`**Lab · ${r.agent}: ${headline(s)}**`, "",
		...s.items.map((i: any) => `${MARK[i.verdict] ?? "○"} ${i.id} · ${i.title}${i.verdict === "fail" && i.reason ? ` — ${i.reason}` : ""}`), "",
		`Report: \`${path.relative(project, s.report)}\``, "The lab is still open for you to look. `/lab stop` closes it."].join("\n");
}

export default function (pi: ExtensionAPI) {
	let ui: ExtensionContext | undefined;
	let starting = false;
	const children = new Set<ChildProcess>();
	const watching = new Map<string, ReturnType<typeof setInterval>>();
	let clearLater: ReturnType<typeof setTimeout> | undefined;
	const track = (c: ChildProcess) => { children.add(c); c.on("exit", () => children.delete(c)); };

	pi.on("session_start", (_e, ctx) => { ui = ctx; });
	// Quitting Pi while a lab opens: SIGTERM makes cli.mjs stop the lab it started. An open lab stays open.
	// The ctx goes stale after this, so every timer that would touch the UI stops here.
	pi.on("session_shutdown", () => {
		for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
		for (const t of watching.values()) clearInterval(t);
		watching.clear();
		clearTimeout(clearLater);
		ui = undefined;
	});

	pi.registerMessageRenderer(MSG, (msg: any, opts: any) => {
		const md = new Markdown(String(msg.content), opts.outputPad ?? 1, 0, getMarkdownTheme());
		return { invalidate() { md.invalidate(); }, render(w: number) { return md.render(w); } };
	});
	// /lab new: one line, the full brief on expand (ctrl+o).
	pi.registerMessageRenderer(NEW, (msg: any, opts: any, theme: any) => {
		const pad = opts.outputPad ?? 1, d = msg.details || {};
		const head = theme.fg("accent", theme.bold(`Lab · grow ${d.name}`)) + theme.fg("dim", d.kept ? "  ·  expectations kept as they are" : "");
		if (opts.expanded) {
			const md = new Markdown(String(msg.content), pad, 0, getMarkdownTheme());
			return { invalidate() { md.invalidate(); }, render(w: number) { return [truncateToWidth(" ".repeat(pad) + head, w), ...md.render(w)]; } };
		}
		return { invalidate() {}, render(width: number) {
			const job = d.job ? wrapTextWithAnsi(theme.fg("muted", `“${d.job}”`), Math.max(1, width - pad * 2)) : [];
			const steps = theme.fg("dim", (d.kept ? "" : "interview → expectations (your OK) → ") + "agent.md → lab → report   (ctrl+o: full brief)");
			return [head, ...job, steps].map((l: string) => truncateToWidth(" ".repeat(pad) + l, width));
		} };
	});

	const busy = () => { try { return ui?.isIdle() === false; } catch { return false; } };
	const say = (text: string) => pi.sendMessage({ customType: MSG, content: text, display: true }, busy() ? { deliverAs: "followUp" } : undefined);
	const setWidget = (lines?: string[]) => { try { if (ui?.hasUI) ui.ui.setWidget(WIDGET, lines); } catch {} };

	/**
	 * Follow an agent lab: the checklist in a widget; when the Tester has written its report, the result as a
	 * message (only for runs started with /lab test: a run the model started is reported through `wait`).
	 */
	function watch(id: string, project: string, announce: boolean, step = () => "") {
		if (watching.has(id)) return;
		const tick = () => {
			const r = core.readRun(id), s = core.readResults(id);
			if (!r || r.phase === "failed") { clearInterval(t); watching.delete(id); setWidget(undefined); return; }
			const c = core.tally(s);
			const head = s?.report ? `Lab · ${r.agent} · ${headline(s)}` : r.phase === "testing" ? `Lab · ${r.agent} · Tester checking ${c.pass + c.fail}/${c.total}` : `Lab · ${r.agent} · ${step() || r.phase}`;
			setWidget([head, ...(s?.items || []).map((i: any) => `  ${MARK[i.verdict || (i.running ? "running" : "pending")]} ${i.id} · ${i.title}`)]);
			if (s?.report) {
				clearInterval(t); watching.delete(id);
				if (announce) say(resultMessage(project, r, s));
				clearTimeout(clearLater);
				clearLater = setTimeout(() => { if (!watching.size) setWidget(undefined); }, 15000);
			}
		};
		const t = setInterval(tick, 1500);
		watching.set(id, t);
		tick();
	}

	/** cli.mjs `test <Agent>`: opens the lab up to the Tester and exits. Pi passes this conversation's model unless LAB_MODEL or --model says otherwise. */
	function agentArgs(name: string, flags: string[], ctx: ExtensionContext) {
		const argv = ["test", name, ...flags];
		if (!argv.includes("--model") && !process.env.LAB_MODEL && ctx.model) argv.push("--model", `${ctx.model.provider}/${ctx.model.id}`);
		return argv;
	}

	async function startAgent(argv: string[], ctx: ExtensionContext, announce: boolean, onLine: (l: string) => void = () => {}, onSpawn?: (c: ChildProcess) => void) {
		let id: string | undefined, last = "";
		const r = await runCli(argv, ctx.cwd, (l) => {
			const hit = runIdOf(l);
			if (hit) { id = hit; watch(hit, ctx.cwd, announce, () => last); } else last = l;
			onLine(l);
		}, (c) => { track(c); onSpawn?.(c); });
		return { id, code: r.code, text: resultText(r) };
	}

	pi.registerCommand("lab", {
		// pi 1.5.2 drops argumentHint for extension commands, so the hint leads the description.
		description: `${ARG_HINT}  Herdr Lab: grow and test agents in a private window`,
		getArgumentCompletions: (prefix: string) => completions(prefix, () => (ui ? projectAgents(ui.cwd) : [])),
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			ui = ctx;
			const argv = tokenize(args.trim());
			const cmd = argv[0];
			try {
				if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") return ctx.ui.notify(help("/lab"), "info");

				if (cmd === "new") {
					const name = argv[1];
					if (!name || !NAME.test(name)) throw Error("Name the agent in one word, e.g. /lab new Critic [what it should do]");
					if (!ctx.isIdle()) throw Error("Wait for this turn to finish, then run /lab new again.");
					const jobText = argv.slice(2).join(" ") || undefined;
					const kept = projectAgents(ctx.cwd).some((a: string) => a.toLowerCase() === name.toLowerCase());
					const Name = name.charAt(0).toUpperCase() + name.slice(1);
					pi.sendMessage({ customType: NEW, content: newAgentBrief(ctx.cwd, name, jobText), display: true, details: { name: Name, job: jobText, kept } }, { triggerTurn: true });
					return;
				}

				if (cmd === "report") {
					const name = argv[1];
					if (!name) throw Error("Which agent? e.g. /lab report Critic");
					const f = latestReport(ctx.cwd, name);
					if (!f) return ctx.ui.notify(`No reports for ${name} yet. Run /lab test ${name}.`, "warning");
					say(`${reportExcerpt(readFileSync(f, "utf8"))}\n\nFull report: \`${path.relative(ctx.cwd, f)}\``);
					return;
				}

				if (cmd === "list") {
					const agents = projectAgents(ctx.cwd);
					const labs = core.list().map((l: any) => {
						const r = core.readRun(l.id) || {}, s = core.readResults(l.id);
						const what = r.kind === "agent" ? `${r.agent}: ${s?.report ? headline(s) : l.phase}` : l.phase;
						return `${l.id}  ${l.core === "running" ? "open" : "stopped"}  ${what}  ${l.project ?? ""}`;
					});
					return ctx.ui.notify([`Agents with expectations here: ${agents.join(", ") || "none yet (try /lab new Critic)"}`,
						labs.length ? "Labs on this computer:" : "No labs on this computer.", ...labs].join("\n"), "info");
				}

				if (cmd === "test" || cmd === "run" || cmd === "start") {
					if (starting) return ctx.ui.notify("A lab from this conversation is still opening; wait, or /lab stop", "warning");
					const target = cmd === "start" ? undefined : testTarget(positionals(argv.slice(1)), isFileIn(ctx.cwd));
					starting = true;
					if (target?.kind === "agent") {
						// Returns once the Tester is running; the widget follows the run and the result arrives as a message.
						ctx.ui.notify(`Opening a lab for ${target.name}. The widget follows it; the result arrives here.`, "info");
						startAgent(agentArgs(target.name, argv.slice(2), ctx), ctx, true)
							.then(({ id, code, text }) => {
								if (code !== 0) { setWidget(undefined); ctx.ui.notify(text || `lab exited ${code}`, "error"); }
								else if (!id) ctx.ui.notify(text, "info");
							})
							.finally(() => { starting = false; });
						return;
					}
					ctx.ui.notify("Lab starting. Progress shows in the status bar; the result arrives here.", "info");
					runCli(argv, ctx.cwd, (l) => ctx.ui.setStatus("lab", `lab · ${l}`), track)
						.then((r) => ctx.ui.notify(resultText(r) || `lab exited ${r.code}`, r.code === 2 ? "error" : r.code === 1 ? "warning" : "info"))
						.finally(() => { starting = false; ctx.ui.setStatus("lab", undefined); });
					return;
				}

				if (!["doctor", "stop", "leftovers", "agents"].includes(cmd)) throw Error(`Unknown command "${cmd}". Run /lab --help`);
				const r = await runCli(argv, ctx.cwd, () => {});
				if (cmd === "stop") { for (const t of watching.values()) clearInterval(t); watching.clear(); setWidget(undefined); }
				ctx.ui.notify(resultText(r), r.code === 0 ? "info" : "error");
			} catch (e: any) {
				ctx.ui.notify(e.message, "error");
			}
		},
	});

	const text = (t: string, summary?: string) => ({ content: [{ type: "text" as const, text: t }], details: { summary } });
	const json = (v: unknown, summary?: string) => text(JSON.stringify(v, null, 2), summary);
	const needRun = (run?: string) => { if (!run || !core.ID_RE.test(run)) throw Error("Give run: the lab-xxxxxx ID that test returned."); return run; };

	pi.registerTool({
		name: "lab",
		label: "Herdr Lab",
		description:
			'Black-box test an agent, or run a check, in a private Herdr Lab window with a copy of this project. ' +
			'Agents: test {agent, model?, agentModel?, testerModel?, behind?} opens the lab (guest Main, the agent via /agent with only its Job, a black-box Tester) and returns a run ID once the Tester runs; a start is not a result: then call wait {run, seconds?} (default 600) until it returns finished, with every verdict and its screen quotes and the report path. status {run}; report {agent} (latest report); agents (agents here with expectations). Expectations live in agents/<agent>/expectations.md (format in help). ' +
			'Checks: when asked to "use the lab" to run a check, call check {file?, check?, say?, behind?, model?}: from lab-scenarios.md (check: a number, "first", or words such as "/split"; none runs them all) or in plain words (say); it waits and returns every step as "I tried X, expected Y, got Z" with ✓ or ✗ and a quote, then closes the lab. ' +
			"Report results to the person as they came back; never restate a failure as a pass. Other actions: help; doctor; list (labs on this computer); stop {run?} (default the latest).",
		parameters: Type.Object({
			action: Type.Union(["test", "wait", "status", "report", "agents", "check", "doctor", "list", "stop", "help"].map((v) => Type.Literal(v))),
			agent: Type.Optional(Type.String({ description: "For test and report: the agent's name, as in agents/<name>/." })),
			run: Type.Optional(Type.String({ description: "For wait, status and stop: the lab ID (lab-xxxxxx); stop also takes all." })),
			seconds: Type.Optional(Type.Integer({ minimum: 5, maximum: 1800, description: "For wait: how long to wait before returning (default 600)." })),
			model: Type.Optional(Type.String({ description: "provider/id for guest Main, the Tester and a check's lab agent. Default: LAB_MODEL, else this conversation's model." })),
			agentModel: Type.Optional(Type.String({ description: "For test: the agent's model. Default: fast." })),
			testerModel: Type.Optional(Type.String({ description: "For test: the Tester's model. Default: model." })),
			behind: Type.Optional(Type.Boolean({ description: "Open the lab window behind the person's windows." })),
			file: Type.Optional(Type.String({ description: "For check: the scenarios file; default lab-scenarios.md." })),
			check: Type.Optional(Type.String({ description: 'For check: a number, "first", or words from it such as "/split". None runs them all.' })),
			say: Type.Optional(Type.String({ description: "For check: the steps in plain words, instead of a file." })),
		}),
		async execute(_id, p, signal, onUpdate, ctx) {
			ui = ctx;
			switch (p.action) {
				case "help": return text(`${help("/lab")}\n\nExpectations format:\n${FORMAT}`);
				case "agents": return json({ agents: projectAgents(ctx.cwd) });
				case "report": {
					if (!p.agent) throw Error("report needs agent.");
					const f = latestReport(ctx.cwd, p.agent);
					return text(f ? `${readFileSync(f, "utf8")}\n\n(${path.relative(ctx.cwd, f)})` : `No reports for ${p.agent} yet.`);
				}
				case "test": {
					if (!p.agent) throw Error("test needs agent.");
					const flags = [...(p.model ? ["--model", p.model] : []), ...(p.agentModel ? ["--agent-model", p.agentModel] : []),
						...(p.testerModel ? ["--tester-model", p.testerModel] : []), ...(p.behind ? ["--behind"] : [])];
					let child: ChildProcess | undefined;
					const abort = () => child?.kill("SIGTERM"); // cli.mjs stops the lab it was opening
					signal?.addEventListener("abort", abort, { once: true });
					try {
						const { id, code, text: t } = await startAgent(agentArgs(p.agent, flags, ctx), ctx, false, (l) => onUpdate?.(text(`lab · ${l}`)), (c) => { child = c; });
						if (code !== 0 || !id) throw Error(t || `lab exited ${code}`);
						return json({ started: true, run: id, agent: core.readRun(id)?.agent, next: `wait {"run":"${id}"}` }, `Lab ${id} open; the Tester is running`);
					} finally { signal?.removeEventListener("abort", abort); }
				}
				case "status": {
					const run = needRun(p.run), r = core.readRun(run);
					if (!r) throw Error(`No lab ${run}.`);
					return json({ run: r, results: core.readResults(run), core: core.coreUp(run) ? "running" : "stopped" });
				}
				case "wait": {
					const run = needRun(p.run), end = Date.now() + (p.seconds || 600) * 1000;
					while (!signal?.aborted) {
						const r = core.readRun(run), s = core.readResults(run);
						if (!r) return json({ finished: false, stopped: true, note: `${run} was stopped; there is no result.` });
						if (r.phase === "failed") return json({ finished: false, failed: r.error });
						if (s?.report) {
							return json({ finished: true, result: s.result, headline: headline(s), summary: s.summary, report: s.report,
								items: s.items.map((i: any) => ({ id: i.id, title: i.title, verdict: i.verdict, reason: i.reason, evidence: i.evidence, absent: i.absent, observed: i.observed, tester: i.tester })) },
								[`${s.result === "pass" ? "✓" : "✗"} ${headline(s)} · ${path.relative(ctx.cwd, s.report)}`, ...s.items.map((i: any) => `  ${MARK[i.verdict] ?? "○"} ${i.id} · ${i.title}`)].join("\n"));
						}
						if (Date.now() > end) break;
						onUpdate?.(text(`lab · Tester checking ${core.tally(s).pass + core.tally(s).fail}/${core.tally(s).total}`));
						await new Promise((res) => setTimeout(res, 2000));
					}
					return json({ finished: false, waiting: true, results: core.readResults(run), note: "Still running; call wait again." });
				}
			}
			// The rest goes through cli.mjs, as /lab does.
			let argv: string[];
			if (p.action === "check") {
				if (p.say && (p.file || p.check)) throw new Error("Give say, or file/check, not both.");
				argv = ["test", ...(p.say ? [p.say] : [p.file || "lab-scenarios.md", ...(p.check ? [p.check] : [])])];
				if (p.behind) argv.push("--behind");
				if (p.model) argv.push("--model", p.model);
			} else argv = p.action === "stop" ? ["stop", ...(p.run ? [p.run] : [])] : [p.action];
			let child: ChildProcess | undefined;
			const abort = () => child?.kill("SIGTERM");
			signal?.addEventListener("abort", abort, { once: true });
			try {
				const r = await runCli(argv, ctx.cwd, (l) => onUpdate?.(text(`lab · ${l}`)), (c) => { child = c; track(c); });
				const t = resultText(r);
				if (r.code === 2 && p.action === "check" && !/steps/.test(r.out)) throw new Error(t || `lab exited ${r.code}`);
				if (p.action === "stop") { for (const w of watching.values()) clearInterval(w); watching.clear(); setWidget(undefined); }
				return text(t || `lab exited ${r.code}`);
			} finally {
				signal?.removeEventListener("abort", abort);
			}
		},
	});
}
