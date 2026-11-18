// lab test skill <name>: routing, what the project copy and the staged skill leave out, guest Main's flags,
// which pane an unnamed line means, the report header and where reports are found.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testTarget, locateSkill, parse } from '../expectations.mjs';
import { leaveOutReason, stageSkill, skillLeavesOut, skillMainFlags, MAIN_TOOLS } from '../core.mjs';
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

test('locateSkill finds .agents/skills/<name>/ and says what is missing', () => {
  const p = tmp();
  write(p, '.agents/skills/echo-twice/SKILL.md');
  const l = locateSkill(p, 'echo-twice');
  assert.equal(l.folder, '.agents/skills/echo-twice');
  assert.equal(l.noSkill, false);
  assert.equal(l.missing, true);
  assert.equal(locateSkill(p, 'nope').noSkill, true);
  assert.throws(() => locateSkill(p, undefined), /Name the skill/);
  assert.throws(() => locateSkill(p, '../x'), /not a skill name/);
  fs.rmSync(p, { recursive: true });
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
  const run = { kind: 'skill', skill: 'echo-twice', folder: '.agents/skills/echo-twice', model: 'p/m', testerModel: 'p/t', skillFiles: { copied: ['SKILL.md'] } };
  const results = { items: [{ id: 1, title: 'Echo', verdict: 'pass', reason: 'ok', evidence: [{ pane: 'Main', quote: 'lake' }] }] };
  const t = reportText({ run, results, summary: 'Fine.', screens: { Main: 'lake\nlake' }, id: 'lab-abc123' });
  assert.match(t, /^# Skill echo-twice · lab report/);
  assert.match(t, /--no-skills --skill <staged copy of \.agents\/skills\/echo-twice\/>` \(1 file: SKILL\.md\)/);
  assert.match(t, /Models: Main `p\/m` · Tester `p\/t`/);
  assert.match(t, /Expectations: `\.agents\/skills\/echo-twice\/expectations\.md`/);
  assert.doesNotMatch(t, /Sidecar|sidecar/);
});

test('lab report skill <name> finds the newest report in the skill folder', () => {
  const p = tmp();
  assert.equal(latestSkillReport(p, 'echo-twice'), undefined);
  write(p, '.agents/skills/echo-twice/reports/2026-11-18-100000-lab-aaaaaa.md');
  write(p, '.agents/skills/echo-twice/reports/2026-11-18-110000-lab-bbbbbb.md');
  assert.match(latestSkillReport(p, 'echo-twice'), /110000-lab-bbbbbb\.md$/);
  fs.rmSync(p, { recursive: true });
});

test('the skill Tester prompt is about Main and one skill, not a sidecar', () => {
  const t = fs.readFileSync(new URL('../tester/skill-prompt.md', import.meta.url), 'utf8');
  assert.match(t, /one skill loaded and nothing else/);
  assert.doesNotMatch(t, /Main and the sidecar|below the sidecar/);
  for (const tool of ['lab_do', 'lab_look', 'lab_find', 'lab_verdict', 'lab_finish']) assert.ok(t.includes(tool), tool);
});
