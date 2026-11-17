/**
 * The lab's black-box Tester. It runs in its own Pi pane, started with only these tools
 * (`--no-extensions -e tester/index.ts --tools lab_do,…`, no context files, no session), so it cannot read
 * files, run a shell or open the agent's instructions: it can only have the lab type the expectations'
 * steps, read the guest panes' screens and record verdicts. Adapted from herdr-pi-lab's tester (0.5.0).
 *
 * Ours differs on one point (lesson, build guide line 403: "judge … from quoted screen text … reject any
 * quote that is not actually on screen"): the Tester sees screens only, never the panes' session
 * transcripts. Per expectation the lab keeps `given` (exactly the screen text the Tester was shown; its
 * quotes must come from there) and `saw` (every full screen the lab read; See/Absent are checked there).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import fs from "node:fs";
// @ts-ignore: plain ESM shared with the `lab` shell command
import * as core from "../core.mjs";
// @ts-ignore
import { parse, steps, decide, contains } from "../expectations.mjs";
// @ts-ignore
import { writeReport, headline } from "../report.mjs";

const SCREEN_LINES = 40;
const text = (t: string, summary?: string) => ({ content: [{ type: "text" as const, text: t }], details: { summary } });
// The person watching reads this pane: one line per tool result, the full text on ctrl+o.
const renderResult = (result: any, options: any, theme: any) => {
	const full = result.content?.map((c: any) => c.text).join("\n") ?? "";
	const summary = result.details?.summary;
	return new Text(options.expanded || !summary ? theme.fg("toolOutput", full) : theme.fg("muted", summary), 0, 0);
};
const MARK: Record<string, string> = { pass: "✓", fail: "✗", running: "◐", pending: "○" };
const add = (pool: Record<string, string[]>, pane: string, s: string) => { (pool[pane] ??= []).push(s); };

export default function (pi: ExtensionAPI) {
	pi.registerFlag("lab-run", { type: "string", description: "The lab run this Tester belongs to." });
	let ui: ExtensionContext | undefined;

	const runId = () => {
		const id = pi.getFlag("lab-run") || process.env.LAB_RUN;
		if (typeof id !== "string" || !core.ID_RE.test(id)) throw Error("This Tester was not started by the lab.");
		return id;
	};
	const load = () => {
		const id = runId(), run = core.readRun(id), results = core.readResults(id);
		if (!run || !results) throw Error("This lab run is gone.");
		const spec = parse(fs.readFileSync(core.dirs(id).expectations, "utf8"), run.agent);
		return { id, run, results, spec };
	};
	const guests = (run: any): [string, string][] => Object.entries(run.panes || {}).filter(([k]) => k !== "Tester") as [string, string][];
	const paneOf = (run: any, name: string) => {
		const hit = guests(run).find(([k]) => k.toLowerCase() === String(name).trim().toLowerCase());
		if (!hit) throw Error(`No guest pane called "${name}" in this lab. Panes: ${guests(run).map(([k]) => k).join(", ")}.`);
		return { name: hit[0], terminal: hit[1] };
	};
	const item = (spec: any, n: number) => {
		const i = spec.items.find((x: any) => x.id === n);
		if (!i) throw Error(`There is no expectation ${n}; the file has 1–${spec.items.length}.`);
		return i;
	};
	const save = (id: string, results: any) => { core.writeResults(id, results); show(); };
	const current = (results: any) => results.items.find((x: any) => x.running);

	function show() {
		if (!ui?.hasUI) return;
		try {
			const { run, results } = load();
			const c = core.tally(results);
			const head = results.result ? `Lab · ${run.agent} · ${headline(results)}` : `Lab · ${run.agent} · ${c.pass + c.fail}/${c.total} checked`;
			ui.ui.setWidget("lab-tester", [head, ...results.items.map((i: any) => `${MARK[i.verdict || (i.running ? "running" : "pending")]} ${i.id} · ${i.title}`)]);
		} catch {}
	}
	pi.on("session_start", async (_e, ctx) => { ui = ctx; show(); });

	pi.registerTool({
		name: "lab_do",
		label: "Lab · do",
		description: "Run the Do lines of one expectation exactly as written (typed into the named guest pane), wait until Main and the agent are quiet, and return the lines to check and the end of every guest screen.",
		parameters: Type.Object({ expectation: Type.Integer({ minimum: 1 }) }),
		renderResult,
		async execute(_c, p) {
			const { id, run, results, spec } = load();
			const it = item(spec, p.expectation);
			const terminals = guests(run).map(([, t]) => t);
			const todo = steps(it).map((s: any) => ({ ...s, pane: paneOf(run, s.pane) }));
			for (const x of results.items) x.running = x.id === it.id;
			const rec = results.items.find((x: any) => x.id === it.id);
			rec.given ??= {}; rec.saw ??= {};
			save(id, results);
			const log: string[] = [];
			for (const s of todo) {
				const r = await core.sendLine(id, s.pane.terminal, s.text, terminals, { quiet: 4, seconds: 240 });
				log.push(`typed in ${s.pane.name}: ${s.text}${r.settled ? "" : "  (still working after 4 minutes)"}`);
			}
			if (!todo.length) await core.settleOn(id, terminals, { quiet: 2, seconds: 60 });
			// Read every screen as soon as the step settled: a reply that scrolls off later still counts.
			const screens = guests(run).map(([k, t]) => {
				const full = core.screen(id, t), shown = core.lastLines(full, SCREEN_LINES);
				add(rec.saw, k, full); add(rec.given, k, shown);
				return `--- ${k}: end of screen ---\n${shown || "(blank)"}`;
			});
			save(id, results);
			const checks = it.lines.filter((l: any) => l.kind !== "do").map((l: any) => `${l.kind[0].toUpperCase() + l.kind.slice(1)} (${l.pane}): ${l.text}`);
			return text(`${it.id} · ${it.title}\n${log.join("\n") || "no steps; screens as they are"}\n\nCheck:\n${checks.join("\n")}\n\n${screens.join("\n\n")}`,
				`${it.id} · ${it.title}: ${log.length ? log.join(" · ") : "checking the screens"}`);
		},
	});

	pi.registerTool({
		name: "lab_look",
		label: "Lab · look",
		description: "Read the end of a guest pane's screen now (Main or the agent).",
		parameters: Type.Object({ pane: Type.String(), lines: Type.Optional(Type.Integer({ minimum: 5, maximum: 200 })) }),
		renderResult,
		async execute(_c, p) {
			const { id, run, results } = load();
			const pane = paneOf(run, p.pane);
			const full = core.screen(id, pane.terminal), shown = core.lastLines(full, p.lines || SCREEN_LINES);
			const rec = current(results);
			if (rec) { add(rec.saw ??= {}, pane.name, full); add(rec.given ??= {}, pane.name, shown); save(id, results); }
			return text(`--- ${pane.name}: end of screen ---\n${shown || "(blank)"}`, `read ${pane.name}`);
		},
	});

	pi.registerTool({
		name: "lab_find",
		label: "Lab · find",
		description: "Check whether exact text is on a guest pane's screen right now (ignores case, spacing, punctuation and line wrapping).",
		parameters: Type.Object({ pane: Type.String(), text: Type.String({ minLength: 1 }) }),
		renderResult,
		async execute(_c, p) {
			const { id, run, results } = load();
			const pane = paneOf(run, p.pane);
			const full = core.screen(id, pane.terminal), found = contains(full, p.text);
			const rec = current(results);
			// A find shows the Tester only the phrase, so only the phrase becomes quotable.
			if (rec) { add(rec.saw ??= {}, pane.name, full); if (found) add(rec.given ??= {}, pane.name, p.text); save(id, results); }
			const r = `${found ? "found" : "not found"} on ${pane.name}: "${p.text}"`;
			return text(r, r);
		},
	});

	pi.registerTool({
		name: "lab_verdict",
		label: "Lab · verdict",
		description: "Record pass or fail for one expectation, with verbatim quotes from the screens you were shown as evidence. A quote you were not shown on that pane is rejected. See/Absent lines are checked by the lab and override the verdict.",
		parameters: Type.Object({
			expectation: Type.Integer({ minimum: 1 }),
			verdict: Type.Union([Type.Literal("pass"), Type.Literal("fail")]),
			reason: Type.String({ minLength: 1, maxLength: 600 }),
			evidence: Type.Array(Type.Object({ pane: Type.String(), quote: Type.String({ minLength: 2, maxLength: 300 }) }), { maxItems: 6 }),
			absent: Type.Optional(Type.Array(Type.Object({ pane: Type.String(), text: Type.String({ minLength: 2, maxLength: 200 }) }), { maxItems: 6 })),
		}),
		renderResult,
		async execute(_c, p) {
			const { id, run, results, spec } = load();
			const it = item(spec, p.expectation);
			const rec = results.items.find((x: any) => x.id === it.id);
			if (!rec.given) throw Error(`Call lab_do ${it.id} first: it runs the steps and shows you the screens.`);
			for (const [k, t] of guests(run)) add(rec.saw, k, core.screen(id, t));
			const d = decide(it, p, rec.given, rec.saw);
			Object.assign(rec, { verdict: d.verdict, running: false, tester: p.verdict, reason: p.reason, evidence: p.evidence, absent: p.absent || [], observed: d.observed, at: new Date().toISOString() });
			save(id, results);
			const note = d.observed.length ? "\nLab checks: " + d.observed.map((o: any) => `${o.ok ? "✓" : "✗"} ${o.kind} (${o.pane}) "${o.text}"`).join("; ") : "";
			const line = `${MARK[d.verdict]} ${it.id} · ${it.title}: ${d.verdict}${d.verdict !== p.verdict ? " (the lab's own checks overrode your verdict)" : ""}`;
			return text(line + note, `${line} · ${p.reason}`);
		},
	});

	pi.registerTool({
		name: "lab_finish",
		label: "Lab · finish",
		description: "After every expectation has a verdict: write the report into the agent's reports folder, save a screenshot of this window, and hand the result to the person.",
		parameters: Type.Object({ summary: Type.String({ minLength: 1, maxLength: 800 }) }),
		renderResult,
		async execute(_c, p) {
			const { id, results } = load();
			const open = results.items.filter((i: any) => !i.verdict);
			if (open.length) throw Error(`Still unchecked: ${open.map((i: any) => `${i.id} · ${i.title}`).join(", ")}.`);
			results.result = results.items.every((i: any) => i.verdict === "pass") ? "pass" : "fail";
			results.summary = p.summary;
			// Show the finished checklist first, so the window screenshot in the report shows the result.
			save(id, results);
			await new Promise((r) => setTimeout(r, 1500));
			const report = writeReport(id, { summary: p.summary });
			Object.assign(results, { report: report.file, shot: report.shot, finished: new Date().toISOString() });
			save(id, results);
			core.writeRun(id, { phase: "finished" });
			const c = core.tally(results);
			return text(`Report: ${report.file}\n${c.pass}/${c.total} passed. Done: stop here.`, `${c.pass}/${c.total} passed · report written`);
		},
	});
}
