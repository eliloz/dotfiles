// lab test skill <name>: routing, what the project copy and the staged skill leave out, guest Main's flags,
// which pane an unnamed line means, the report header and where reports are found.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testTarget, locateSkill, parse } from '../expectations.mjs';
import { spawnSync } from 'node:child_process';
import { leaveOutReason, stageSkill, skillLeavesOut, skillMainFlags, skillOrigin, originText, MAIN_TOOLS } from '../core.mjs';
import { reportText } from '../report.mjs';
import { latestSkillReport } from '../sidecars.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lab-skill-'));
const write = (root, rel, text = 'x') => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };

test('lab test skill <name> routes to a skill test; a file named skill still wins', () => {
  const none = () => false;
  assert.deepEqual(testTarget(['skill', 'echo-twice'], none), { kind: 'skill', name: 'echo-twice' });
  assert.deepEqual(testTarget(['skill'], none), { kind: 'skill', name: undefined });
  assert.deepEqual(testTarget(['Critic'], none), { kind: 'sidecar', name: 'Critic' });
  assert.equal(testTarget(['skill', 'a', 'b'], none).kind, 'words');
  assert.equal(testTarget(['skill', 'echo-twice'], f => f === 'skill').kind, 'scenarios');
});

test('locateSkill: tests from .agents/skill-tests/<name>/, and it says what is missing', () => {
  const p = fs.realpathSync(tmp()), home = fs.realpathSync(tmp());
  write(p, '.agents/skills/echo-twice/SKILL.md');
  const l = locateSkill(p, 'echo-twice', home);
  assert.equal(l.folder, '.agents/skill-tests/echo-twice');
  assert.equal(l.tests, path.join(p, '.agents/skill-tests/echo-twice'));
  assert.equal(l.file, path.join(p, '.agents/skill-tests/echo-twice/expectations.md'));
  assert.equal(l.noSkill, false);
  assert.equal(l.missing, true);
  write(p, '.agents/skills/echo-twice/expectations.md'); // the old place does not count
  assert.equal(locateSkill(p, 'echo-twice', home).missing, true);
  write(p, '.agents/skill-tests/echo-twice/expectations.md');
  assert.equal(locateSkill(p, 'echo-twice', home).missing, false);
  const none = locateSkill(p, 'nope', home);
  assert.equal(none.noSkill, true);
  assert.deepEqual(none.looked, [path.join(p, '.agents/skills/nope/SKILL.md'), path.join(home, '.agents/skills/nope/SKILL.md')]);
  assert.throws(() => locateSkill(p, undefined, home), /Name the skill/);
  assert.throws(() => locateSkill(p, '../x', home), /not a skill name/);
  fs.rmSync(p, { recursive: true }); fs.rmSync(home, { recursive: true });
});

test('locateSkill: the project\'s own skill text wins; otherwise the global one, followed through stow\'s link', () => {
  const p = fs.realpathSync(tmp()), home = fs.realpathSync(tmp()), dotfiles = fs.realpathSync(tmp());
  // The global copy as stow --no-folding installs it: a real folder in ~, one link per file into dotfiles.
  write(dotfiles, 'agents/.agents/skills/grilling/SKILL.md', 'global text');
  write(dotfiles, 'agents/.agents/skills/grilling/REFERENCE.md');
  fs.mkdirSync(path.join(home, '.agents/skills/grilling'), { recursive: true });
  for (const f of ['SKILL.md', 'REFERENCE.md']) fs.symlinkSync(path.join(dotfiles, 'agents/.agents/skills/grilling', f), path.join(home, '.agents/skills/grilling', f));
  const g = locateSkill(p, 'grilling', home);
  assert.equal(g.source, 'global');
  assert.equal(g.noSkill, false);
  assert.equal(g.dir, path.join(dotfiles, 'agents/.agents/skills/grilling'));
  const dest = path.join(tmp(), 'grilling');
  assert.deepEqual(stageSkill(g.dir, dest).copied.sort(), ['REFERENCE.md', 'SKILL.md']); // regular files, so both are staged
  assert.equal(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'), 'global text');
  // A project copy with the same name shadows it.
  write(p, '.agents/skills/grilling/SKILL.md', 'project text');
  const own = locateSkill(p, 'grilling', home);
  assert.equal(own.source, 'project');
  assert.equal(own.dir, path.join(p, '.agents/skills/grilling'));
  // A project folder without SKILL.md is not a skill: the global one is used.
  fs.rmSync(path.join(p, '.agents/skills/grilling/SKILL.md'));
  assert.equal(locateSkill(p, 'grilling', home).source, 'global');
  for (const d of [p, home, dotfiles, path.dirname(dest)]) fs.rmSync(d, { recursive: true });
});

test('skillOrigin names the copy tested: real path, repository, commit, uncommitted changes and a hash of SKILL.md', () => {
  const repo = fs.realpathSync(tmp()), dir = path.join(repo, 'agents/.agents/skills/grilling');
  const git = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  write(repo, 'agents/.agents/skills/grilling/SKILL.md', 'hello\n');
  const loc = { dir, skillFile: path.join(dir, 'SKILL.md'), source: 'global' };
  const bare = skillOrigin(loc);
  assert.equal(bare.repo, undefined);
  assert.equal(bare.hash, '5891b5b522d5'); // shasum -a 256 of "hello\n", first 12
  assert.match(originText(bare), /^the global copy, `.*grilling` · not in a git repository · SKILL\.md sha256 `5891b5b522d5`$/);
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'x');
  const o = skillOrigin(loc);
  assert.equal(o.repo, repo);
  assert.match(o.commit, /^[0-9a-f]{7,}$/);
  assert.equal(o.dirty, false);
  assert.equal(o.path, dir);
  write(repo, 'README.md', 'elsewhere'); // a change outside the skill folder does not count
  assert.equal(skillOrigin(loc).dirty, false);
  write(repo, 'agents/.agents/skills/grilling/SKILL.md', 'changed\n');
  const d = skillOrigin(loc);
  assert.equal(d.dirty, true);
  assert.notEqual(d.hash, o.hash);
  assert.match(originText(d), /at `[0-9a-f]+`, with uncommitted changes in the skill folder/);
  assert.match(originText({ ...d, source: 'project' }), /^the project's own copy/);
  fs.rmSync(repo, { recursive: true });
});

test('the project copy leaves out every skill, the .claude/skills link and BASELINE.md', () => {
  assert.equal(leaveOutReason('.agents/skills/grilling/SKILL.md'), 'agent');
  assert.equal(leaveOutReason('.agents/skills/grilling/expectations.md'), 'agent');
  assert.equal(leaveOutReason('.claude/skills'), 'agent');
  assert.equal(leaveOutReason('BASELINE.md'), 'expectations');
  assert.equal(leaveOutReason('docs/BASELINE.md'), 'expectations');
  assert.equal(leaveOutReason('app/routes/home.tsx'), undefined);
  assert.equal(leaveOutReason('docs/agents/issue-tracker.md'), 'agent'); // as before: agents/ folders are agent config
});

test('the staged skill has SKILL.md and its support files, never its test, baseline, reports or secrets', () => {
  const src = tmp(), dest = path.join(tmp(), 'echo-twice');
  for (const f of ['SKILL.md', 'refs/format.md', 'expectations.md', 'old-expectations.md', 'BASELINE.md', 'reports/2026-x.md', '.env']) write(src, f);
  fs.symlinkSync('/etc/hosts', path.join(src, 'link'));
  const s = stageSkill(src, dest);
  assert.deepEqual(s.copied.sort(), ['SKILL.md', 'refs/format.md']);
  assert.deepEqual(s.left.sort(), ['.env', 'BASELINE.md', 'expectations.md', 'link', 'old-expectations.md', 'reports']);
  assert.ok(fs.existsSync(path.join(dest, 'refs', 'format.md')));
  assert.ok(!fs.existsSync(path.join(dest, 'expectations.md')));
  assert.equal(skillLeavesOut('nested/Reports/x.md'), true);
  fs.rmSync(src, { recursive: true }); fs.rmSync(path.dirname(dest), { recursive: true });
});

test('guest Main loads exactly the staged skill: --no-skills, --skill, read-only tools, no extensions', () => {
  const f = skillMainFlags({ staged: '/lab/skill/echo-twice', model: 'p/m' });
  assert.ok(f.includes('--no-extensions'));
  assert.ok(!f.includes('-e'));
  assert.equal(f[f.indexOf('--tools') + 1], MAIN_TOOLS);
  assert.ok(f.indexOf('--no-skills') >= 0);
  assert.equal(f[f.indexOf('--skill') + 1], '/lab/skill/echo-twice');
  assert.equal(f.filter(x => x === '--skill').length, 1);
  assert.equal(f[f.indexOf('--name') + 1], 'Main');
  assert.equal(f[f.indexOf('--model') + 1], 'p/m');
});

test('in a skill test a line without a pane, or one marked (Sidecar), is about Main', () => {
  const spec = parse('# x\n## Echo\nDo: /skill:echo-twice lake\nSee: "lake"\nExpect: shows lake twice\nNever (Sidecar): says hello', 'Main');
  assert.deepEqual(spec.items[0].lines.map(l => l.pane), ['Main', 'Main', 'Main', 'Main']);
});

test('a skill report names the skill and two models, not a sidecar', () => {
  const run = { kind: 'skill', skill: 'echo-twice', folder: '.agents/skill-tests/echo-twice', model: 'p/m', testerModel: 'p/t', skillFiles: { copied: ['SKILL.md'] },
    origin: { source: 'global', path: '/d/agents/.agents/skills/echo-twice', repo: '/d', commit: 'abc1234', dirty: false, hash: '5891b5b522d5' } };
  const results = { items: [{ id: 1, title: 'Echo', verdict: 'pass', reason: 'ok', evidence: [{ pane: 'Main', quote: 'lake' }] }] };
  const t = reportText({ run, results, summary: 'Fine.', screens: { Main: 'lake\nlake' }, id: 'lab-abc123' });
  assert.match(t, /^# Skill echo-twice · lab report/);
  assert.match(t, /--no-skills --skill <staged copy>` \(1 file: SKILL\.md\)/);
  assert.ok(t.includes('Skill text: the global copy, `/d/agents/.agents/skills/echo-twice` · repository `/d` at `abc1234` · SKILL.md sha256 `5891b5b522d5`'));
  assert.match(t, /Models: Main `p\/m` · Tester `p\/t`/);
  assert.match(t, /Expectations: `\.agents\/skill-tests\/echo-twice\/expectations\.md`/);
  assert.doesNotMatch(t, /Sidecar|sidecar/);
});

test('lab report skill <name> finds the newest report in the skill\'s tests folder', () => {
  const p = tmp();
  assert.equal(latestSkillReport(p, 'echo-twice'), undefined);
  write(p, '.agents/skill-tests/echo-twice/reports/2026-11-18-100000-lab-aaaaaa.md');
  write(p, '.agents/skill-tests/echo-twice/reports/2026-11-18-110000-lab-bbbbbb.md');
  write(p, '.agents/skills/echo-twice/reports/2026-11-18-120000-lab-cccccc.md'); // the old place is not read
  assert.match(latestSkillReport(p, 'echo-twice'), /110000-lab-bbbbbb\.md$/);
  fs.rmSync(p, { recursive: true });
});

test('the skill Tester prompt is about Main and one skill, not a sidecar', () => {
  const t = fs.readFileSync(new URL('../tester/skill-prompt.md', import.meta.url), 'utf8');
  assert.match(t, /one skill loaded and nothing else/);
  assert.doesNotMatch(t, /Main and the sidecar|below the sidecar/);
  for (const tool of ['lab_do', 'lab_look', 'lab_find', 'lab_verdict', 'lab_finish']) assert.ok(t.includes(tool), tool);
});
