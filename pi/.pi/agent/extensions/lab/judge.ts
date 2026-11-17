/**
 * The lab agent's only tools. Loaded explicitly (`pi -p --no-extensions -e judge.ts --tools lab_*`),
 * never auto-discovered: Pi only discovers lab/index.ts in this folder.
 * Every tool result is text the lab itself captured from the Herdr Lab window; lab_step refuses a
 * pass whose quote is not in that captured text.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
// @ts-ignore: plain ESM engine shared with the `lab` shell command
import * as core from "./core.mjs";

const out = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

function runId(): string {
	const id = process.env.LAB_RUN;
	if (!id || !core.ID_RE.test(id) || !core.readRun(id)) throw new Error("This lab agent was not started by the lab");
	return id;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "lab_open",
		label: "Lab · open a pane",
		description: 'Open a new pane in the lab. "shell" is a terminal in the project copy; "harness" starts the coding agent (Pi) there, with only the extensions that carry over (such as /split).',
		parameters: Type.Object({ program: Type.Union([Type.Literal("shell"), Type.Literal("harness")]) }),
		async execute(_c, p) {
			const id = runId();
			return out(`${await core.openPane(id, p.program)}\n${core.read(id)}`);
		},
	});
	pi.registerTool({
		name: "lab_type",
		label: "Lab · type",
		description: "Type one line into a pane and press Enter, as a person would. Waits until screens stop changing, then returns the visible text of every pane.",
		parameters: Type.Object({ pane: Type.String(), text: Type.String({ minLength: 1, maxLength: 2000 }) }),
		async execute(_c, p) {
			return out(await core.type(runId(), p.pane, p.text));
		},
	});
	pi.registerTool({
		name: "lab_keys",
		label: "Lab · keys",
		description: "Press named keys in a pane (enter, esc, up, down, tab, ctrl+c), then return the visible text of every pane.",
		parameters: Type.Object({ pane: Type.String(), keys: Type.Array(Type.String({ minLength: 1, maxLength: 20 }), { minItems: 1, maxItems: 8 }) }),
		async execute(_c, p) {
			return out(await core.keys(runId(), p.pane, p.keys));
		},
	});
	pi.registerTool({
		name: "lab_read",
		label: "Lab · read",
		description: "Read the visible text of one pane, or of every pane when none is named. Also lists every pane, including ones a command opened.",
		parameters: Type.Object({ pane: Type.Optional(Type.String()), lines: Type.Optional(Type.Integer({ minimum: 5, maximum: 200 })) }),
		async execute(_c, p) {
			return out(core.read(runId(), p.pane, p.lines ?? 40));
		},
	});
	pi.registerTool({
		name: "lab_shot",
		label: "Lab · screenshot",
		description: "Take a screenshot of the lab window. Returns the lab's own [lab] record line, which can be quoted.",
		parameters: Type.Object({}),
		async execute() {
			return out(core.shot(runId()));
		},
	});
	pi.registerTool({
		name: "lab_close",
		label: "Lab · close a pane",
		description: "Close a pane by name. Returns the lab's [lab] record line with the panes that remain.",
		parameters: Type.Object({ pane: Type.String() }),
		async execute(_c, p) {
			return out(await core.closePane(runId(), p.pane));
		},
	});
	pi.registerTool({
		name: "lab_step",
		label: "Lab · report a step",
		description: "Report one step: what you tried, what you expected, what you got, pass or fail, and a quote copied exactly from a screen or a [lab] line, showing the result (not what you typed). A pass whose quote the lab never captured, or that is only your own typing, is turned into a fail.",
		parameters: Type.Object({
			step: Type.Integer({ minimum: 1 }),
			tried: Type.String({ minLength: 1, maxLength: 300, description: "What you did, as it reads after \"I tried\", in the -ing form, e.g. \"opening a shell pane\", \"typing ls in P2\"" }),
			expected: Type.String({ minLength: 1, maxLength: 300, description: "What should appear, as it reads after \"expected\", e.g. \"a new pane with a prompt\"" }),
			got: Type.String({ minLength: 1, maxLength: 300, description: "What appeared, as it reads after \"got\", e.g. \"pane P2 with a prompt\"" }),
			verdict: Type.Union([Type.Literal("pass"), Type.Literal("fail")]),
			quote: Type.Optional(Type.String({ maxLength: 400 })),
		}),
		async execute(_c, p) {
			const id = runId();
			const run = core.readRun(id);
			const r = core.judgeStep(core.captured(id), run.steps, p, run.typed || []);
			core.writeRun(id, { steps: run.steps.map((s: any) => (s.n === r.n ? { ...s, ...r, at: new Date().toISOString() } : s)) });
			return out(`${r.verdict === "pass" ? "✓" : "✗"} step ${r.n} recorded${r.quoteFound ? "" : " (quote not found in captured text)"}`);
		},
	});
	pi.registerTool({
		name: "lab_finish",
		label: "Lab · finish",
		description: "After every step is reported, give a two-sentence summary. Then stop.",
		parameters: Type.Object({ summary: Type.String({ minLength: 1, maxLength: 800 }) }),
		async execute(_c, p) {
			const id = runId();
			const run = core.readRun(id);
			const missing = run.steps.filter((s: any) => !s.verdict).map((s: any) => s.n);
			core.writeRun(id, { summary: p.summary, phase: "judged" });
			return out(missing.length ? `Recorded. Steps never reported (counted as failed): ${missing.join(", ")}. Stop now.` : "Recorded. Stop now.");
		},
	});
}
