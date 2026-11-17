// What goes into the lab's project copy: one rule, leaveOutReason / labCopies in core.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { copyProject, labCopies, leaveOutReason } from '../core.mjs';

test('testing an agent: its own files go in, never agent.md, a test, a report or another agent', () => {
  const own = 'agents/booking';
  for (const f of ['agents/booking/memories.md', 'agents/booking/glossary.md', 'agents/booking/owns.txt', 'agents/Booking/notes.md']) assert.equal(labCopies(f, own), true, f);
  // agent.md stays out: the agent sees only its Job, typed into /agent (the lesson's rule).
  for (const f of ['agents/booking/agent.md', 'agents/booking/Agent.md', 'agents/booking/AGENTS.md', 'agents/booking/CLAUDE.md']) assert.equal(leaveOutReason(f, own), 'agent', f);
  for (const f of ['agents/booking/expectations.md', 'agents/booking/Expectations.md', 'agents/booking/expectations.old.md', 'agents/booking/old-expectations.txt', 'agents/pricing/expectations.md', 'expectations.md', 'docs/expectations.md', 'lab-scenarios.md']) assert.equal(labCopies(f, own), false, f);
  for (const f of ['agents/booking/reports/2026-11-15-lab-ad5a7a.md', 'agents/booking/reports/x.png', 'agents/booking/notes/draft.md', 'lab-reports/x.md']) assert.equal(labCopies(f, own), false, f);
  for (const f of ['agents/pricing/agent.md', 'agents/pricing/memories.md', 'agents/booking-old/glossary.md', 'roles/booking/glossary.md', 'packages/api/agents/booking/glossary.md']) assert.equal(labCopies(f, own), false, f);
  for (const f of ['agents/booking/secrets.json', 'agents/booking/.env', '.env.local', '.git/config', '.pi/settings.json', 'AGENTS.md']) assert.equal(labCopies(f, own), false, f);
  for (const f of ['src/domain/bookings.ts', 'GLOSSARY.md', 'README.md', 'test/hold-price.test.ts']) assert.equal(labCopies(f, own), true, f);
});

test('a scenario check (no agent under test) copies no agents/ folder at all', () => {
  for (const folder of [undefined, '', 'agents', 'agents/', 'src', '.', '../agents/booking', 'agents/booking/reports', 'agents/a/b'])
    assert.equal(labCopies('agents/booking/glossary.md', folder), false, String(folder));
});

test('a real copy holds the agent\'s knowledge files and nothing that tests or instructs it', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-copy-'));
  const project = path.join(tmp, 'project');
  const put = (f, text = f) => { fs.mkdirSync(path.dirname(path.join(project, f)), { recursive: true }); fs.writeFileSync(path.join(project, f), text); };
  const all = dir => fs.readdirSync(dir, { recursive: true }).filter(f => fs.statSync(path.join(dir, f)).isFile()).map(f => f.split(path.sep).join('/')).sort();
  try {
    for (const f of ['src/bookings.ts', 'GLOSSARY.md', 'lab-scenarios.md', 'agents/booking/memories.md', 'agents/booking/glossary.md',
      'agents/booking/checks.md', 'agents/booking/reports/run.md', 'agents/pricing/agent.md', 'agents/pricing/glossary.md']) put(f);
    put('agents/booking/expectations.md', 'SECRET-EXPECTATION');
    put('agents/booking/agent.md', '# Booking\n## Job\nSECRET-JOB\n## Examples\nSECRET-EXAMPLE\n');
    spawnSync('git', ['init', '-q'], { cwd: project });
    spawnSync('git', ['add', '-A'], { cwd: project });

    const forAgent = path.join(tmp, 'for-agent');
    const r = copyProject(project, forAgent, [], 'agents/booking');
    assert.deepEqual(all(forAgent), ['GLOSSARY.md', 'agents/booking/checks.md', 'agents/booking/glossary.md', 'agents/booking/memories.md', 'src/bookings.ts']);
    assert.equal(spawnSync('grep', ['-rlE', 'SECRET-(EXPECTATION|JOB|EXAMPLE)', forAgent], { encoding: 'utf8' }).stdout, '');
    assert.deepEqual(r.left.agent.sort(), ['agents/booking/agent.md', 'agents/booking/reports/run.md', 'agents/pricing/agent.md', 'agents/pricing/glossary.md']);

    // A file withheld by path stays out even when the rule would copy it.
    const named = path.join(tmp, 'named');
    copyProject(project, named, ['agents/booking/checks.md'], 'agents/booking');
    assert.equal(all(named).includes('agents/booking/checks.md'), false);

    // A check tests no agent: no agent folder at all.
    const forCheck = path.join(tmp, 'for-check');
    copyProject(project, forCheck);
    assert.deepEqual(all(forCheck), ['GLOSSARY.md', 'src/bookings.ts']);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('like herdr-pi-lab: reports and build or cache folders stay out anywhere', () => {
  for (const f of ['node_modules/x/index.js', 'web/.next/cache.json', 'dist/app.js', 'docs/reports/q3.md', 'py/__pycache__/a.pyc'])
    assert.equal(leaveOutReason(f), 'generated', f);
  for (const f of ['src/build.ts', 'docs/report.md', 'src/dist-utils.ts']) assert.equal(leaveOutReason(f), undefined, f);
});
