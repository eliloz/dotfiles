/**
 * The sidecar's session: a branch of Main's conversation in a new file. Like /split's createBranch,
 * it uses a separate SessionManager opened on Main's file, so Main's file and Main's live session
 * are never written.
 */
import { closeSync, existsSync, openSync, readSync, rmSync } from "node:fs";
import { CURRENT_SESSION_VERSION, type ExtensionContext, SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";

export const OWNER = "sidecar-identity";

export type Identity = {
	id: string; // the sidecar's session id
	parent: string; // Main's session id
	parentFile: string;
	name: string;
	instructions: string;
	work: boolean;
	model: string; // provider/id
	thinking: string;
	allowed: string[];
};

const NON_MESSAGE = new Set(["thinking_level_change", "model_change", "usage", "custom", "label", "session_info", "context_edit"]);

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

/** Tool calls of the last assistant message with no result yet (Main is mid-tool at the cut). */
export function unfinished(branch: SessionEntry[]): { id: string; name: string }[] {
	const answered = new Set<string>();
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i];
		if (NON_MESSAGE.has(e.type)) continue;
		if (e.type !== "message") return [];
		const m = e.message as any;
		if (m.role === "toolResult") {
			answered.add(m.toolCallId);
			continue;
		}
		if (m.role !== "assistant" || m.stopReason === "error" || m.stopReason === "aborted") return [];
		return (m.content ?? []).flatMap((b: any) => (b.type === "toolCall" && !answered.has(b.id) ? [{ id: b.id, name: b.name }] : []));
	}
	return [];
}

export function startText(name: string, instructions: string): string {
	return `Any messages above are a copy of Main's conversation, for context only. From here on you are ${name}, a sidecar beside Main. Do not continue or redo Main's work.\n\nYour instructions: ${instructions}`;
}

/** Create the sidecar's session file. Returns its identity and path. */
export function createFork(ctx: ExtensionContext, base: Omit<Identity, "id" | "parent" | "parentFile">): { owner: Identity; file: string } {
	const live = ctx.sessionManager;
	const mainFile = live.getSessionFile();
	if (!mainFile) throw new Error("This conversation is not saved to a file (--no-session), so a sidecar cannot fork it. No pane opened.");
	const dir = live.getSessionDir();
	const leaf = live.getLeafId();
	const hasMessages = live.getBranch().some((e) => e.type === "message");

	let copy: SessionManager;
	if (existsSync(mainFile) && leaf) {
		if (headerVersion(mainFile) !== CURRENT_SESSION_VERSION) throw new Error("Main's session file is not in the current format; refusing to open it. No pane opened.");
		copy = SessionManager.open(mainFile, dir, ctx.cwd);
		if (copy.getSessionId() !== live.getSessionId() || !copy.getEntry(leaf)) throw new Error("Main's latest message is not saved to disk yet; try again in a moment. No pane opened.");
		const file = copy.createBranchedSession(leaf); // retargets `copy` to the new file only
		if (!file || file === mainFile) throw new Error("Pi did not write a separate session file for the sidecar. No pane opened.");
	} else {
		if (hasMessages) throw new Error("Main's conversation is not on disk yet; try again in a moment. No pane opened.");
		copy = SessionManager.create(ctx.cwd, dir, { parentSession: mainFile });
	}

	const file = copy.getSessionFile()!;
	try {
		for (const call of unfinished(copy.getBranch())) {
			copy.appendMessage({
				role: "toolResult",
				toolCallId: call.id,
				toolName: call.name,
				content: [{ type: "text", text: "Not run in this sidecar; Main continues it." }],
				isError: true,
				timestamp: Date.now(),
			} as any);
		}
		const owner: Identity = { ...base, id: copy.getSessionId(), parent: live.getSessionId(), parentFile: mainFile };
		// A user message, not a custom one: Pi writes a session file only once it holds a user or
		// assistant message, and a fresh Main has none.
		copy.appendMessage({ role: "user", content: [{ type: "text", text: startText(base.name, base.instructions) }], timestamp: Date.now() } as any);
		copy.appendSessionInfo(base.name);
		copy.appendCustomEntry(OWNER, owner);
		return { owner, file };
	} catch (error) {
		rmSync(file, { force: true });
		throw error;
	}
}
