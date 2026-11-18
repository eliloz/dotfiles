/**
 * Herdr: find the pane running Main, and open a pane beside it. Adapted from /split.
 * Every path and value travels as an argv element, never as shell source.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Exec = ExtensionAPI["exec"];
const TIMEOUT_MS = 15_000;

export const NEEDS_HERDR =
	"/agent opens its pane with Herdr. Run Pi inside a Herdr app pane (hc and herdr-app on PATH), then try again. /agent --help works anywhere.";

async function run(exec: Exec, cmd: string, args: string[], cwd: string): Promise<string> {
	let r: Awaited<ReturnType<Exec>>;
	try {
		r = await exec(cmd, args, { cwd, timeout: TIMEOUT_MS });
	} catch (e) {
		throw new Error(`could not run ${cmd} (${e instanceof Error ? e.message : String(e)}). ${NEEDS_HERDR}`);
	}
	if (r.code !== 0) {
		if (r.code === 127 || /ENOENT|not found/i.test(r.stderr)) throw new Error(`${cmd} is not on PATH. ${NEEDS_HERDR}`);
		throw new Error(`${cmd} ${args.slice(0, 2).join(" ")} failed: ${(r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).slice(0, 220)}`);
	}
	return r.stdout;
}

const json = async (exec: Exec, cmd: string, args: string[], cwd: string) => JSON.parse(await run(exec, cmd, args, cwd));

/** The Herdr app pane showing this terminal. Throws instead of guessing. */
export async function findMainPane(exec: Exec, cwd: string): Promise<string> {
	const terminal = process.env.HC_TERMINAL_ID;
	if (!terminal) throw new Error(NEEDS_HERDR);
	const record = await json(exec, "hc", ["get", terminal, "--json"], cwd);
	const space = record?.labels?.["herdr.space"];
	if (record?.address !== terminal || typeof space !== "string") throw new Error(`Terminal ${terminal} is not shown in a Herdr app space. No pane opened.`);
	const listing = await json(exec, "herdr-app", ["ls"], cwd);
	const panes: string[] = [];
	for (const s of listing?.spaces ?? []) {
		if (s.id !== space || s.machine) continue;
		for (const t of s.tabs ?? []) for (const p of t.terminals ?? []) if (p.terminal === terminal && typeof p.pane === "string" && p.pane) panes.push(p.pane);
	}
	if (panes.length !== 1) throw new Error(`Expected exactly one Herdr pane for terminal ${terminal}, found ${panes.length}. No pane opened.`);
	return panes[0];
}

/**
 * Split `pane` to the right and run `command` in `cwd` with `env` added. Herdr focuses a new
 * split; if Main had focus, give it back so typing in Main carries on. Returns the new pane id.
 */
export async function openPane(exec: Exec, cwd: string, pane: string, command: string[], env: Record<string, string>): Promise<string> {
	const before = await json(exec, "herdr-app", ["status"], cwd).catch(() => undefined);
	const vars = Object.entries(env).map(([k, v]) => `${k}=${v}`);
	// pane.split has no folder argument: cd first, then exec. $1 is the folder, the rest is argv.
	const argv = ["/bin/sh", "-c", 'cd "$1" && shift && exec "$@"', "agent", cwd, "/usr/bin/env", ...vars, ...command];
	const out = await json(exec, "herdr-app", ["do", "pane.split", JSON.stringify({ pane, direction: "right", argv })], cwd);
	if (typeof out?.pane !== "string" || !out.pane || out.pane === pane) throw new Error(`Herdr did not report a new pane: ${JSON.stringify(out).slice(0, 200)}`);
	if (before?.focused_pane === pane) {
		const after = await json(exec, "herdr-app", ["status"], cwd).catch(() => undefined);
		if (after?.focused_pane === out.pane && after.space === before.space && after.tab === before.tab) {
			await run(exec, "herdr-app", ["do", "pane.focus", JSON.stringify({ pane })], cwd).catch(() => {});
		}
	}
	return out.pane;
}
