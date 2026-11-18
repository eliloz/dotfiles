// What goes into the lab's project copy: one rule, leaveOutReason / labCopies in core.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { copyProject, labCopies, leaveOutReason } from '../core.mjs';

test('testing a sidecar: its own files go in, never sidecar.md, a test, a report or another sidecar', () => {
  const own = 'sidecars/booking';
  for (const f of ['sidecars/booking/memories.md', 'sidecars/booking/glossary.md', 'sidecars/booking/owns.txt', 'sidecars/Booking/notes.md']) assert.equal(labCopies(f, own), true, f);
  // sidecar.md stays out: the sidecar sees only its Instructions, typed into /sidecar (the lesson's rule).
  for (const f of ['sidecars/booking/sidecar.md', 'sidecars/booking/Sidecar.md', 'sidecars/booking/AGENTS.md', 'sidecars/booking/CLAUDE.md']) assert.equal(leaveOutReason(f, own), 'agent', f);
  for (const f of ['sidecars/booking/expectations.md', 'sidecars/booking/Expectations.md', 'sidecars/booking/expectations.old.md', 'sidecars/booking/old-expectations.txt', 'sidecars/pricing/expectations.md', 'expectations.md', 'docs/expectations.md', 'lab-scenarios.md']) assert.equal(labCopies(f, own), false, f);
  for (const f of ['sidecars/booking/reports/2026-11-15-lab-ad5a7a.md', 'sidecars/booking/reports/x.png', 'sidecars/booking/notes/draft.md', 'lab-reports/x.md']) assert.equal(labCopies(f, own), false, f);
  for (const f of ['sidecars/pricing/sidecar.md', 'sidecars/pricing/memories.md', 'sidecars/booking-old/glossary.md', 'roles/booking/glossary.md', 'packages/api/sidecars/booking/glossary.md']) assert.equal(labCopies(f, own), false, f);
  for (const f of ['sidecars/booking/secrets.json', 'sidecars/booking/.env', '.env.local', '.git/config', '.pi/settings.json', 'AGENTS.md']) assert.equal(labCopies(f, own), false, f);
  for (const f of ['src/domain/bookings.ts', 'GLOSSARY.md', 'README.md', 'test/hold-price.test.ts']) assert.equal(labCopies(f, own), true, f);
});

test('a scenario (no sidecar under test) copies no sidecars/ folder at all', () => {
  for (const folder of [undefined, '', 'sidecars', 'sidecars/', 'src', '.', '../sidecars/booking', 'sidecars/booking/reports', 'sidecars/a/b'])
    assert.equal(labCopies('sidecars/booking/glossary.md', folder), false, String(folder));
});

test('a real copy holds the sidecar\'s knowledge files and nothing that tests or instructs it', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-copy-'));
  const project = path.join(tmp, 'project');
  const put = (f, text = f) => { fs.mkdirSync(path.dirname(path.join(project, f)), { recursive: true }); fs.writeFileSync(path.join(project, f), text); };
  const all = dir => fs.readdirSync(dir, { recursive: true }).filter(f => fs.statSync(path.join(dir, f)).isFile()).map(f => f.split(path.sep).join('/')).sort();
  try {
    for (const f of ['src/bookings.ts', 'GLOSSARY.md', 'lab-scenarios.md', 'sidecars/booking/memories.md', 'sidecars/booking/glossary.md',
      'sidecars/booking/checks.md', 'sidecars/booking/reports/run.md', 'sidecars/pricing/sidecar.md', 'sidecars/pricing/glossary.md']) put(f);
    put('sidecars/booking/expectations.md', 'SECRET-EXPECTATION');
    put('sidecars/booking/sidecar.md', '# Booking\n## Instructions\nSECRET-INSTRUCTIONS\n## Examples\nSECRET-EXAMPLE\n');
    spawnSync('git', ['init', '-q'], { cwd: project });
    spawnSync('git', ['add', '-A'], { cwd: project });

    const forSidecar = path.join(tmp, 'for-sidecar');
    const r = copyProject(project, forSidecar, [], 'sidecars/booking');
    assert.deepEqual(all(forSidecar), ['GLOSSARY.md', 'sidecars/booking/checks.md', 'sidecars/booking/glossary.md', 'sidecars/booking/memories.md', 'src/bookings.ts']);
    assert.equal(spawnSync('grep', ['-rlE', 'SECRET-(EXPECTATION|INSTRUCTIONS|EXAMPLE)', forSidecar], { encoding: 'utf8' }).stdout, '');
    assert.deepEqual(r.left.agent.sort(), ['sidecars/booking/reports/run.md', 'sidecars/booking/sidecar.md', 'sidecars/pricing/glossary.md', 'sidecars/pricing/sidecar.md']);

    // A file withheld by path stays out even when the rule would copy it.
    const named = path.join(tmp, 'named');
    copyProject(project, named, ['sidecars/booking/checks.md'], 'sidecars/booking');
    assert.equal(all(named).includes('sidecars/booking/checks.md'), false);

    // A scenario tests no sidecar: no sidecar folder at all.
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
