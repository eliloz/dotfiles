// The bench: tests a headless factory stage (review, later implement) the way the lab tests a skill.
// One bench run: a branch built from the stage's base commit plus the case's patch, the stage's
// command run on it, then the case's Check lines run in the factory image on the result (with the
// hidden acceptance test copied in), and its Expect and Never lines judged by a model that sees only
// the ticket, the change under review and the stage's output. Reuses the lab's expectations format,
// verdict rule (a pass needs a quote that is really in the output), report shape and --runs tally.
//
// Layout in the project (the fixture):
//   .sandcastle/bench/<stage>/stage.json         base, spec, hidden test, image, setup, command
//   .sandcastle/bench/<stage>/<case>/change.patch  the change under test, from base
//   .sandcastle/bench/<stage>/<case>/expectations.md
//   .sandcastle/bench/<stage>/<case>/reports/     one report per bench run (gitignored)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse, decide, checks, judged } from './expectations.mjs';
import { runsSummary } from './report.mjs';
import { defaultModel } from './core.mjs';

export const BENCH = '.sandcastle/bench';
export const BENCH_HOME = process.env.BENCH_HOME || path.join(os.homedir(), '.lab', 'bench');
const NAME = /^[a-z][a-z0-9-]{0,47}$/;

const sh = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...o });
  if (o.check !== false && r.status !== 0) throw Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${(r.stderr || r.stdout || '').trim().slice(-800)}`);
  return r;
};
const git = (cwd, ...args) => sh('git', args, { cwd }).stdout.trim();
const stamp = d => d.toISOString().replace(/:/g, '').replace(/\..*$/, '').replace('T', '-');
const fence = s => '~~~text\n' + String(s).replace(/~~~/g, '~ ~ ~').replace(/\s+$/, '') + '\n~~~';

/** The stage's settings and one case's files. Throws with what is missing. */
export function locateCase(project, stage, name) {
  if (!NAME.test(String(stage || ''))) throw Error(`"${stage}" is not a stage. Name a folder in ${BENCH}/, such as review.`);
  const stageDir = path.join(project, BENCH, stage), stageFile = path.join(stageDir, 'stage.json');
  if (!fs.existsSync(stageFile)) throw Error(`No ${BENCH}/${stage}/stage.json in ${project}.`);
  const settings = JSON.parse(fs.readFileSync(stageFile, 'utf8'));
  for (const k of ['base', 'image', 'command']) if (!settings[k]) throw Error(`${BENCH}/${stage}/stage.json needs "${k}".`);
  const cases = fs.readdirSync(stageDir).filter(d => fs.existsSync(path.join(stageDir, d, 'expectations.md'))).sort();
  if (!name) return { stageDir, settings, cases };
  if (!cases.includes(name)) throw Error(`No case "${name}" in ${BENCH}/${stage}/. Cases: ${cases.join(', ') || 'none'}.`);
  const dir = path.join(stageDir, name);
  return { stageDir, settings, cases, dir, patch: path.join(dir, 'change.patch'), expectations: path.join(dir, 'expectations.md') };
}

/** {name} placeholders in the stage command; an unknown one is an error, not an empty string. */
export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in vars)) throw Error(`stage.json command uses {${k}}, which the bench does not set. It sets ${Object.keys(vars).join(', ')}.`);
    return String(vars[k]);
  });
}

/**
 * The branch the stage gets: base plus the case's patch, one commit by "bench". The bench's own folder
 * must not be in it (hidden tests, expectations): a stage that can read its test proves nothing.
 */
export function caseBranch(project, base, patch, branch) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-case-'));
  const wt = path.join(tmp, 'wt');
  git(project, 'worktree', 'add', '-q', '--detach', wt, base);
  try {
    if (fs.statSync(patch).size > 0) git(wt, 'apply', '--index', patch);
    const leaked = git(wt, 'ls-files', '--', BENCH);
    if (leaked) throw Error(`The case branch would contain ${BENCH}/ (${leaked.split('\n')[0]} …): pick a base before the bench existed.`);
    git(wt, '-c', 'user.name=bench', '-c', 'user.email=bench@localhost', 'commit', '-q', '--allow-empty', '-m', `bench: ${path.basename(path.dirname(patch))}`);
    const sha = git(wt, 'rev-parse', 'HEAD');
    git(project, 'branch', '-f', branch, sha);
    return sha;
  } finally {
    git(project, 'worktree', 'remove', '--force', wt);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The shell script run in the factory image: setup once, then each Check (its own file, check-<i>.sh), results as JSON lines. */
export function checkScript(setup, count) {
  const lines = ['set -u', 'git config --global --add safe.directory "*" >/dev/null 2>&1', 'cd /home/agent/workspace',
    `if ! ( ${setup || 'true'} ) >/bench/setup.log 2>&1; then echo '{"setup":"failed"}'; exit 0; fi`];
  for (let i = 0; i < count; i++) lines.push(`bash /bench/check-${i}.sh >/bench/check-${i}.log 2>&1; echo "{\\"i\\":${i},\\"status\\":$?}"`);
  return lines.join('\n') + '\n';
}

/** Run every Check line of the case in the image, on the branch's final state. */
export function runChecks({ project, settings, branch, runDir, items }) {
  const list = items.flatMap(i => checks(i));
  if (!list.length) return [];
  const wt = path.join(runDir, 'checked');
  git(project, 'worktree', 'add', '-q', '--detach', wt, branch);
  try {
    if (settings.hidden) {
      const to = path.join(wt, settings.hidden.to);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(project, settings.hidden.from), to);
    }
    list.forEach((c, i) => fs.writeFileSync(path.join(runDir, `check-${i}.sh`), c.text + '\n'));
    fs.writeFileSync(path.join(runDir, 'checks.sh'), checkScript(settings.setup, list.length));
    const gitDir = git(project, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    const r = sh('docker', ['run', '--rm', '-e', 'NO_COLOR=1', '-e', `BASE=${settings.base}`, '-e', 'FINDINGS=/bench/output.json',
      '--entrypoint', 'bash', '-v', `${gitDir}:${gitDir}`, '-v', `${wt}:/home/agent/workspace`, '-v', `${runDir}:/bench`,
      settings.image, '/bench/checks.sh'], { check: false, timeout: 30 * 60_000 });
    const rows = (r.stdout || '').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
    if (rows.some(x => x.setup)) throw Error(`Check setup failed in the image; see ${runDir}/setup.log`);
    return list.map((c, i) => {
      const row = rows.find(x => x.i === i);
      let output = '';
      try { output = fs.readFileSync(path.join(runDir, `check-${i}.log`), 'utf8').slice(-3000); } catch {}
      return { line: c.line, command: c.text, status: row ? row.status : 'not run', ok: row?.status === 0, output };
    });
  } finally {
    git(project, 'worktree', 'remove', '--force', wt);
  }
}

/** The judge's prompt. It never sees the stage's prompt or the case's planted-defect note. */
export function judgePrompt({ ticket, diff, output, items }) {
  const asks = items.filter(i => judged(i).length).map(i =>
    `${i.id}. ${i.title}\n${judged(i).map(l => `   ${l.kind === 'expect' ? 'Expect' : 'Never'}: ${l.text}`).join('\n')}`);
  return [
    'You judge the output of one unattended code-review run. You see the ticket the change was built for, the change as it was reviewed, and the review\'s output. Judge only from these.',
    '', '## Ticket', '', ticket || '(none)', '', '## The change as reviewed', '', '```diff', diff, '```',
    '', '## The review\'s output (JSON)', '', '```json', output, '```',
    '', '## Expectations', '', 'An Expect line must be true of the output. A Never line must not happen in it. An expectation passes only if all its lines hold.', '', ...asks,
    '', 'For each expectation, quote evidence copied character for character from the review\'s output (a title or a body). A pass needs a quote; quote the part that shows the expectation holds. Fail when the output only hints at it.',
    '', 'Reply with one <verdicts> block and nothing else:', '<verdicts>', '[{"id": 1, "verdict": "pass", "quote": "...", "reason": "one sentence"}]', '</verdicts>',
  ].join('\n');
}

export function parseVerdicts(text) {
  const end = text.lastIndexOf('</verdicts>'), start = end < 0 ? -1 : text.lastIndexOf('<verdicts>', end);
  if (start < 0) throw Error('the judge gave no <verdicts> block');
  let raw = text.slice(start + '<verdicts>'.length, end).trim();
  const f = /^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/.exec(raw); if (f) raw = f[1];
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw Error('the judge\'s verdicts are not a list');
  return list;
}

function judge({ prompt, model, runDir }) {
  fs.writeFileSync(path.join(runDir, 'judge-prompt.md'), prompt);
  const args = ['-p', '--no-tools', '--no-skills', '--no-extensions', '--no-session', ...(model ? ['--model', model] : []), prompt];
  const r = sh('pi', args, { check: false, input: '', timeout: 10 * 60_000 });
  fs.writeFileSync(path.join(runDir, 'judge-reply.md'), `${r.stdout || ''}\n${r.stderr || ''}`);
  if (r.status !== 0) throw Error(`the judge (pi) exited ${r.status}: ${(r.stderr || '').trim().slice(-400)}`);
  return parseVerdicts(r.stdout);
}

/**
 * The stage's output as the text a quote is checked against: every string in the JSON, unescaped, one per line.
 * The judge quotes a finding as it reads it; in the raw JSON its quotes and line breaks are escaped (\" and \n),
 * and fold() would keep the n of \n, so a faithful quote would not match. Output that is not JSON is used as it is.
 */
export function quotable(output) {
  let value;
  try { value = JSON.parse(output); } catch { return String(output || ''); }
  const out = [];
  const walk = v => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(value);
  return out.join('\n');
}

/** Every item's verdict, by the lab's own rule: Checks decide, and a judged pass needs a quote that is in the output. */
export function verdicts(items, ran, said, output) {
  output = quotable(output);
  return items.map(item => {
    const v = said.find(x => Number(x.id) === item.id);
    const p = judged(item).length ? { verdict: v?.verdict === 'pass' ? 'pass' : 'fail', evidence: v?.quote ? [{ pane: 'Review', quote: v.quote }] : [] } : { verdict: 'pass' };
    let reason = v?.reason || (judged(item).length ? 'The judge gave no verdict.' : '');
    let out;
    try { out = decide(item, p, { Review: output }, {}, ran); }
    catch (e) { reason = `${reason} (Overruled: ${e.message})`.trim(); out = decide(item, { verdict: 'fail', evidence: [] }, { Review: output }, {}, ran); }
    return { id: item.id, title: item.title, verdict: out.verdict, tester: judged(item).length ? p.verdict : undefined, reason,
      evidence: p.evidence, observed: out.observed, checks: ran.filter(r => checks(item).some(c => c.line === r.line)) };
  });
}

export function reportText({ stage, name, id, when, settings, branch, reviewed, final, extra, results, stageExit, output, fixes, model }) {
  const failed = results.filter(r => r.verdict !== 'pass').length;
  const lines = [`# Bench ${stage} · ${name}`, '', `**${failed ? `${failed} of ${results.length} expectations failed` : 'All expectations met'}** · ${when.toLocaleString()} · run \`${id}\``, '',
    `Base \`${settings.base}\` · case commit \`${reviewed.slice(0, 7)}\` · final \`${final.slice(0, 7)}\` · branch \`${branch}\``,
    `Stage command exited ${stageExit}${extra.length ? ` · extra arguments \`${extra.join(' ')}\`` : ''} · judge \`${model || 'Pi default'}\``, ''];
  for (const r of results) {
    lines.push(`## ${r.verdict === 'pass' ? '✓' : '✗'} ${r.id} · ${r.title}`, '', r.reason || '', '');
    for (const e of r.evidence || []) lines.push(`- Output: “${e.quote}”`);
    for (const o of r.observed || []) {
      lines.push(`- Check ${o.ok ? '✓' : '✗'} \`${o.text}\` exited ${o.status}`);
      const c = r.checks.find(x => x.command === o.text);
      if (!o.ok && c?.output?.trim()) lines.push('', fence(c.output.slice(-1500)), '');
    }
    if (r.tester && r.tester !== r.verdict) lines.push(`- The judge said ${r.tester}; the bench decided ${r.verdict}.`);
    lines.push('');
  }
  lines.push('## The stage\'s output', '', fence(output || '(none)'), '', '## What the stage changed', '', fence(fixes || '(no commits)'), '');
  return lines.join('\n');
}

/** One bench run of one case. Returns { code, res } for runsSummary: 0 all met, 1 a failure, 2 no report. */
export function benchRun({ project, stage, name, extra = [], keep = false, model = defaultModel(), log = console.log }) {
  const c = locateCase(project, stage, name);
  const spec = parse(fs.readFileSync(c.expectations, 'utf8'), 'Review');
  const when = new Date(), id = `${name}-${stamp(when)}`;
  const runDir = path.join(BENCH_HOME, id); fs.mkdirSync(runDir, { recursive: true });
  const branch = `bench/${stage}-${id}`;
  const reviewed = caseBranch(project, c.settings.base, c.patch, branch);
  log(`${name}: branch ${branch} at ${reviewed.slice(0, 7)}; running the stage (log ${runDir}/stage.log)`);
  const outFile = path.join(runDir, 'output.json');
  const cmd = `${fill(c.settings.command, { branch, base: c.settings.base, spec: c.settings.spec || '', out: outFile })} ${extra.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;
  const logFd = fs.openSync(path.join(runDir, 'stage.log'), 'w');
  const st = spawnSync('sh', ['-c', cmd], { cwd: project, stdio: ['ignore', logFd, logFd] });
  fs.closeSync(logFd);
  const final = git(project, 'rev-parse', branch);
  const output = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  log(`${name}: stage exited ${st.status}; running ${spec.items.flatMap(i => checks(i)).length} Checks in ${c.settings.image}`);
  const ran = runChecks({ project, settings: c.settings, branch, runDir, items: spec.items });
  let said = [];
  if (spec.items.some(i => judged(i).length)) {
    const ticket = c.settings.spec ? git(project, 'show', `${reviewed}:${c.settings.spec}`) : '';
    const diff = git(project, 'diff', `${c.settings.base}...${reviewed}`);
    try { said = judge({ prompt: judgePrompt({ ticket, diff, output: output || '(the stage wrote no output)', items: spec.items }), model, runDir }); }
    catch (e) { log(`${name}: ${e.message}`); }
  }
  const results = verdicts(spec.items, ran, said, output);
  const fixes = git(project, 'log', '--stat', '--format=%h %s', `${reviewed}..${final}`);
  const reportsDir = path.join(c.dir, 'reports'); fs.mkdirSync(reportsDir, { recursive: true });
  const report = path.join(reportsDir, `${id}.md`);
  fs.writeFileSync(report, reportText({ stage, name, id, when, settings: c.settings, branch, reviewed, final, extra, results, stageExit: st.status, output, fixes, model }));
  if (!keep) git(project, 'branch', '-D', branch);
  const res = { items: results.map(r => ({ id: r.id, title: r.title, verdict: r.verdict })), report };
  return { code: results.every(r => r.verdict === 'pass') ? 0 : 1, res };
}

const HELP = `bench: test a headless factory stage against saved cases (run from the fixture).

  bench <stage>                          list the stage's cases
  bench <stage> <case> [--runs N] [--stop] [--keep] [-- <extra stage arguments>]

  --runs N   run the case N times and tally each expectation (default 1)
  --stop     stop at the first run with a failed expectation
  --keep     keep each run's branch (bench/<stage>-<case>-<time>) for inspection
  Extra arguments after -- go to the stage command, e.g. -- --approach c.

Cases live in ${BENCH}/<stage>/<case>/ (change.patch, expectations.md); reports in its reports/.
Each run's working files: ${BENCH_HOME}/<run>/.`;

export function main(argv, project = process.cwd()) {
  const dash = argv.indexOf('--'), extra = dash < 0 ? [] : argv.slice(dash + 1), args = dash < 0 ? argv : argv.slice(0, dash);
  const flag = f => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
  const value = f => { const i = args.indexOf(f); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  if (!args.length || flag('--help') || flag('-h')) { console.log(HELP); return 0; }
  const stop = flag('--stop'), keep = flag('--keep'), runs = Number(value('--runs') || 1);
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw Error('--runs takes a whole number from 1 to 20.');
  const [stage, name, ...rest] = args;
  if (rest.length) throw Error(`Unexpected: ${rest.join(' ')}. Stage arguments go after --.`);
  const c = locateCase(project, stage, name);
  if (!name) { console.log(`${stage} cases: ${c.cases.join(', ') || 'none'}`); return 0; }
  const done = [];
  for (let n = 1; n <= runs; n++) {
    let r;
    try { r = benchRun({ project, stage, name, extra, keep }); }
    catch (e) { console.error(`run ${n}: ${e.message}`); r = { code: 2 }; }
    done.push(r);
    console.log(`run ${n}: ${r.code === 0 ? 'all met' : r.code === 1 ? 'failed' : 'no report'}${r.res ? ` · ${r.res.report}` : ''}`);
    if (stop && r.code !== 0) break;
  }
  console.log('\n' + runsSummary(`${stage} ${name}`, done, runs));
  return done.every(r => r.code === 0) ? 0 : 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 2; }
}
