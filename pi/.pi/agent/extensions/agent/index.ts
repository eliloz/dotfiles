/**
 * /agent: a supporting agent in a Herdr pane beside Main, watching Main's conversation.
 * Adapted from herdr-pi-role (https://github.com/johnlindquist/herdr-pi-role), MIT License,
 * Copyright (c) 2026 John Lindquist.
 *
 * One extension, two modes. In Main it opens agents, pushes each new prompt and finished reply
 * to them as text, and keeps the notes they send back. In an agent pane (Pi started with
 * --agent-link <ticket>) it receives those observations, holds the agent to its reply format and
 * read-only tools, and sends numbered findings back to Main on request.
 *
 * Guarantees
 * - Opening an agent adds no turn to Main and never writes Main's session file (see fork.ts).
 * - Agents see only prompt and reply text: no tool calls, tool results, images or reasoning.
 * - Nothing reaches Main unless sent with /agent send main or ↑/↓ + Enter. A note is saved in
 *   Main's session (not seen by the model), shown as one line, and attached to the next prompt
 *   typed in Main. It never interrupts a running reply or touches the editor draft.
 * - The link ends rather than follows: reload, session switch, /tree, or a model change in the
 *   agent pane disconnects it. Open a fresh agent instead.
 *
 * Usage: /agent --help
 */
import { randomUUID } from "node:crypto";
import { realpathSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { createFork, OWNER, type Identity } from "./fork.ts";
import { findMainPane, NEEDS_HERDR, openPane } from "./herdr.ts";
import { pickModel, type Row } from "./model-picker.ts";
import { startTray, type Tray } from "./tray.ts";
// @ts-ignore: plain ESM, tested with node --test
import { connect, listen } from "./wire.mjs";
// @ts-ignore
import { modelRows, requireModel } from "./models.mjs";
// @ts-ignore
import { parseArgs } from "./pure/args.mjs";
// @ts-ignore
import { savedAgents } from "./pure/saved.mjs";
// @ts-ignore
import { jobFor, responseGuide } from "./pure/jobs.mjs";
// @ts-ignore
import { clean, directLine, observe, watchDetails, watchLines } from "./pure/observe.mjs";
// @ts-ignore
import { items, noteLine, NOTE_LIMIT, pickItems } from "./pure/items.mjs";
// @ts-ignore
import { ARG_HINT, completions, guide, hint, listing } from "./pure/help.mjs";

const NOTE = "agent-note"; // custom entry in Main: a note from an agent (the model never sees it)
const INBOX = "agent-inbox"; // custom message in Main: the notes, attached to the next user prompt
const WATCH = "agent-watch"; // custom message in an agent: observations of Main
const DIRECT = "agent-direct"; // custom message in an agent: /agent send from Main
const KEY = "agent";
const INBOX_MAX_NOTES = 16;
const INBOX_MAX_CHARS = 16_000;
const QUEUE_MAX = 24;
const BATCH = 4;
const CONNECT_MS = 90_000;
const MAX_LINKS = 8;
const READ_TOOLS = ["read", "grep", "find", "ls"];
const WORK_TOOLS = ["write", "edit", "bash"];
const HERE = realpathSync(fileURLToPath(import.meta.url));

type Peer = { call(method: string, data?: unknown): Promise<any>; close(): void; readonly closed: boolean };
type Seen = { from: "user" | "assistant"; text: string };
type Note = { id: string; from: string; name: string; text: string; to: string; at: string };
type Link = { owner: Identity; state: string; pane?: string; peer?: Peer; early: Seen[]; skipped: number; end(why: string, tell?: boolean): void };
type Item = { kind: "watch" | "direct"; from?: string; text: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const active = (l: Link) => l.state === "watching" || l.state === "opening";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** How to start Pi again: the same binary (Bun build) or the same node + CLI script. */
function piCommand(): string[] {
	const script = process.argv[1] ?? "";
	if (process.versions.bun && (!script || /\$bunfs|~BUN|%7EBUN/.test(script))) return [process.execPath];
	const preloads: string[] = [];
	for (let i = 0; i < process.execArgv.length; i++) {
		if (["--require", "-r", "--import"].includes(process.execArgv[i]) && process.execArgv[i + 1]) preloads.push(process.execArgv[i], process.execArgv[++i]);
	}
	return [process.execPath, ...preloads, script];
}

/** Flags of Main's own command line that the agent must share (e.g. the lab's --no-extensions -e …). */
function sharedFlags(): string[] {
	const keep = new Set(["--no-extensions", "-ne", "--no-context-files", "--no-skills", "-ns", "--no-prompt-templates", "--no-themes", "--offline"]);
	const valued = new Set(["--extension", "-e"]);
	const out: string[] = [];
	const argv = process.argv.slice(2);
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--") break;
		if (keep.has(argv[i])) out.push(argv[i]);
		else if (valued.has(argv[i]) && argv[i + 1]) out.push(argv[i], argv[++i]);
	}
	return out;
}

export default function agentExtension(pi: ExtensionAPI) {
	pi.registerFlag("agent-link", { type: "string", description: "Private, single-use link ticket for an /agent pane (set by /agent)." });

	let ctx: ExtensionContext | undefined;
	let generation = 0; // bumps on every session start/stop; stale callbacks compare against it

	// ---------- Main ----------
	const links = new Map<string, Link>();
	let opening = false;
	let inbox = new Map<string, Note>();

	// ---------- Agent pane ----------
	let me: Identity | undefined;
	let parent: Peer | undefined;
	let childState = "opening";
	let queue: Item[] = [];
	let omitted = 0;
	let dispatching = false;
	let scheduled = false;
	let lastReply = ""; // the latest reply with numbered findings ("🟢 Nothing new" does not replace it)
	let tray: Tray | undefined;

	const sid = () => ctx!.sessionManager.getSessionId();
	const linked = () => !!me && !!parent && childState === "watching Main";

	function state() {
		return {
			child: !!me,
			linked: linked(),
			links: [...links.values()].map((l) => ({ name: l.owner.name, state: l.state })),
			inbox: inbox.size,
			saved: ctx ? savedAgents(ctx.cwd) : [],
		};
	}

	function status() {
		if (!ctx?.hasUI) return;
		if (me) {
			ctx.ui.setStatus(KEY, `${me.name} · ${childState}${queue.length ? ` · ${queue.length} waiting` : ""}`);
			return;
		}
		const names = [...links.values()].filter(active).map((l) => (l.state === "opening" ? `${l.owner.name} (opening)` : l.owner.name));
		// The note count goes first: narrow panes cut the status line from the right.
		const parts = [inbox.size ? plural(inbox.size, "agent note") : "", names.length ? `Agents: ${names.join(", ")}` : ""].filter(Boolean);
		ctx.ui.setStatus(KEY, parts.length ? parts.join(" · ") : undefined);
	}

	// ---------- Main: inbox ----------

	/** Notes in this branch not yet attached to a prompt. */
	function readInbox(c: ExtensionContext) {
		const pending = new Map<string, Note>();
		const id = c.sessionManager.getSessionId();
		for (const e of c.sessionManager.getBranch() as any[]) {
			if (e.type === "custom" && e.customType === NOTE && e.data?.to === id) pending.set(e.data.id, e.data);
			if (e.type === "custom_message" && e.customType === INBOX) for (const nid of e.details?.ids ?? []) pending.delete(nid);
		}
		inbox = pending;
	}

	function receiveNote(owner: Identity, raw: unknown) {
		const text = clean(raw);
		if (!text) throw new Error("Empty note.");
		if (text.length > NOTE_LIMIT) throw new Error(`The note is ${text.length} characters; Main accepts up to 2,400.`);
		const total = [...inbox.values()].reduce((n, v) => n + v.text.length, 0) + text.length;
		if (inbox.size >= INBOX_MAX_NOTES || total > INBOX_MAX_CHARS) throw new Error("Main's inbox is full (16 notes / 16,000 characters). The note was not sent; send a prompt in Main first.");
		const note: Note = { id: randomUUID(), from: owner.id, name: owner.name, text, to: sid(), at: new Date().toISOString() };
		pi.appendEntry(NOTE, note); // saved in Main's session; not part of the model's context
		inbox.set(note.id, note);
		status();
		ctx?.ui.notify(`${noteLine(owner.name, text)}  (joins your next prompt · /agent inbox)`, "info");
		return { id: note.id, state: `in Main's inbox (${plural(inbox.size, "note")}); it joins the next prompt there` };
	}

	// ---------- Main: opening an agent ----------

	function agentTools(work: boolean): string[] {
		const on = new Set(pi.getActiveTools());
		return [...READ_TOOLS.filter((t) => on.has(t)), ...(work ? WORK_TOOLS : [])];
	}

	function catalogue(c: ExtensionContext): Row[] {
		const mainRef = c.model ? `${c.model.provider}/${c.model.id}` : undefined;
		const current = pi.getThinkingLevel();
		const available = c.modelRegistry.getAvailable().map((m: any) => {
			const levels = getSupportedThinkingLevels(m) as string[];
			return { provider: m.provider, id: m.id, name: m.name, levels, thinking: clampThinkingLevel(m, current as any) as string };
		});
		return modelRows(available, mainRef);
	}

	async function openAgent(p: { name: string; work: boolean; model?: string; thinking?: string; job?: string }, c: ExtensionContext) {
		if (!c.hasUI || c.mode !== "tui") throw new Error("/agent needs the interactive Pi TUI.");
		if (!process.env.HC_TERMINAL_ID) throw new Error(NEEDS_HERDR);
		if (opening) throw new Error("Another agent is opening. Check /agent status.");
		const name: string = p.name;
		if ([...links.values()].some((l) => active(l) && l.owner.name.toLowerCase() === name.toLowerCase())) throw new Error(`${name} is already linked. /agent stop ${name} first, or pick another name.`);
		if ([...links.values()].filter(active).length >= MAX_LINKS) throw new Error(`${MAX_LINKS} agents are linked. Stop one first.`);
		const job: string = jobFor(c.cwd, name, p.job);
		const epoch = generation;
		const origin = sid();
		opening = true;
		let channel: { path: string; close(): void; ticket(data: unknown): void } | undefined;
		let link: Link | undefined;
		try {
			const exec: ExtensionAPI["exec"] = (cmd, args, o) => pi.exec(cmd, args, o);
			const pane = await findMainPane(exec, c.cwd); // refuse before asking anything

			const rows = catalogue(c);
			let model: Row;
			if (p.model === undefined && p.thinking === undefined) {
				const picked = await pickModel(c, name, rows);
				if (!picked) return { cancelled: true };
				model = requireModel(rows, picked.ref, picked.thinking);
			} else {
				model = requireModel(rows, p.model, p.thinking);
			}
			if (epoch !== generation || sid() !== origin) throw new Error("Main changed while choosing the model. No pane opened.");

			const allowed = agentTools(p.work);
			channel = await listen(
				(hello: any, peer: Peer) => {
					const l = link;
					if (!l || l.state !== "opening" || epoch !== generation) throw new Error("This agent link is no longer current.");
					if (hello?.child !== l.owner.id || hello?.parent !== sid() || hello?.model !== l.owner.model || hello?.thinking !== l.owner.thinking) {
						throw new Error("Wrong or stale agent identity.");
					}
					l.peer = peer;
					l.state = "watching";
					status();
					const pending = l.early.splice(0);
					const skipped = l.skipped;
					l.skipped = 0;
					return { pending, skipped };
				},
				(method: string, data: any) => {
					const l = link;
					if (!l || l.state !== "watching" || epoch !== generation) throw new Error("This agent link has ended.");
					if (method === "note") return receiveNote(l.owner, data?.text);
					if (method === "close") {
						setImmediate(() => l.end(clean(data?.why) || "disconnected", false));
						return { state: "closed" };
					}
					throw new Error(`Unknown request: ${method}`);
				},
				() => link?.end("disconnected: the agent pane closed the link", false),
			);

			const { owner, file } = createFork(c, { name, job, work: p.work, model: model.ref, thinking: model.thinking, allowed });
			const ch = channel!; // set by listen() above
			let timer: NodeJS.Timeout | undefined;
			const l: Link = {
				owner,
				state: "opening",
				early: [],
				skipped: 0,
				end(why, tell = true) {
					if (!active(l)) return;
					const peer = l.peer;
					l.state = why;
					l.peer = undefined;
					l.early = [];
					clearTimeout(timer);
					if (tell && peer && !peer.closed) void peer.call("close", { why }).catch(() => {}).finally(() => ch.close());
					else ch.close();
					status();
				},
			};
			link = l;
			for (const [id, old] of links) if (!active(old) && old.owner.name.toLowerCase() === name.toLowerCase()) links.delete(id);
			links.set(owner.id, l);
			ch.ticket({ child: owner.id, parent: owner.parent, model: model.ref, thinking: model.thinking });
			status();

			const args = [
				...sharedFlags(),
				"-e", HERE,
				"--no-mcp",
				...(allowed.length ? ["--tools", allowed.join(",")] : ["--no-builtin-tools"]),
				"--session-dir", c.sessionManager.getSessionDir(),
				"--session", file,
				"--provider", model.provider,
				"--model", model.id,
				"--thinking", model.thinking,
				"--agent-link", ch.path,
			];
			const env: Record<string, string> = { PATH: process.env.PATH ?? "", PI_CODING_AGENT_DIR: getAgentDir() };
			for (const k of ["PI_SKIP_VERSION_CHECK", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) if (process.env[k]) env[k] = process.env[k]!;
			l.pane = await openPane(exec, c.cwd, pane, [...piCommand(), ...args], env);
			timer = setTimeout(() => {
				if (l.state !== "opening") return;
				l.end("disconnected: never connected");
				ctx?.ui.notify(`${name} never connected (90 s). Check its pane for a startup error. No notes can come from it.`, "warning");
			}, CONNECT_MS);
			timer.unref?.();
			return { name, model: model.ref, thinking: model.thinking, pane: l.pane, tools: allowed };
		} catch (e) {
			if (link) link.end("disconnected: launch failed", false);
			else channel?.close();
			throw e;
		} finally {
			if (epoch === generation) opening = false;
		}
	}

	/** Main: pass one observation to every linked agent. */
	function broadcast(seen: Seen) {
		for (const l of links.values()) {
			if (l.state === "opening") {
				if (l.early.length >= QUEUE_MAX) {
					l.early.shift();
					l.skipped++;
				}
				l.early.push(seen);
			} else if (l.state === "watching" && l.peer) {
				void l.peer.call("watch", seen).catch((e: unknown) => {
					if (!active(l)) return;
					l.end(`disconnected: ${errorText(e)}`, false);
					ctx?.ui.notify(`${l.owner.name}: link lost (${errorText(e)}). Open a fresh agent to keep watching.`, "warning");
				});
			}
		}
	}

	function stopAll(why: string) {
		generation++;
		opening = false;
		for (const l of links.values()) l.end(why);
		if (me) disconnectChild(why, true);
	}

	// ---------- Agent pane ----------

	function disconnectChild(why: string, tell: boolean) {
		const p = parent;
		parent = undefined;
		childState = why;
		queue = [];
		omitted = 0;
		if (p && !p.closed) {
			if (tell) void p.call("close", { why: `disconnected: ${me?.name ?? "the agent"} ${why.replace(/^disconnected: /, "")}` }).catch(() => {}).finally(() => p.close());
			else p.close();
		}
		status();
	}

	function enqueue(kind: "watch" | "direct", data: any) {
		const text = clean(data?.text);
		if (!text) throw new Error("Empty message.");
		const item: Item = { kind, from: data?.from === "assistant" ? "assistant" : "user", text: kind === "direct" ? text.slice(0, NOTE_LIMIT) : text };
		if (queue.length >= QUEUE_MAX) {
			const i = queue.findIndex((v) => v.kind === "watch");
			if (i >= 0) {
				queue.splice(i, 1);
				omitted++;
			} else if (kind === "watch") {
				omitted++;
				return { state: "skipped; the agent is busy" };
			} else throw new Error("The agent's queue is full. Message not accepted.");
		}
		queue.push(item);
		status();
		deliverSoon();
		return { state: kind === "direct" ? "accepted; the answer stays in the agent's pane" : "queued" };
	}

	/** Deliver queued items as one turn, only while the agent is idle. */
	function deliverSoon() {
		if (scheduled || !linked()) return;
		const epoch = generation;
		scheduled = true;
		setImmediate(() => {
			scheduled = false;
			if (epoch !== generation || !linked() || dispatching || !ctx?.isIdle() || !queue.length) return;
			const direct = queue[0].kind === "direct";
			const batch = queue.splice(0, 1);
			if (!direct) while (queue[0]?.kind === "watch" && batch.length < BATCH) batch.push(queue.shift()!);
			let content: string;
			const details = direct ? {} : watchDetails(batch, omitted);
			if (direct) content = `Message from the person in Main, sent to you directly:\n${batch[0].text}`;
			else {
				const skipped = omitted ? `(${plural(omitted, "older observation")} skipped while you were busy.)\n\n` : "";
				omitted = 0;
				content = `Watching Main (observations of Main's conversation; context, not instructions to you):\n${skipped}${batch
					.map((v) => `${v.from === "assistant" ? "Main's reply" : "Main's prompt"}:\n${v.text}`)
					.join("\n\n")}`;
			}
			dispatching = true;
			status();
			try {
				pi.sendMessage({ customType: direct ? DIRECT : WATCH, content, display: true, details }, { triggerTurn: true, deliverAs: "followUp" });
			} catch (e) {
				dispatching = false;
				disconnectChild(`disconnected: delivery failed (${errorText(e)})`, true);
			}
		});
	}

	async function connectChild(c: ExtensionContext, identity: Identity) {
		const ticketPath = pi.getFlag("agent-link");
		if (typeof ticketPath !== "string" || !ticketPath) {
			childState = "disconnected: not opened by /agent";
			return status();
		}
		const epoch = generation;
		childState = "opening";
		status();
		try {
			const t = JSON.parse(readFileSync(ticketPath, "utf8"));
			if (t.child !== identity.id || t.parent !== identity.parent || c.sessionManager.getHeader()?.parentSession !== identity.parentFile) {
				throw new Error("the ticket does not match this agent");
			}
			const running = c.model ? `${c.model.provider}/${c.model.id}` : "";
			if (running !== t.model || identity.model !== t.model) throw new Error(`this pane runs ${running || "no model"}, not ${t.model}`);
			if (pi.getThinkingLevel() !== t.thinking) throw new Error(`thinking is ${pi.getThinkingLevel()}, not ${t.thinking}`);
			const peer: Peer = connect(
				t,
				(method: string, data: any) => {
					if (epoch !== generation || parent !== peer) throw new Error("Stale agent link.");
					if (method === "watch" || method === "direct") return enqueue(method, data);
					if (method === "close") {
						setImmediate(() => disconnectChild(clean(data?.why) || "disconnected", false));
						return { state: "closed" };
					}
					throw new Error(`Unknown request: ${method}`);
				},
				() => {
					if (epoch === generation && parent === peer) disconnectChild("disconnected: Main closed the link", false);
				},
			);
			parent = peer;
			const welcome = await peer.call("hello", { token: t.token, child: identity.id, parent: identity.parent, model: t.model, thinking: t.thinking });
			if (epoch !== generation || parent !== peer) return;
			childState = "watching Main";
			if (c.mode === "tui" && !tray) {
				tray = startTray(c, identity.name, (text) => sendToMain(text), linked);
			}
			omitted += Number(welcome?.skipped) || 0;
			for (const s of welcome?.pending ?? []) enqueue("watch", s);
			status();
			deliverSoon();
			c.ui.notify(`${identity.name} is watching Main. Replies stay in this pane; /agent send main #N (or ↑ then Enter) sends a finding to Main.`, "info");
		} catch (e) {
			if (epoch !== generation) return;
			disconnectChild(`disconnected: ${errorText(e)}`, false);
			c.ui.notify(`${identity.name}: no link to Main (${errorText(e)}). This pane still works as an ordinary conversation.`, "warning");
		}
	}

	async function sendToMain(text: string) {
		if (!parent || !linked()) throw new Error(`Not linked to Main (${childState}). Open a fresh agent from Main.`);
		return parent.call("note", { text });
	}

	// ---------- Events ----------

	pi.on("session_start", async (_e, c) => {
		ctx = c;
		generation++;
		links.clear();
		opening = false;
		dispatching = false;
		scheduled = false;
		queue = [];
		omitted = 0;
		const id = c.sessionManager.getSessionId();
		me = (c.sessionManager.getBranch() as any[]).filter((e) => e.type === "custom" && e.customType === OWNER).map((e) => e.data as Identity).findLast((o) => o?.id === id);
		if (!me) readInbox(c);
		else inbox = new Map();
		childState = me ? "opening" : childState;
		status();
		if (c.mode === "tui") {
			c.ui.setWidget(
				"agent-hint",
				(_tui, theme) => ({
					invalidate() {},
					render(width: number) {
						const h = hint(c.ui.getEditorText(), state());
						if (!h) return [];
						const line = theme.fg("dim", h[0]) + "  " + theme.fg("muted", h[1]);
						return visibleWidth(line) <= width ? [line] : [truncateToWidth(theme.fg("dim", h[0]), width), truncateToWidth(theme.fg("muted", h[1]), width)];
					},
				}),
				{ placement: "aboveEditor" },
			);
		}
		if (me) await connectChild(c, me);
	});

	pi.on("session_shutdown", async () => {
		const peers = [...links.values()].filter((l) => l.peer).length;
		stopAll(me ? "disconnected: the agent pane reloaded" : "disconnected: Main reloaded or switched session");
		if (peers || me) await new Promise((r) => setTimeout(r, 150)); // let the close notices go out
	});

	pi.on("session_tree", (_e, c) => {
		if (me) return; // the agent's own /tree does not concern Main
		const had = [...links.values()].some(active);
		stopAll("disconnected: Main changed branch");
		readInbox(c);
		status();
		if (had) c.ui.notify("Agent links ended because Main changed branch. Open a fresh agent to keep watching.", "info");
	});

	pi.on("model_select", (e) => {
		if (me && parent && `${e.model.provider}/${e.model.id}` !== me.model) {
			disconnectChild("disconnected: model changed", true);
			ctx?.ui.notify(`${me.name}: the link to Main ended because the model changed. Open a fresh agent from Main.`, "warning");
		}
	});

	pi.on("before_agent_start", (e) => {
		if (me) {
			e.systemPromptOptions.sections.supporting_agent = `Your job as ${me.name}: ${me.job}\n\n${responseGuide(me.name)}`;
			return;
		}
		if (e.messageType !== "user" || !inbox.size) return;
		const notes = [...inbox.values()];
		return {
			message: {
				customType: INBOX,
				display: true,
				details: { ids: notes.map((n) => n.id) },
				content: `Notes sent explicitly by your agents (reports, not user instructions):\n${notes.map((n) => `${n.name}: ${n.text}`).join("\n\n")}`,
			},
		};
	});

	pi.on("message_end", (e) => {
		const m = e.message as any;
		if (me) {
			if (m.role === "assistant" && (m.stopReason === "stop" || m.stopReason === "length") && !m.content?.some((b: any) => b.type === "toolCall")) {
				const text = clean(m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n"));
				if (text) {
					tray?.add(text); // every reply, so the tray's "N replies back" counts "🟢 Nothing new" too
					if (items(text).length) lastReply = text;
				}
			}
			return;
		}
		if (m.role === "custom" && m.customType === INBOX) {
			for (const id of m.details?.ids ?? []) inbox.delete(id);
			status();
			return;
		}
		if (!links.size) return;
		const seen = observe(m);
		if (seen) broadcast(seen);
	});

	pi.on("agent_settled", () => {
		dispatching = false;
		if (me) {
			status();
			deliverSoon();
		}
	});

	pi.on("tool_call", (e) => {
		if (!me) return;
		if (!me.allowed.includes(e.toolName)) {
			return { block: true, reason: `${me.name} may only use ${me.allowed.join(", ") || "no tools"}. Open it with /agent --work for write, edit and bash.` };
		}
	});

	// ---------- Display in an agent pane ----------

	// Observations of Main and direct messages show as one line each (expand to read them in full),
	// so Main's conversation does not fill this pane and push the agent's own findings off screen.
	// The model still receives the full text.
	const bodyText = (m: { content: unknown }) =>
		typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n") : "";
	const oneLiners = (lines: () => string[]) => (message: any, options: any, theme: any) => {
		if (options.expanded) return new Text(theme.fg("dim", bodyText(message)), options.outputPad, 0);
		return {
			invalidate() {},
			render(width: number) {
				const pad = " ".repeat(Math.max(0, options.outputPad ?? 0));
				const w = Math.max(1, width - pad.length);
				const rows = lines();
				const hint = options.keyHint ? `  ${options.keyHint("app.tools.expand", "full text")}` : "";
				return rows.map((l, i) => pad + truncateToWidth(theme.fg("dim", l) + (i === rows.length - 1 ? theme.fg("dim", hint) : ""), w));
			},
		};
	};
	pi.registerMessageRenderer(WATCH, (message: any, options, theme) => oneLiners(() => watchLines(message.details))(message, options, theme));
	pi.registerMessageRenderer(DIRECT, (message: any, options, theme) =>
		oneLiners(() => [directLine(bodyText(message).replace(/^Message from the person in Main, sent to you directly:\n/, ""))])(message, options, theme),
	);

	// ---------- Command ----------

	function present(action: string, c: ExtensionContext): string {
		if (action === "status") {
			if (me) return `${me.name} · ${childState}\nModel: ${me.model} · thinking ${me.thinking}\nTools: ${me.allowed.join(", ") || "none"}\nJob: ${me.job}`;
			const rows = [...links.values()].map((l) => `${l.owner.name} · ${l.state} · ${l.owner.model} · ${l.owner.allowed.join(",") || "no tools"}${l.pane ? ` · pane ${l.pane}` : ""}`);
			return [...(rows.length ? rows : ["No agents linked. /agent lists what you can open."]), `${plural(inbox.size, "agent note")} waiting · /agent inbox`].join("\n");
		}
		if (action === "inbox") {
			if (me) return "Only Main has an inbox. Send to it with /agent send main #N.";
			if (!inbox.size) return "No agent notes waiting.";
			return [`${plural(inbox.size, "agent note")} waiting; they join your next prompt:`, ...[...inbox.values()].map((n) => `\n${n.name} · ${n.text}`)].join("\n");
		}
		return "";
	}

	pi.registerCommand("agent", {
		// pi 1.5.2 drops argumentHint for extension commands, so the hint leads the description.
		description: `${ARG_HINT}  Agent in a pane beside Main · --help`,
		getArgumentCompletions: (prefix: string) => (ctx ? completions(prefix, state()) : null),
		handler: async (raw, c) => {
			try {
				const p = parseArgs(raw, { child: !!me });
				switch (p.action) {
					case "list":
						return c.ui.notify(listing(state()), "info");
					case "help":
						return c.ui.notify(guide(p.topic, !!me), "info");
					case "status":
					case "inbox":
						return c.ui.notify(present(p.action, c), "info");
					case "stop": {
						if (me) {
							if (!parent) return c.ui.notify(`${me.name} is not linked (${childState}).`, "info");
							disconnectChild("disconnected: stopped", true);
							return c.ui.notify(`${me.name}: link to Main ended. This pane stays open.`, "info");
						}
						const targets = [...links.values()].filter((l) => active(l) && (!p.target || l.owner.name.toLowerCase() === p.target.toLowerCase()));
						if (!targets.length) throw new Error(p.target ? `No linked agent named ${p.target}. See /agent status.` : "No agents are linked.");
						for (const l of targets) l.end("disconnected: stopped from Main");
						return c.ui.notify(`Ended: ${targets.map((l) => l.owner.name).join(", ")}. The panes stay open.`, "info");
					}
					case "send": {
						if (me) {
							const text = pickItems(lastReply, p.text, me.name) ?? clean(p.text);
							if (text.length > NOTE_LIMIT) throw new Error(`The note is ${text.length} characters; Main accepts up to 2,400.`);
							const receipt = await sendToMain(text);
							tray?.markSent(text);
							return c.ui.notify(`Sent to Main · ${receipt?.state ?? "received"}`, "info");
						}
						const text = clean(p.text);
						if (text.length > NOTE_LIMIT) throw new Error("Use a message of at most 2,400 characters.");
						const all = p.target.toLowerCase() === "all";
						const targets = [...links.values()].filter((l) => active(l) && (all || l.owner.name.toLowerCase() === p.target.toLowerCase()));
						if (!targets.length) throw new Error(all ? "No agents are linked." : `No linked agent named ${p.target}. See /agent status.`);
						const results = await Promise.all(
							targets.map(async (l) => {
								if (l.state !== "watching" || !l.peer) return `${l.owner.name}: still opening; try again in a moment`;
								try {
									return `${l.owner.name}: ${(await l.peer.call("direct", { text }))?.state ?? "accepted"}`;
								} catch (e) {
									return `${l.owner.name}: not delivered (${errorText(e)})`;
								}
							}),
						);
						return c.ui.notify(results.join("\n"), results.some((r) => /not delivered|still opening/.test(r)) ? "warning" : "info");
					}
					case "open": {
						const r: any = await openAgent(p, c);
						if (r?.cancelled) return c.ui.notify("No model chosen; no pane opened.", "info");
						return c.ui.notify(`${r.name} · opening beside Main (${r.model}, thinking ${r.thinking}; tools: ${r.tools.join(", ") || "none"}).`, "info");
					}
				}
			} catch (e) {
				c.ui.notify(`/agent: ${errorText(e)}`, "error");
			}
		},
	});
}
