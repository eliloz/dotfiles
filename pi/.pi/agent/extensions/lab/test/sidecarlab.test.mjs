// lab test <Sidecar>: routing of `lab test …`, the /sidecar line Main gets, and reading back the instructions that arrived.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testTarget } from '../expectations.mjs';
import { sidecarCommand, ownerInstructions, MARK, MAIN_TOOLS } from '../core.mjs';
// /sidecar lives outside dotfiles (~/.pi/agent/extensions/sidecar), so it is imported by its installed path.
const { parseArgs } = await import(path.join(os.homedir(), '.pi/agent/extensions/sidecar/pure/args.mjs'));

const files = new Set(['lab-scenarios.md', 'checks.md']);
const isFile = f => files.has(f);

test('lab test routes files, sidecars and plain words', () => {
  assert.deepEqual(testTarget([], isFile), { kind: 'scenarios', file: undefined, pick: undefined });
  assert.deepEqual(testTarget(['checks.md', '3'], isFile), { kind: 'scenarios', file: 'checks.md', pick: '3' });
  assert.deepEqual(testTarget(['repeater'], isFile), { kind: 'sidecar', name: 'repeater' });
  assert.deepEqual(testTarget(['Critic'], isFile), { kind: 'sidecar', name: 'Critic' });
  assert.equal(testTarget(['Open a pane. Run ls.'], isFile).kind, 'words');
  assert.equal(testTarget(['open', 'a', 'pane'], isFile).kind, 'words');
  // A file wins over a sidecar of the same name.
  files.add('repeater');
  assert.equal(testTarget(['repeater'], isFile).kind, 'scenarios');
});

test('the /sidecar line parses back to the same name, model, access and instructions', () => {
  const instructions = 'Repeat the last prompt in Main in at most five words, as one numbered finding. Quote "exactly" — even --flags.';
  for (const work of [false, true]) {
    const line = sidecarCommand({ name: 'Repeater', work, model: 'fast', instructions });
    const a = parseArgs(line.replace(/^\/sidecar\s+/, ''));
    assert.deepEqual(a, { action: 'open', name: 'Repeater', work, model: 'fast', thinking: undefined, instructions });
  }
  const long = 'x'.repeat(2400);
  assert.equal(parseArgs(sidecarCommand({ name: 'Critic', model: 'fast', instructions: long }).slice('/sidecar '.length)).instructions, long);
});

test('guest Main gets read-only tools', () => assert.equal(MAIN_TOOLS, 'read,grep,find,ls'));

test('ownerInstructions reads the instructions from the last owner entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-owner-'));
  const f = path.join(dir, 's.jsonl');
  const lines = [{ type: 'session' }, { type: 'custom', customType: MARK.owner, data: { instructions: 'old' } },
    { type: 'custom', customType: MARK.owner, data: { instructions: 'the real instructions' } }, { type: 'message', message: { role: 'user', content: 'hi' } }];
  fs.writeFileSync(f, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  assert.equal(ownerInstructions(f), 'the real instructions');
  assert.equal(ownerInstructions(undefined), undefined);
  fs.rmSync(dir, { recursive: true });
});
