// lab test <Agent>: routing of `lab test …`, the /agent line Main gets, and reading back the job that arrived.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testTarget } from '../expectations.mjs';
import { agentCommand, ownerJob, MARK, MAIN_TOOLS } from '../core.mjs';
// /agent lives outside dotfiles (~/.pi/agent/extensions/agent), so it is imported by its installed path.
const { parseArgs } = await import(path.join(os.homedir(), '.pi/agent/extensions/agent/pure/args.mjs'));

const files = new Set(['lab-scenarios.md', 'checks.md']);
const isFile = f => files.has(f);

test('lab test routes files, agents and plain words', () => {
  assert.deepEqual(testTarget([], isFile), { kind: 'scenarios', file: undefined, pick: undefined });
  assert.deepEqual(testTarget(['checks.md', '3'], isFile), { kind: 'scenarios', file: 'checks.md', pick: '3' });
  assert.deepEqual(testTarget(['repeater'], isFile), { kind: 'agent', name: 'repeater' });
  assert.deepEqual(testTarget(['Critic'], isFile), { kind: 'agent', name: 'Critic' });
  assert.equal(testTarget(['Open a pane. Run ls.'], isFile).kind, 'words');
  assert.equal(testTarget(['open', 'a', 'pane'], isFile).kind, 'words');
  // A file wins over an agent of the same name.
  files.add('repeater');
  assert.equal(testTarget(['repeater'], isFile).kind, 'scenarios');
});

test('the /agent line parses back to the same name, model, access and job', () => {
  const job = 'Repeat the last prompt in Main in at most five words, as one numbered finding. Quote "exactly" — even --flags.';
  for (const work of [false, true]) {
    const line = agentCommand({ name: 'Repeater', work, model: 'fast', job });
    const a = parseArgs(line.replace(/^\/agent\s+/, ''));
    assert.deepEqual(a, { action: 'open', name: 'Repeater', work, model: 'fast', thinking: undefined, job });
  }
  const long = 'x'.repeat(2400);
  assert.equal(parseArgs(agentCommand({ name: 'Critic', model: 'fast', job: long }).slice(7)).job, long);
});

test('guest Main gets read-only tools', () => assert.equal(MAIN_TOOLS, 'read,grep,find,ls'));

test('ownerJob reads the job from the last owner entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-owner-'));
  const f = path.join(dir, 's.jsonl');
  const lines = [{ type: 'session' }, { type: 'custom', customType: MARK.owner, data: { job: 'old' } },
    { type: 'custom', customType: MARK.owner, data: { job: 'the real job' } }, { type: 'message', message: { role: 'user', content: 'hi' } }];
  fs.writeFileSync(f, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  assert.equal(ownerJob(f), 'the real job');
  assert.equal(ownerJob(undefined), undefined);
  fs.rmSync(dir, { recursive: true });
});
