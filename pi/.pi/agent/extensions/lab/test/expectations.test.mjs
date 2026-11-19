// node --test ~/.pi/agent/extensions/lab/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, contains, judged, observed, steps, instructions, access, locate, extraPanes } from '../expectations.mjs';

// John's sidecars/critic/expectations.md (lesson, S04E01).
const critic = `# Critic expectations

## Before
Do (Main): RentAPlace lets guests book cabins and lake houses by the night. Reply in one sentence.

## Asks for what the prompt leaves out
Do (Main): Add a minimum stay rule. Don't ask me anything; just tell me the rule you'd add, in one sentence.
Expect (Critic): names information the request left out that Main would have to guess, such as how many nights or which homes, and asks for it
Never (Critic): treats a number Main picked as if it had been decided

## Names the blast radius
Do (Main): Raise the cleaning fee to $90. Don't change any files; just tell me what you'd change, in one sentence.
Expect (Critic): points out something else the change touches, such as bookings already made, prices guests were already quoted or host payouts, and asks whether those should change
Never (Critic): treats it as a one-line change with no other effects

## Splits a big task
Do (Main): Add host accounts with a dashboard, payouts, guest messaging and calendar sync. Don't change any files; reply in one sentence.
Expect (Critic): says the task is too big for one step and names a smaller first step
Never (Critic): treats the whole list as one task to build at once
`;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lab-test-'));

test('the Critic example parses into a Before step and three expectations', () => {
  const s = parse(critic, 'Critic');
  assert.equal(s.title, 'Critic expectations');
  assert.deepEqual(s.before.map(l => [l.kind, l.pane]), [['do', 'Main']]);
  assert.deepEqual(s.items.map(i => i.title), ['Asks for what the prompt leaves out', 'Names the blast radius', 'Splits a big task']);
  assert.match(steps(s.items[2])[0].text, /host accounts/);
  assert.equal(steps(s.items[2])[0].pane, 'Main');
  assert.deepEqual(judged(s.items[0]).map(l => [l.kind, l.pane]), [['expect', 'Critic'], ['never', 'Critic']]);
});

test('(Sidecar) and any spelling of the name mean the sidecar; See/Absent keep the quoted text', () => {
  const s = parse('## A\nDo: hi\nSee (Sidecar): "1 sidecar note"\nAbsent (main): “secret”\nExpect (notes): replies', 'Notes');
  assert.deepEqual(observed(s.items[0]).map(l => [l.kind, l.pane, l.text]), [['see', 'Notes', '1 sidecar note'], ['absent', 'Main', 'secret']]);
  assert.equal(judged(s.items[0])[0].pane, 'Notes');
  assert.equal(steps(s.items[0])[0].pane, 'Main'); // Do without a pane is Main
  assert.equal(parse('## A\nDo (Repeater): /sidecar send main #1\nSee (Main): "1 sidecar note"', 'Repeater').items[0].lines[0].pane, 'Repeater');
});

test('lists, numbered headings, comments and indented continuation lines', () => {
  const s = parse('Intro prose is ignored.\n## 1. A\n- Do (Main): one\n    two\n<!-- note -->\n- Expect: three', 'X');
  assert.equal(s.items[0].title, 'A');
  assert.equal(steps(s.items[0])[0].text, 'one two');
});

test('mistakes name the line and say how to fix them', () => {
  assert.throws(() => parse('## A\nVerify: something', 'Critic'), /Line 2: start with Do, Run, Tools, Expect, Never, See, Absent or Check/);
  assert.throws(() => parse('## A\nDo (Main): hi', 'Critic'), /has no check/);
  assert.throws(() => parse('# Only a title', 'Critic'), /No expectations yet/);
  assert.throws(() => parse('## Before\nExpect: x\n## A\nExpect: y', 'Critic'), /Line 2: the Before section only holds Do, Run and Tools/);
  assert.throws(() => parse('## A\nRun: rm -rf x\nExpect: y', 'Critic'), /Line 2: Run lines belong under "## Before"/);
});

test('like herdr-pi-lab: another pane name is kept and listed, Before may come anywhere', () => {
  const s = parse('## A\nExpect (Tester): y\nSee (Main): "z"', 'Critic');
  assert.equal(s.items[0].lines[0].pane, 'Tester');
  assert.deepEqual(extraPanes(s, 'Critic'), ['Tester']);
  assert.deepEqual(extraPanes(parse(critic, 'Critic'), 'Critic'), []);
  const late = parse('## A\nExpect: y\n## Before\nDo: hi', 'Critic');
  assert.deepEqual(late.before.map(l => l.text), ['hi']);
  // A Before Do line for the sidecar parses; startSidecarLab refuses it when the lab runs (as herdr-pi-lab's start does).
  assert.equal(parse('## Before\nDo (Critic): hi\n## A\nExpect: y', 'Critic').before[0].pane, 'Critic');
});

test('Run lines in Before are setup the lab runs, typed by no one', () => {
  const s = parse("## Before\nRun: sed -i '' 's/a/b/' src/x.ts\nDo (Main): The test fails.\n## Fixes it\nDo: Fix src/x.ts\nExpect (Fixer): stages src/x.ts", 'Fixer');
  assert.deepEqual(s.before.map(l => [l.kind, l.pane, l.text]), [['run', 'lab', "sed -i '' 's/a/b/' src/x.ts"], ['do', 'Main', 'The test fails.']]);
});

test('screen matching ignores wrapping, case and punctuation, not words', () => {
  const screen = ' Which homes should\n it cover: cabins, lake houses, or\n both?';
  assert.equal(contains(screen, 'which homes should it cover'), true);
  assert.equal(contains(screen, 'cabins lake houses or both'), true);
  assert.equal(contains(screen, 'which cabins'), false);
  assert.equal(contains(screen, '   '), false);
  assert.equal(contains('It’s fine', "it's fine"), true);
});

test('the instructions are the "## Instructions" section of sidecar.md, as /sidecar reads it', () => {
  const d = tmp();
  try {
    assert.equal(instructions(d), undefined);
    fs.writeFileSync(path.join(d, 'sidecar.md'), '# Repeater\n\n## Instructions\nRepeat Main\'s last prompt\nin five words.\n\n## Use it when\n- testing\n');
    assert.equal(instructions(d), "Repeat Main's last prompt in five words.");
    // No "## Instructions" heading: the whole file minus its title, as herdr-pi-lab reads it.
    fs.writeFileSync(path.join(d, 'sidecar.md'), '# Repeater\nJust prose.\n');
    assert.equal(instructions(d), 'Just prose.');
    fs.writeFileSync(path.join(d, 'sidecar.md'), '# Repeater\n## Instructions\n\n## Examples\n');
    assert.throws(() => instructions(d), /needs a "## Instructions" section/);
    fs.writeFileSync(path.join(d, 'sidecar.md'), `## Instructions\n${'x'.repeat(2401)}\n`);
    assert.throws(() => instructions(d), /2,401 characters/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('Access: work on its own line opens the sidecar with --work', () => {
  const d = tmp();
  try {
    assert.equal(access(d), 'read');
    fs.writeFileSync(path.join(d, 'sidecar.md'), '# Fixer\nAccess: work\n\n## Instructions\nFix the named file.\n');
    assert.equal(access(d), 'work');
    fs.writeFileSync(path.join(d, 'sidecar.md'), '# Notes\n\n## Instructions\nKeep notes. Access: work is not a line here.\n');
    assert.equal(access(d), 'read');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('locate: sidecars/<name>/ in lower case; a bad name is refused', () => {
  const d = tmp();
  try {
    const loc = locate(d, 'Critic');
    assert.equal(loc.file, path.join(d, 'sidecars/critic/expectations.md'));
    assert.equal(loc.folder, 'sidecars/critic');
    assert.equal(loc.missing, true);
    fs.mkdirSync(loc.dir, { recursive: true }); fs.writeFileSync(loc.file, critic);
    assert.equal(locate(d, 'critic').missing, false);
    assert.throws(() => locate(d, '../x'), /not a sidecar name/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
