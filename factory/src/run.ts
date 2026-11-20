// `factory run`: implement, then review, on one ticket or on every ticket of a
// feature. See ../README.md, "A typical feature".
//
// A feature runs on one branch, agent/<feature>, in ticket-number order
// (to-tickets numbers blockers first), each ticket from the tip the one before
// left. A ticket alone runs on agent/<feature>-NN-<slug>, from HEAD.
// A rerun skips what is done and retries a failed stage only when it left no
// commits; otherwise it prints the reset and stops, so nothing is thrown away
// without the person.
import * as fs from "node:fs";
import * as path from "node:path";
import { fail, featureDir, git, localPaths, readRecord, ticket, type Ticket } from "./project.ts";
import { branchExists, currentBranch, implementOn, reviewStage } from "./stages.ts";

export async function run(target: string | undefined) {
  if (!target) fail("name a feature folder (.scratch/<feature>) or a ticket file (.scratch/<feature>/issues/NN-<slug>.md)");
  if (!fs.existsSync(target)) fail(`no such feature or ticket: ${target}`);

  let tickets: Ticket[];
  let branch: string;
  if (fs.statSync(target).isFile()) {
    const t = ticket(target);
    tickets = [t];
    branch = t.branch;
  } else {
    const issues = path.basename(path.resolve(target)) === "issues" ? target : path.join(target, "issues");
    if (!fs.existsSync(issues)) fail(`no ${issues}/: a feature's tickets live in .scratch/<feature>/issues/`);
    tickets = fs
      .readdirSync(issues)
      .filter((f) => /^\d+-.+\.md$/.test(f))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b))
      .map((f) => ticket(path.join(issues, f)));
    if (tickets.length === 0) fail(`no tickets (NN-<slug>.md) in ${issues}/`);
    branch = `agent/${tickets[0].feature}`;
  }

  // Committed, or kept local and copied into each runner: fail early if neither.
  localPaths([featureDir(tickets[0].path), "AGENTS.md"]);
  const from = currentBranch();
  if (from === branch) fail(`you are on ${branch}: check out the branch it should start from`);

  // A ticket's record belongs to one branch: the feature's, or its own.
  const records = tickets.map((t) => readRecord(t));
  tickets.forEach((t, i) => {
    const r = records[i];
    if (r && r.branch !== branch) {
      fail(`${t.path} was run on ${r.branch}, not ${branch}. To run it here, delete ${t.record}`);
    }
  });
  if (branchExists(branch) && records.every((r) => !r)) {
    fail(`${branch} exists with no record of these tickets. Delete it to start over: git branch -D ${branch}`);
  }

  console.log(`run ${tickets.length} ticket${tickets.length === 1 ? "" : "s"} on ${branch}, from ${from}`);
  const left: string[] = [];
  for (const t of tickets) {
    let r = readRecord(t);
    if (r?.implement?.ok && r.review?.ok) {
      console.log(`\n── ${t.name}: done already, skipped`);
      continue;
    }
    console.log(`\n── ${t.name}`);
    const tip = () => (branchExists(branch) ? git("rev-parse", `refs/heads/${branch}`) : undefined);

    if (!r?.implement?.ok) {
      if (r?.implement) {
        const t0 = tip();
        if (t0 !== undefined && t0 !== r.base) stopAt(t, "implement", branch, r.base);
      }
      const result = await implementOn(t, branch, from);
      if (!result.ok) failed(t, "implement", result.problems);
      r = readRecord(t)!;
    }

    if (r.review && !r.review.ok) {
      const start = r.implement!.commits.at(-1) ?? r.base;
      if (tip() !== start) stopAt(t, "review", branch, start);
    }
    const { result } = await reviewStage({ ticket: t.path });
    if (!result.ok) failed(t, "review", result.problems);
    for (const f of result.findings) if (f.status === "left") left.push(`${t.name}  ${f.path}:${f.line} ${f.title}`);
  }

  console.log(`\nOK: ${branch}, ${tickets.length} ticket${tickets.length === 1 ? "" : "s"} implemented and reviewed.`);
  if (left.length) {
    console.log(`Left for you (${left.length}):`);
    for (const l of left) console.log(`  ${l}`);
  } else {
    console.log("Nothing left for you from the reviews of this run.");
  }
  console.log(`Read it:  git log --oneline ${from}..${branch}  ·  git diff ${from}...${branch}`);
  console.log(`Then:     git merge ${branch}`);
}

function failed(t: Ticket, stage: string, problems: string[]): never {
  fail(`FAILED at ${t.name}, ${stage}: ${problems.join("; ")}\nRead what it printed, then run the same 'factory run' again to retry.`);
}

// A failed stage left commits: the person decides whether to drop them.
function stopAt(t: Ticket, stage: string, branch: string, start: string): never {
  fail(
    `${t.name}'s ${stage} failed last time and its commits are still on ${branch}.\n` +
      `Read them: git log --oneline ${start.slice(0, 7)}..${branch}\n` +
      `To retry the ${stage}, drop them and run again: git branch -f ${branch} ${start.slice(0, 7)}`
  );
}
