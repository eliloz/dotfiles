// The two unattended stages: implement a ticket, review its branch.
// The script decides and checks; the model only does the work and answers.
import * as path from "node:path";
import { createSandbox, type Sandbox } from "@ai-hero/sandcastle";
import * as fs from "node:fs";
import { agent } from "./agent.ts";
import { extract, extractionPrompt, reviewSchema, type Finding } from "./findings.ts";
import {
  PROMPTS,
  checkList,
  fail,
  featureDir,
  localPaths,
  git,
  logsDir,
  readRecord,
  readSettings,
  runner,
  ticket,
  writeRecord,
  type Settings,
  type StageResult,
  type Ticket,
} from "./project.ts";

export const branchExists = (b: string) => {
  try {
    git("rev-parse", "--verify", "--quiet", `refs/heads/${b}`);
    return true;
  } catch {
    return false;
  }
};

// `spec` is the ticket (or the bench's spec): its feature folder and AGENTS.md
// are copied in when they live only on this Mac.
const open = (branch: string, settings: Settings, spec: string, base?: string) =>
  createSandbox({
    branch,
    copyToWorktree: localPaths([featureDir(spec), "AGENTS.md"]),
    ...(base ? { baseBranch: base } : {}),
    sandbox: runner(),
    hooks: {
      // One command: Sandcastle runs separate hooks at the same time, not in order.
      sandbox: { onSandboxReady: [{ command: settings.setup, timeoutMs: 900_000 }] },
    },
  });

// The factory's own Checks, run in the runner after the agent: what the agent
// claims is not taken on trust.
async function runChecks(sandbox: Sandbox, settings: Settings) {
  const results: Record<string, boolean> = {};
  for (const command of settings.checks) {
    const { exitCode } = await sandbox.exec(command);
    results[command] = exitCode === 0;
    console.log(`check ${exitCode === 0 ? "✓" : "✗"} ${command}`);
  }
  return results;
}

const commitsSince = (from: string, branch: string) =>
  git("rev-list", "--reverse", `${from}..refs/heads/${branch}`).split("\n").filter(Boolean);

function finish(
  started: number,
  problems: string[],
  commits: string[],
  checks: Record<string, boolean>
): StageResult {
  for (const [command, ok] of Object.entries(checks)) if (!ok) problems.push(`check failed: ${command}`);
  return {
    ok: problems.length === 0,
    problems,
    commits,
    checks,
    seconds: Math.round((Date.now() - started) / 1000),
    finished: new Date().toISOString(),
  };
}

// `factory implement <ticket>`: the stage alone, on the ticket's own branch.
export async function implement(file: string | undefined) {
  const t = ticket(file);
  localPaths([featureDir(t.path), "AGENTS.md"]);
  const from = currentBranch();
  if (branchExists(t.branch)) {
    fail(`${t.branch} exists already. Review it, or delete it to start over: git branch -D ${t.branch}`);
  }
  const result = await implementOn(t, t.branch, from);
  if (!result.ok) fail(`FAILED: ${result.problems.join("; ")}`);
  console.log(`OK. Next: factory review ${t.path}`);
}

export function currentBranch() {
  const from = git("branch", "--show-current");
  if (!from) fail("check out a branch first: HEAD is detached");
  return from;
}

// The implement stage on `branch`: a new branch from HEAD, or an existing one
// from its tip (a feature run, where each ticket builds on the one before).
// Writes the ticket's record and returns the result; never exits.
export async function implementOn(t: Ticket, branch: string, from: string): Promise<StageResult> {
  const settings = readSettings();
  const base = git("rev-parse", branchExists(branch) ? `refs/heads/${branch}` : "HEAD");
  const started = Date.now();
  console.log(`implement ${t.path} on ${branch}, from ${from} (${base.slice(0, 7)})`);

  const sandbox = await open(branch, settings, t.path, base);
  const problems: string[] = [];
  let checks: Record<string, boolean> = {};
  try {
    await sandbox.run({
      agent,
      name: "implement",
      promptFile: path.join(PROMPTS, "implement.md"),
      promptArgs: { TICKET_PATH: t.path, CHECKS: checkList(settings) },
      logging: { type: "stdout" },
    });
    checks = await runChecks(sandbox, settings);
  } catch (error) {
    problems.push(`the run stopped: ${(error as Error).message}`);
  } finally {
    const closed = await sandbox.close();
    if (closed.preservedWorktreePath) problems.push(`uncommitted changes left in ${closed.preservedWorktreePath}`);
  }
  const commits = commitsSince(base, branch);
  if (commits.length === 0) problems.unshift("no commit");
  const result = finish(started, problems, commits, checks);
  writeRecord(t, { ticket: t.path, branch, from, base, implement: result });

  console.log(`commits: ${commits.map((c) => c.slice(0, 7)).join(", ") || "none"} · ${result.seconds}s`);
  return result;
}

export interface ReviewOptions {
  ticket?: string;
  // The bench's form: an existing branch, no run record.
  branch?: string;
  base?: string;
  spec?: string;
  out?: string;
}

// `factory review`: the stage alone. Exits on failure.
export async function review(options: ReviewOptions) {
  const { result, from, base, branch } = await reviewStage(options);
  if (!result.ok) fail(`FAILED: ${result.problems.join("; ")}`);
  console.log(`OK. Read it: git diff ${from ?? base.slice(0, 7)}...${branch}`);
}

// The review stage. Writes the record (or --out) and returns the result; never exits
// on a failed run, only on wrong arguments.
export async function reviewStage(options: ReviewOptions) {
  const settings = readSettings();
  let branch: string, base: string, spec: string;
  const t = options.ticket ? ticket(options.ticket) : undefined;
  const record = t ? readRecord(t) : undefined;
  if (t) {
    if (!record) fail(`no record of ${t.path} in .sandcastle/runs/: run 'factory implement ${t.path}' first`);
    ({ branch, base } = record);
    spec = t.path;
  } else {
    if (!options.branch || !options.base || !options.spec || !options.out) {
      fail("review takes a ticket, or all of --branch, --base, --spec and --out");
    }
    ({ branch, base, spec } = options as Required<ReviewOptions>);
  }
  if (!branchExists(branch)) fail(`no branch ${branch}`);
  const baseSha = git("rev-parse", "--verify", `${base}^{commit}`);
  const reviewed = git("rev-parse", `refs/heads/${branch}`);
  const started = Date.now();
  const logging = {
    type: "file" as const,
    path: path.join(logsDir(), `review-${branch.replaceAll("/", "-")}-${new Date().toISOString().replace(/[:.]/g, "")}.log`),
  };
  console.log(`review ${branch} against ${spec}, since ${baseSha.slice(0, 7)} (log ${logging.path})`);

  const sandbox = await open(branch, settings, spec);
  const problems: string[] = [];
  let checks: Record<string, boolean> = {};
  let findings: Finding[] = [];
  try {
    const work = await sandbox.run({
      agent,
      name: "review",
      promptFile: path.join(PROMPTS, "review.md"),
      promptArgs: { BASE: baseSha, SPEC: spec, BRANCH: branch, REVIEWED: reviewed, CHECKS: checkList(settings) },
      logging,
    });
    findings = await answer(work, logging);
    checks = await runChecks(sandbox, settings);
  } catch (error) {
    problems.push(`the run stopped: ${(error as Error).message}`);
  } finally {
    const closed = await sandbox.close();
    if (closed.preservedWorktreePath) problems.push(`uncommitted changes left in ${closed.preservedWorktreePath}`);
  }
  const commits = commitsSince(reviewed, branch);
  const result = { ...finish(started, problems, commits, checks), findings };

  if (t && record) writeRecord(t, { ...record, review: result });
  if (options.out) {
    fs.writeFileSync(
      options.out,
      JSON.stringify({ branch, base: baseSha, reviewed, spec, ...result }, null, 2) + "\n"
    );
  }

  const left = findings.filter((f) => f.status === "left");
  console.log(
    `findings: ${findings.length} (${findings.length - left.length} fixed, ${left.length} left for you) · commits: ${commits.length} · ${result.seconds}s`
  );
  for (const f of left) console.log(`  left: ${f.path}:${f.line} ${f.title}`);
  return { result, from: record?.from, base: baseSha, branch };
}

// The same session, asked for its findings as JSON; one retry.
type Resumable = { stdout: string; resume?: (prompt: string, o?: object) => Promise<Resumable> };
async function answer(work: Resumable, logging: object): Promise<Finding[]> {
  if (!work.resume) throw new Error("the review left no session to resume");
  let reply = await work.resume(extractionPrompt("findings", reviewSchema), { logging });
  try {
    return extract(reply.stdout, "findings", reviewSchema).findings;
  } catch (error) {
    if (!reply.resume) throw error;
    reply = await reply.resume(
      `That reply could not be used: ${(error as Error).message}. ${extractionPrompt("findings", reviewSchema)}`,
      { logging }
    );
    return extract(reply.stdout, "findings", reviewSchema).findings;
  }
}
