/**
 * /lab and the `lab` tool: a private Herdr Lab window where a black-box lab agent tries a scenario,
 * reports, and stops. Modelled on herdr-pi-lab.
 *
 * Two ways in, both running cli.mjs (also the `lab` shell command), so Pi and a shell run the same code:
 *   - Ask in plain words ("Use the lab to run the /split check"): the agent calls the `lab` tool's
 *     `check` action, which waits for the lab agent and returns every step.
 *   - Type it: /lab test lab-scenarios.md 1. Output goes through ctx.ui.notify: no model turn.
 *
 * Usage: /lab                         the guide (same as /lab --help)
 *        /lab doctor                  check Herdr, hc, Pi, /split and /agent before a run
 *        /lab test FILE [N|words]     run scenario N (or the one with those words; none: all)
 *        /lab test "Open a pane. Run ls."   a scenario in plain words
 *        /lab stop [ID|all]           close the latest lab
 */
import { type ChildProcess, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
// @ts-ignore: plain ESM shared with the `lab` shell command
import { ARG_HINT, help } from "./help.mjs";

const CLI = path.join(path.dirname(realpathSync(fileURLToPath(import.meta.url))), "cli.mjs");

/**
 * Shown after "/lab ". In pi 1.5.2 Enter applies the highlighted suggestion instead of submitting,
 * so every value leaves a valid command behind.
 */
const EXAMPLES: AutocompleteItem[] = [
	{ value: "--help", label: "/lab --help", description: "the guide, with examples; starts nothing" },
	{ value: "doctor", label: "/lab doctor", description: "check Herdr, hc, Herdr Lab, Pi, /split and /agent" },
	{ value: "test lab-scenarios.md 1", label: "/lab test lab-scenarios.md 1", description: "scenario 1 from the project's scenarios file" },
	{ value: "test lab-scenarios.md /split --behind", label: "/lab test lab-scenarios.md /split --behind", description: "the /split check, window behind yours" },
	{ value: 'test "Open a new pane. Run ls in it. Take a screenshot. Close the pane."', label: '/lab test "Open a new pane. Run ls…"', description: "a scenario in plain words" },
	{ value: "list", label: "/lab list", description: "labs on this computer" },
	{ value: "stop", label: "/lab stop", description: "close the latest lab: window, core, files" },
];
const SUBCOMMANDS = ["test", "doctor", "stop", "list", "--help"];

export function completions(prefix: string): AutocompleteItem[] | null {
	if (prefix === "") return EXAMPLES;
	// While a subcommand word is typed, offer matching ones. After it, stay quiet so Enter submits.
	if (/\s/.test(prefix)) return null;
	const hits = SUBCOMMANDS.filter((s) => s.startsWith(prefix) && s !== prefix);
	return hits.length ? hits.map((s) => EXAMPLES.find((e) => e.value.split(" ")[0] === s) ?? { value: s, label: `/lab ${s}` }) : null;
}

/** Shell-like split: "quoted words" stay one argument. */
export function tokenize(s: string): string[] {
	const out: string[] = [];
	const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? m[3]));
	return out;
}

function runCli(args: string[], cwd: string, onLine: (l: string) => void, onSpawn?: (c: ChildProcess) => void): Promise<{ code: number; out: string; err: string }> {
	return new Promise((resolve) => {
		const child = spawn("node", [CLI, ...args], { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
		onSpawn?.(child);
		let out = "";
		let err = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => {
			err += d;
			const last = String(d).trim().split("\n").at(-1);
			if (last) onLine(last.replace(/^· /, ""));
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

export default function (pi: ExtensionAPI) {
	let running = false;
	const children = new Set<ChildProcess>();
	const track = (c: ChildProcess) => {
		children.add(c);
		c.on("exit", () => children.delete(c));
	};

	// Quitting Pi mid-run: SIGTERM makes cli.mjs stop the lab it started (it keeps going after Pi exits).
	pi.on("session_shutdown", () => {
		for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
	});

	pi.registerCommand("lab", {
		// pi 1.5.2 drops argumentHint for extension commands, so the hint leads the description.
		description: `${ARG_HINT}  Herdr Lab: black-box test in a private window`,
		getArgumentCompletions: completions,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const argv = tokenize(args.trim());
			const cmd = argv[0];
			if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") return ctx.ui.notify(help("/lab"), "info");
			if (!["test", "run", "doctor", "stop", "list", "leftovers", "start"].includes(cmd)) {
				return ctx.ui.notify(`/lab: unknown command "${cmd}". Run /lab --help`, "error");
			}
			if (cmd === "test" || cmd === "run" || cmd === "start") {
				if (running) return ctx.ui.notify("A lab run from this conversation is still going; wait, or /lab stop", "warning");
				running = true;
				ctx.ui.notify("Lab starting. Progress shows in the status bar; the result arrives here.", "info");
				runCli(argv, ctx.cwd, (l) => ctx.ui.setStatus("lab", `lab · ${l}`), track)
					.then((r) => ctx.ui.notify(resultText(r) || `lab exited ${r.code}`, r.code === 2 ? "error" : r.code === 1 ? "warning" : "info"))
					.finally(() => {
						running = false;
						ctx.ui.setStatus("lab", undefined);
					});
				return;
			}
			const r = await runCli(argv, ctx.cwd, () => {});
			ctx.ui.notify(resultText(r), r.code === 0 ? "info" : "error");
		},
	});

	// For the agent: "Use the lab to run the first check in lab-scenarios.md".
	pi.registerTool({
		name: "lab",
		label: "Herdr Lab",
		description:
			'Run a check in the lab: a private Herdr window with a copy of this project, where a black-box lab agent carries out plain-word steps and judges only from the screen. When asked to "use the lab" to run a check, call check: check {file?, check?, say?, behind?, model?} runs checks from lab-scenarios.md (check: a number, "first", or words such as "/split"; none runs them all, each in its own lab) or one described in plain words (say), waits for the lab agent, and returns every step as "I tried X, expected Y, got Z" with ✓ or ✗ and a quote from the screen, then the report path; the lab is closed afterwards. Report the steps to the person as they came back; never restate a failed step as passed. Other actions: help; doctor (is the lab ready); list (labs on this computer); stop {run?} (close a lab; default the latest).',
		parameters: Type.Object({
			action: Type.Union([Type.Literal("check"), Type.Literal("doctor"), Type.Literal("list"), Type.Literal("stop"), Type.Literal("help")]),
			file: Type.Optional(Type.String({ description: "Scenarios file; default lab-scenarios.md in the project." })),
			check: Type.Optional(Type.String({ description: 'Which check: a number, "first", or words from it such as "/split". None runs them all.' })),
			say: Type.Optional(Type.String({ description: "A check in plain words, one step per sentence, instead of a file." })),
			behind: Type.Optional(Type.Boolean({ description: "Open the lab window behind the person's windows." })),
			model: Type.Optional(Type.String({ description: "provider/id for the lab; default LAB_MODEL, else the Pi default." })),
			run: Type.Optional(Type.String({ description: "For stop: a lab ID, or all." })),
		}),
		async execute(_id, p, signal, onUpdate, ctx) {
			const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });
			if (p.action === "help") return text(help("/lab"));
			let argv: string[];
			if (p.action === "check") {
				if (p.say && (p.file || p.check)) throw new Error("Give say, or file/check, not both.");
				argv = ["test", ...(p.say ? [p.say] : [p.file || "lab-scenarios.md", ...(p.check ? [p.check] : [])])];
				if (p.behind) argv.push("--behind");
				if (p.model) argv.push("--model", p.model);
			} else argv = p.action === "stop" ? ["stop", ...(p.run ? [p.run] : [])] : [p.action];
			let child: ChildProcess | undefined;
			const abort = () => child?.kill("SIGTERM"); // cli.mjs stops the lab it started
			signal?.addEventListener("abort", abort, { once: true });
			try {
				const r = await runCli(argv, ctx.cwd, (l) => onUpdate?.(text(`lab · ${l}`)), (c) => {
					child = c;
					track(c);
				});
				const t = resultText(r);
				if (r.code === 2 && p.action === "check" && !/steps/.test(r.out)) throw new Error(t || `lab exited ${r.code}`);
				return text(t || `lab exited ${r.code}`);
			} finally {
				signal?.removeEventListener("abort", abort);
			}
		},
	});
}
