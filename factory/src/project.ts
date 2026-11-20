// The project a factory command runs in: its root, its settings, its tickets.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { z } from "zod/v4";

export const FACTORY_DIR = path.resolve(import.meta.dirname, "..");
export const PROMPTS = path.join(FACTORY_DIR, "prompts");
export const TEMPLATES = path.join(FACTORY_DIR, "templates");
// The global skills, from dotfiles itself: the stowed ~/.agents/skills holds
// links into this folder, which would dangle inside a container.
export const SKILLS = path.resolve(FACTORY_DIR, "..", "agents", ".agents", "skills");

export function fail(message: string): never {
  console.error(`factory: ${message}`);
  process.exit(1);
}

export const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// Sandcastle anchors everything on the working directory, so every command
// runs from the repository's root.
export function enterRoot(): string {
  let root: string;
  try {
    root = git("rev-parse", "--show-toplevel");
  } catch {
    fail("not inside a git repository");
  }
  process.chdir(root);
  return root;
}

export const settingsSchema = z.strictObject({
  setup: z.string().min(1).describe("Runs once in each runner before the agent starts."),
  checks: z
    .array(z.string().min(1))
    .min(1)
    .describe("Commands that must pass after every stage. The prompts name them too."),
});
export type Settings = z.infer<typeof settingsSchema>;

export function readSettings(): Settings {
  const file = path.join(".sandcastle", "factory.json");
  if (!fs.existsSync(file)) fail(`no ${file}: run 'factory init' first`);
  try {
    return settingsSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    fail(`${file} is not valid: ${(error as Error).message}`);
  }
}

// The checks as the prompts show them: one bullet per command.
export const checkList = (settings: Settings) =>
  settings.checks.map((c) => `  - \`${c}\``).join("\n");

// The runner: the project's image, with the global skills mounted read-only
// where Pi looks for them.
export const runner = () =>
  docker({
    mounts: [
      { hostPath: SKILLS, sandboxPath: "/home/agent/.agents/skills", readonly: true },
    ],
  });

// .scratch/<feature>/issues/NN-<slug>.md
export interface Ticket {
  path: string;
  feature: string;
  name: string; // NN-<slug>
  branch: string; // agent/<feature>-NN-<slug>
  record: string; // .sandcastle/runs/<feature>-NN-<slug>.json
}

export function ticket(file: string | undefined): Ticket {
  if (!file) fail("name a ticket file, such as .scratch/<feature>/issues/01-<slug>.md");
  const rel = path.relative(process.cwd(), path.resolve(file));
  if (!fs.existsSync(rel)) fail(`no such ticket: ${file}`);
  const issues = path.dirname(rel);
  if (path.basename(issues) !== "issues") fail(`a ticket lives in .scratch/<feature>/issues/: ${rel}`);
  const feature = path.basename(path.dirname(issues));
  const name = path.basename(rel, ".md");
  return {
    path: rel,
    feature,
    name,
    branch: `agent/${feature}-${name}`,
    record: path.join(".sandcastle", "runs", `${feature}-${name}.json`),
  };
}

// What one ticket's factory runs left: written by implement, extended by review.
export interface RunRecord {
  ticket: string;
  branch: string;
  from: string; // the branch the ticket started from
  base: string; // its commit at that moment
  implement?: StageResult;
  review?: StageResult & { findings: unknown[] };
}
export interface StageResult {
  ok: boolean;
  problems: string[];
  commits: string[];
  checks: Record<string, boolean>;
  seconds: number;
  finished: string;
}

export function readRecord(t: Ticket): RunRecord | undefined {
  return fs.existsSync(t.record) ? JSON.parse(fs.readFileSync(t.record, "utf8")) : undefined;
}

export function writeRecord(t: Ticket, record: RunRecord) {
  fs.mkdirSync(path.dirname(t.record), { recursive: true });
  fs.writeFileSync(t.record, JSON.stringify(record, null, 2) + "\n");
}

export const logsDir = () => {
  const dir = path.join(".sandcastle", "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

export const tildify = (p: string) => p.replace(os.homedir(), "~");

// What the runner needs from the project that may live only on this Mac: the
// feature's spec and tickets, and AGENTS.md. Each path is either committed
// (the runner's worktree has it) or wholly untracked: then it stays local,
// is listed in .git/info/exclude so no commit in the runner takes it (the
// runner's git reads that file; a global ignore file it cannot see), and is
// copied into the runner's worktree. Returns the paths to copy.
export function localPaths(paths: string[]): string[] {
  const copy: string[] = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    const tracked = git("ls-files", "--", p) !== "";
    if (tracked) {
      if (git("status", "--porcelain", "--", p) !== "") {
        fail(`${p} is partly committed: commit the rest first, or untrack it all to keep it local`);
      }
      continue;
    }
    exclude(p);
    copy.push(p);
  }
  return copy;
}

function exclude(p: string) {
  const file = git("rev-parse", "--git-path", "info/exclude");
  const line = `/${p.replace(/\/$/, "")}${fs.statSync(p).isDirectory() ? "/" : ""}`;
  const now = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (now.split("\n").includes(line)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = now.includes("# factory: local only") ? "" : "\n# factory: local only, kept out of the repo's commits\n";
  fs.appendFileSync(file, `${now === "" || now.endsWith("\n") ? "" : "\n"}${header}${line}\n`);
  console.log(`local   ${p} (added ${line} to ${file}; never committed)`);
}

// The feature folder of a ticket or spec under .scratch/<feature>/, else the path itself.
export const featureDir = (p: string) => {
  const parts = path.normalize(p).split(path.sep);
  return parts[0] === ".scratch" && parts.length > 2 ? path.join(parts[0], parts[1]) : p;
};
