/**
 * /split — branch the current conversation into a new Herdr pane beside this one.
 *
 * Guarantees:
 * - Main is never changed. The command runs without a model turn, and the branch is
 *   copied from a separate SessionManager opened on Main's file; Main's live manager
 *   is only read.
 * - You pick the message to branch at (or the whole conversation).
 * - The branch ends with a split notice for its agent.
 * - The new pane opens beside the pane running Main, in Main's working directory.
 *   If that pane cannot be identified exactly, nothing is opened.
 *
 * Usage: /split            pick a message, open the branch
 *        /split <name>     same, and name the branched session
 */
import { accessSync, closeSync, constants, existsSync, openSync, readSync, rmSync } from "node:fs";
import * as path from "node:path";
import {
	CURRENT_SESSION_VERSION,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

// Depends on pi's session format and Herdr's labels (herdr.space); recheck both after upgrading either.
const NOTICE_TYPE = "split-notice";
const NOTICE = `This conversation was split from another conversation that is still running. Everything above is copied from it for context only.
- Do not continue, repeat or finish any earlier work from the messages above; the other conversation owns it.
- Expect the other conversation to be changing files, possibly the same ones. Check the current state before relying on anything above, and avoid conflicting edits.
- Act only on what the user asks from here on. Until then, do nothing.`;

const TIMEOUT_MS = 15_000;
/** Entries that are not model messages, so they do not sit between a tool call and its results. */
const NON_MESSAGE = new Set(["thinking_level_change", "model_change", "usage", "custom", "label", "session_info", "context_edit"]);

type Exec = ExtensionAPI["exec"];

// ---------- Herdr: find Main's pane, refuse anything ambiguous ----------

async function run(exec: Exec, cmd: string, args: string[], cwd: string): Promise<string> {
	const r = await exec(cmd, args, { cwd, timeout: TIMEOUT_MS });
	if (r.code !== 0) {
		if (/ENOENT/.test(r.stderr)) throw new Error(`${cmd} is not on PATH`);
		throw new Error(`${cmd} ${args.slice(0, 2).join(" ")} failed: ${r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`}`);
	}
	return r.stdout;
}

/** The Herdr app pane showing this terminal. Throws instead of guessing. */
async function findMainPane(exec: Exec, cwd: string): Promise<string> {
	const terminal = process.env.HC_TERMINAL_ID;
	if (!terminal) throw new Error("Not running in a Herdr terminal (HC_TERMINAL_ID is unset)");

	// Terminal ids are per core; pin the space too so another core's "t1" cannot match.
	const record = JSON.parse(await run(exec, "hc", ["get", terminal, "--json"], cwd));
	const space = record?.labels?.["herdr.space"];
	if (record?.address !== terminal || typeof space !== "string") {
		throw new Error(`Terminal ${terminal} is not shown in a Herdr app space`);
	}

	const listing = JSON.parse(await run(exec, "herdr-app", ["ls"], cwd));
	const panes: string[] = [];
	for (const s of listing?.spaces ?? []) {
		if (s.id !== space || s.machine) continue;
		for (const t of s.tabs ?? []) {
			for (const p of t.terminals ?? []) {
				if (p.terminal === terminal && typeof p.pane === "string" && p.pane) panes.push(p.pane);
			}
		}
	}
	if (panes.length !== 1) {
		throw new Error(`Expected exactly one Herdr pane for terminal ${terminal}, found ${panes.length}`);
	}
	return panes[0];
}

function onPath(name: string): string | undefined {
	for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!dir) continue;
		const candidate = path.join(dir, name);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}
	return undefined;
}

/** Split `pane` to the right and start pi on `sessionFile` in `cwd`. Returns the new pane id. */
async function openPane(exec: Exec, cwd: string, pane: string, sessionFile: string): Promise<string> {
	const pi = onPath("pi");
	if (!pi) throw new Error("pi is not on PATH");
	const env = [`PATH=${process.env.PATH ?? ""}`];
	if (process.env.PI_CODING_AGENT_DIR) env.push(`PI_CODING_AGENT_DIR=${process.env.PI_CODING_AGENT_DIR}`);
	// pane.split has no folder argument, and Herdr's idea of this terminal's folder can differ
	// from pi's. cd first; every path travels as an argument, never as shell source.
	const argv = ["/bin/sh", "-c", 'cd "$1" && shift && exec "$@"', "split", cwd, "/usr/bin/env", ...env, pi, "--session", sessionFile];
	const out = JSON.parse(
		await run(exec, "herdr-app", ["do", "pane.split", JSON.stringify({ pane, direction: "right", argv })], cwd),
	);
	if (typeof out?.pane !== "string" || !out.pane || out.pane === pane) {
		throw new Error(`Herdr did not report a new pane: ${JSON.stringify(out)}`);
	}
	return out.pane;
}

// ---------- Picking where to branch ----------

function text(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join(" ");
}

interface Choice {
	label: string;
	entryId: string;
}

/** User messages and assistant replies with text on the active path, newest first. */
function choices(branch: SessionEntry[]): Choice[] {
	const out: Choice[] = [];
	let n = 0;
	for (const e of branch) {
		if (e.type !== "message") continue;
		const m = e.message;
		if (m.role !== "user" && m.role !== "assistant") continue;
		const line = text(m.content).replace(/\s+/g, " ").trim();
		if (m.role === "assistant" && !line) continue; // tool-call-only steps
		const who = m.role === "user" ? "You" : "Agent";
		n++;
		out.push({ label: `${String(n).padStart(3)}  ${who}: ${line.length > 100 ? `${line.slice(0, 99)}…` : line}`, entryId: e.id });
	}
	return out.reverse();
}

/** Move a cut at an assistant message past the tool results that answer it. */
function extendThroughToolResults(branch: SessionEntry[], entryId: string): string {
	let i = branch.findIndex((e) => e.id === entryId);
	let last = entryId;
	if (i < 0) return last;
	for (i++; i < branch.length; i++) {
		const e = branch[i];
		if (NON_MESSAGE.has(e.type)) continue;
		if (e.type === "message" && e.message.role === "toolResult") {
			last = e.id;
			continue;
		}
		break;
	}
	return last;
}

/** Tool calls of the final assistant message that have no result on `branch` (Main is mid-tool). */
function pendingToolCalls(branch: SessionEntry[]): { id: string; name: string }[] {
	const answered = new Set<string>();
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i];
		if (NON_MESSAGE.has(e.type)) continue;
		if (e.type !== "message") return [];
		const m = e.message;
		if (m.role === "toolResult") {
			answered.add(m.toolCallId);
			continue;
		}
		if (m.role !== "assistant" || m.stopReason === "error" || m.stopReason === "aborted") return [];
		return m.content.flatMap((b) => (b.type === "toolCall" && !answered.has(b.id) ? [{ id: b.id, name: b.name }] : []));
	}
	return [];
}

// ---------- Creating the branch without touching Main ----------

/** Version from the header line, reading only the start of the file (sessions can be large). */
function headerVersion(file: string): number | undefined {
	const fd = openSync(file, "r");
	try {
		const buf = Buffer.alloc(64 * 1024);
		const n = readSync(fd, buf, 0, buf.length, 0);
		return JSON.parse(buf.toString("utf8", 0, n).split("\n", 1)[0])?.version;
	} catch {
		return undefined;
	} finally {
		closeSync(fd);
	}
}

function createBranch(ctx: ExtensionCommandContext, mainFile: string, pickedId: string, name?: string): string {
	// pi writes a session file only once it has a message, and appends as entries arrive.
	if (!existsSync(mainFile)) throw new Error("This conversation is not saved to disk yet; try again in a moment");
	// SessionManager.open rewrites a file only to migrate an old format. Main has already
	// migrated its own file, but refuse rather than risk writing to it.
	if (headerVersion(mainFile) !== CURRENT_SESSION_VERSION) {
		throw new Error("Main's session file is not in the current format; refusing to open it");
	}
	const copy = SessionManager.open(mainFile, ctx.sessionManager.getSessionDir(), ctx.cwd);
	if (!copy.getEntry(pickedId)) throw new Error("That message is not saved to disk yet; try again in a moment");
	// Use the file as it is now, not as it was when the menu opened: tool results may have
	// arrived while picking, and must not be answered as "not run" in the branch.
	const entryId = extendThroughToolResults(copy.getBranch(), pickedId);
	const file = copy.createBranchedSession(entryId); // retargets `copy` to the new file only
	if (!file || file === mainFile) throw new Error("pi did not write a separate branch file");
	try {
		// Main may be mid-tool at the cut. Answer those calls in the branch only; Main still runs them.
		for (const call of pendingToolCalls(copy.getBranch())) {
			copy.appendMessage({
				role: "toolResult",
				toolCallId: call.id,
				toolName: call.name,
				content: [{ type: "text", text: "Not run in this split; the original conversation continues it." }],
				isError: true,
				timestamp: Date.now(),
			});
		}
		copy.appendCustomMessageEntry(NOTICE_TYPE, NOTICE, true, { splitFrom: mainFile, at: entryId });
		if (name) copy.appendSessionInfo(name);
		return file;
	} catch (error) {
		rmSync(file, { force: true });
		throw error;
	}
}

// ---------- Command ----------

export default function (pi: ExtensionAPI) {
	let busy = false;

	pi.registerCommand("split", {
		description: "Branch this conversation at a message you pick into a new Herdr pane (/split [name])",
		handler: async (args, ctx) => {
			if (busy) return ctx.ui.notify("A split is already in progress", "warning");
			if (!ctx.hasUI) return ctx.ui.notify("/split needs the interactive TUI", "error");
			busy = true;
			let branchFile: string | undefined;
			try {
				const exec: Exec = (c, a, o) => pi.exec(c, a, o);
				const pane = await findMainPane(exec, ctx.cwd); // refuse before asking anything

				const mainFile = ctx.sessionManager.getSessionFile();
				if (!mainFile) throw new Error("This conversation is not saved to a file, so it cannot be branched");
				const branch = ctx.sessionManager.getBranch();
				const options = choices(branch);
				if (options.length === 0) throw new Error("There are no messages to branch from yet");

				const WHOLE = "  ·  Whole conversation, as it is now";
				const labels = [WHOLE, ...options.map((o) => o.label)];
				const picked = await ctx.ui.select("Split from which message? (the branch keeps everything up to it)", labels);
				if (picked === undefined) return;
				const index = labels.indexOf(picked);
				if (index < 0) throw new Error("Unknown choice");
				if (ctx.sessionManager.getSessionFile() !== mainFile) throw new Error("The conversation changed while picking");

				let entryId: string;
				if (index === 0) {
					const leaf = ctx.sessionManager.getLeafId();
					if (!leaf) throw new Error("Nothing to branch");
					entryId = leaf;
				} else {
					entryId = options[index - 1].entryId;
				}

				const name = args.trim() || undefined;
				branchFile = createBranch(ctx, mainFile, entryId, name);
				const newPane = await openPane(exec, ctx.cwd, pane, branchFile);
				ctx.ui.notify(
					`Split${name ? ` "${name}"` : ""} opened in pane ${newPane} (${index === 0 ? "whole conversation" : "up to the picked message"}). Session: ${path.basename(branchFile)}`,
					"info",
				);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(
					`/split: ${msg}${branchFile ? `. The branch was saved; open it with: pi --session ${branchFile}` : ". No pane was opened"}`,
					"error",
				);
			} finally {
				busy = false;
			}
		},
	});
}
