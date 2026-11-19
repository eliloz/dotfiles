// M4: Check lines, a tool list per skill test, the lab's local tracker, and no forge login in a lab.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse, decide, checks } from '../expectations.mjs';
import { skillMainFlags, MAIN_TOOLS, copyProject, installLocalTracker, TRACKER_FILE, TRACKER_LINE, SKILL_KEEPS, env, paneEnv, dirs } from '../core.mjs';
import { reportText } from '../report.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lab-m4-'));
const write = (root, rel, text = 'x') => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };

test('a Check line is the lab\'s, belongs to an expectation and counts as its check', () => {
  const s = parse('# x\n## Writes nothing yet\nDo: /skill:to-tickets\nCheck: test ! -d .scratch/a/issues\n  || false', 'Main');
  const c = checks(s.items[0]);
  assert.equal(c.length, 1);
  assert.equal(c[0].pane, 'lab');
  assert.equal(c[0].text, 'test ! -d .scratch/a/issues || false'); // continuation lines join
  assert.equal(parse('## A\nCheck (lab): true', 'Main').items[0].lines[0].kind, 'check');
  assert.throws(() => parse('## A\nCheck (Main): true', 'Main'), /Line 2: the lab runs Check lines itself/);
  assert.throws(() => parse('## Before\nCheck: true\n## A\nExpect: y', 'Main'), /Line 2: the Before section only holds Do, Run and Tools/);
});

test('a Tools line sets guest Main\'s tools: Before only, once, known Pi tools only', () => {
  const s = parse('## Before\nTools (Main): read, grep, find, ls, write, Edit, write\n## A\nExpect: y', 'Main');
  assert.deepEqual(s.tools, ['read', 'grep', 'find', 'ls', 'write', 'edit']);
  assert.equal(parse('## A\nExpect: y', 'Main').tools, undefined);
  assert.deepEqual(parse('## Before\nTools: read,bash\n## A\nExpect: y', 'Main').tools, ['read', 'bash']);
  assert.throws(() => parse('## A\nTools: read\nExpect: y', 'Main'), /Line 2: the Tools line belongs under "## Before"/);
  assert.throws(() => parse('## Before\nTools: read\nTools: write\n## A\nExpect: y', 'Main'), /Line 3: one Tools line per file/);
  assert.throws(() => parse('## Before\nTools: read, gh\n## A\nExpect: y', 'Main'), /Line 2: gh is not a tool guest Main can get/);
  assert.throws(() => parse('## Before\nTools (Sidecar): read\n## A\nExpect: y', 'Main'), /Line 2: Tools sets guest Main's tools/);
});

test('guest Main gets the Tools line\'s tools, or read-only without one', () => {
  const f = t => { const a = skillMainFlags({ staged: '/s', model: 'p/m', tools: t }); return a[a.indexOf('--tools') + 1]; };
  assert.equal(f(undefined), MAIN_TOOLS);
  assert.equal(f([]), MAIN_TOOLS);
  assert.equal(f(['read', 'write']), 'read,write');
});

test('decide: a Check decides like See and Absent, over the Tester; one never run fails', () => {
  const item = parse('## A\nDo: hi\nExpect: replies\nCheck: true\nCheck: false', 'Main').items[0];
  const [ok, bad] = checks(item);
  const given = { Main: 'hello there' }, p = { verdict: 'pass', evidence: [{ pane: 'Main', quote: 'hello' }] };
  const both = [{ line: ok.line, status: 0, ok: true }, { line: bad.line, status: 1, ok: false }];
  const d = decide(item, p, given, given, both);
  assert.equal(d.verdict, 'fail');
  assert.deepEqual(d.observed.map(o => [o.kind, o.ok, o.status]), [['check', true, 0], ['check', false, 1]]);
  assert.equal(decide(item, p, given, given, [both[0], { ...both[1], status: 0, ok: true }]).verdict, 'pass');
  assert.equal(decide(item, p, given, given, [both[0]]).observed[1].status, 'not run');
  assert.equal(decide(item, p, given, given, [both[0]]).verdict, 'fail');
  // Only Checks: the Tester's word does not count either way, and needs no quote.
  const only = parse('## B\nCheck: true', 'Main').items[0];
  assert.equal(decide(only, { verdict: 'fail', evidence: [] }, {}, {}, [{ line: 2, status: 0, ok: true }]).verdict, 'pass');
});

test('a skill test keeps the root AGENTS.md; other agent files and docs/agents stay out', () => {
  const project = tmp(), dest = path.join(tmp(), 'copy');
  spawnSync('git', ['init', '-q', project]);
  for (const f of ['AGENTS.md', 'sub/AGENTS.md', 'docs/agents/issue-tracker.md', '.agents/skills/a/SKILL.md', 'app.ts']) write(project, f);
  spawnSync('git', ['-C', project, 'add', '-A']);
  const r = copyProject(project, dest, [], undefined, SKILL_KEEPS);
  assert.ok(fs.existsSync(path.join(dest, 'AGENTS.md')));
  assert.ok(!fs.existsSync(path.join(dest, 'sub/AGENTS.md')));
  assert.ok(!fs.existsSync(path.join(dest, 'docs/agents/issue-tracker.md')));
  assert.deepEqual(r.left.agent.sort(), ['.agents/skills/a/SKILL.md', 'docs/agents/issue-tracker.md', 'sub/AGENTS.md']);
  const plain = path.join(tmp(), 'copy');
  copyProject(project, plain);
  assert.ok(!fs.existsSync(path.join(plain, 'AGENTS.md'))); // a sidecar test or scenario still leaves it out
});

test('the lab installs a local tracker, whatever the project configures', () => {
  const template = path.join(tmp(), 'local.md'); fs.writeFileSync(template, '# Issue tracker: Local Markdown\n');
  const project = tmp(), copy = tmp();
  write(project, TRACKER_FILE, '# Issue tracker: GitHub\nUse gh issue create.\n');
  write(copy, 'AGENTS.md', '# Rules\n\n## Agent skills\n\n### Issue tracker\n\nIssues live as GitHub issues, use `gh`.\n\n### Other\n\nKeep me.\n');
  const t = installLocalTracker(project, copy, template);
  assert.equal(t.project, 'different');
  assert.equal(fs.readFileSync(path.join(copy, TRACKER_FILE), 'utf8'), '# Issue tracker: Local Markdown\n');
  const agents = fs.readFileSync(path.join(copy, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes(TRACKER_LINE));
  assert.ok(!/github|gh`/i.test(agents));
  assert.ok(agents.includes('### Other\n\nKeep me.'));
  assert.ok(agents.startsWith('# Rules'));
  // No AGENTS.md in the copy: the lab writes one holding only the tracker section.
  const bare = tmp();
  assert.equal(installLocalTracker(tmp(), bare, template).project, 'absent');
  assert.equal(fs.readFileSync(path.join(bare, 'AGENTS.md'), 'utf8'), `## Agent skills\n\n### Issue tracker\n\n${TRACKER_LINE}\n`);
  // The project already local: "the same".
  const same = tmp(); write(same, TRACKER_FILE, '# Issue tracker: Local Markdown\n');
  assert.equal(installLocalTracker(same, tmp(), template).project, 'the same');
});

test('the lab\'s own tracker file is Matt\'s local template: tickets as files in .scratch/', () => {
  const text = fs.readFileSync(new URL('../tracker/issue-tracker-local.md', import.meta.url), 'utf8');
  assert.match(text, /\.scratch\/<feature-slug>\/issues\/<NN>-<slug>\.md/);
  assert.ok(!/gh issue|github/i.test(text));
});

test('no lab process has a GitHub or GitLab login: tokens removed, gh and glab read an empty folder', () => {
  const saved = { ...process.env };
  Object.assign(process.env, { GH_TOKEN: 'secret', GITHUB_TOKEN: 'secret', GLAB_TOKEN: 'secret', GH_CONFIG_DIR: '/real' });
  try {
    const e = env('lab-abc123');
    for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GLAB_TOKEN']) assert.equal(e[k], undefined, k);
    assert.equal(e.GH_CONFIG_DIR, dirs('lab-abc123').noLogins);
    assert.equal(e.GLAB_CONFIG_DIR, dirs('lab-abc123').noLogins);
    const a = paneEnv('lab-abc123');
    for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GLAB_TOKEN']) assert.ok(a.some((x, i) => x === k && a[i - 1] === '-u'), k);
    assert.ok(a.includes(`GH_CONFIG_DIR=${dirs('lab-abc123').noLogins}`));
  } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
});

test('a skill report names Main\'s tools and the tracker, and shows a failed Check\'s output', () => {
  const run = { kind: 'skill', skill: 'to-tickets', folder: '.agents/skill-tests/to-tickets', model: 'p/m', testerModel: 'p/t', skillFiles: { copied: ['SKILL.md'] }, mainTools: 'read,write', tracker: { project: 'the same' } };
  const results = { items: [{ id: 1, title: 'Waits', verdict: 'fail', reason: 'r', observed: [{ kind: 'check', pane: 'lab', text: 'test -z "$(ls x)"', ok: false, status: 1 }], checks: [{ command: 'test -z "$(ls x)"', status: 1, ok: false, output: '01-a.md' }] }] };
  const md = reportText({ run, results, summary: 's', screens: {}, id: 'lab-abc123' });
  assert.match(md, /Main's tools: `read,write`/);
  assert.match(md, /Tracker: local Markdown in `\.scratch\/` \(the lab's default\); the project's own tracker file is the same/);
  assert.match(md, /Lab check ✗ `test -z "\$\(ls x\)"` exited 1/);
  assert.match(md, /01-a\.md/);
});

test('lab selftest: echo-twice lives in the lab\'s own folder, with Checks, and reports outside any project', async () => {
  const { selftestSkill, SELFTEST_REPORTS, REPORTS } = await import('../core.mjs');
  const l = selftestSkill();
  assert.equal(l.noSkill, false);
  assert.equal(l.missing, false);
  assert.ok(l.dir.endsWith(path.join('lab', 'selftest', 'echo-twice')));
  assert.equal(SELFTEST_REPORTS, path.join(REPORTS, 'selftest'));
  const s = parse(fs.readFileSync(l.file, 'utf8'), 'Main');
  assert.equal(s.items.length, 1);
  assert.deepEqual(checks(s.items[0]).map(c => c.text), ['grep -q "local Markdown files under" AGENTS.md && grep -q "Local Markdown" docs/agents/issue-tracker.md', '! gh auth status']);
  const md = reportText({ run: { kind: 'skill', skill: 'echo-twice', selftest: true, folder: l.folder, expectations: l.file, model: 'p/m', testerModel: 'p/t', skillFiles: { copied: ['SKILL.md'] } }, results: { items: [] }, summary: 's', screens: {}, id: 'lab-abc123' });
  assert.ok(md.includes(`Expectations: \`${l.file}\``));
});
