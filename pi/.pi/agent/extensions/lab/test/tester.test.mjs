// The Tester's verdicts: quotes only from screens it was shown, See/Absent from what the lab read, and the report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, decide, belowInstructions } from '../expectations.mjs';
import { reportText, headline, runsSummary } from '../report.mjs';

const spec = parse(`# Repeater expectations

## Repeats Main's prompt as a finding
Do (Main): Please list three words.
Expect (Repeater): shows one numbered finding

## Sends its finding to Main
Do (Repeater): /sidecar send main #1
See (Main): "1 sidecar note"
Absent (Main): "error"
`, 'Repeater');
const [one, two] = spec.items;

const given = { Repeater: ['Repeater\n1. List three\n   words'], Main: ['Main\n> Please list three words.'] };
const saw = { Repeater: [given.Repeater[0] + '\nstatus bar'], Main: [given.Main[0] + '\n1 sidecar note · fast'] };

test('a quote must come from a screen the Tester was shown, on that pane', () => {
  const pass = { verdict: 'pass', reason: 'ok', evidence: [{ pane: 'repeater', quote: '1. List three words' }] };
  assert.equal(decide(one, pass, given, saw).verdict, 'pass'); // wrapping and case folded; pane name any case
  assert.throws(() => decide(one, { ...pass, evidence: [{ pane: 'Main', quote: '1. List three words' }] }, given, saw), /Not on a screen you were shown/);
  // On the full screen the lab read, but not in what the Tester was shown: rejected.
  assert.throws(() => decide(one, { ...pass, evidence: [{ pane: 'Repeater', quote: 'status bar' }] }, given, saw), /Not on a screen you were shown/);
  assert.throws(() => decide(one, { ...pass, evidence: [{ pane: 'Critic', quote: 'List three' }] }, given, saw), /Not on a screen/);
});

test('a pass on an Expect line needs a quote; a fail does not', () => {
  assert.throws(() => decide(one, { verdict: 'pass', reason: 'ok', evidence: [] }, given, saw), /needs at least one quote/);
  assert.equal(decide(one, { verdict: 'fail', reason: 'no', evidence: [] }, given, saw).verdict, 'fail');
});

test('"absent" claims are checked against what the lab read', () => {
  const p = { verdict: 'fail', reason: 'x', evidence: [], absent: [{ pane: 'Repeater', text: 'status bar' }] };
  assert.throws(() => decide(one, p, given, saw), /ARE on screen/);
});

test('See and Absent lines are the lab\'s own checks and override the Tester', () => {
  const d = decide(two, { verdict: 'fail', reason: 'unsure', evidence: [] }, given, saw);
  assert.equal(d.verdict, 'pass'); // no Expect/Never: the lab decides alone
  assert.deepEqual(d.observed.map(o => o.ok), [true, true]);
  const noNote = { Main: ['Main\n> Please list three words.\nerror: no sidecar'] };
  const d2 = decide(two, { verdict: 'pass', reason: 'looks fine', evidence: [] }, given, noNote);
  assert.equal(d2.verdict, 'fail');
  assert.deepEqual(d2.observed.map(o => o.ok), [false, false]);
});

test('the report holds the headline, quotes, lab checks and overrides, never the instructions', () => {
  const instructions = 'Repeat Main\'s last prompt in at most five words, as one numbered finding.';
  const run = { sidecar: 'Repeater', sidecarModel: 'fast', model: 'p/m', testerModel: 'p/t', folder: 'sidecars/repeater', instructionsChars: instructions.length, instructionsArrived: true, work: false };
  const results = { items: [
    { id: 1, title: one.title, verdict: 'pass', tester: 'pass', reason: 'It repeated.', evidence: [{ pane: 'Repeater', quote: '1. List three words' }] },
    { id: 2, title: two.title, verdict: 'fail', tester: 'pass', reason: 'Seemed fine.', evidence: [], observed: [{ kind: 'see', pane: 'Main', text: '1 sidecar note', ok: false }] },
  ] };
  assert.equal(headline(results), '1 of 2 expectations failed');
  const md = reportText({ run, results, summary: 'One of two.', screens: { Main: '[typed] hi', Repeater: '[Repeater] 1. List three words' }, id: 'lab-abc123', when: new Date(0) });
  assert.match(md, /^# Repeater · lab report/);
  assert.match(md, /\*\*1 of 2 expectations failed\*\*/);
  assert.match(md, /## ✓ 1 · Repeats Main's prompt as a finding/);
  assert.match(md, /- Repeater: “1\. List three words”/);
  assert.match(md, /Lab check ✗ shows on Main: “1 sidecar note”/);
  assert.match(md, /The Tester said pass; the lab's own checks decided fail/);
  assert.match(md, /## What each pane showed/);
  assert.ok(!md.includes(instructions), 'the instructions text is not in the report');
  assert.equal(headline({ items: [{ verdict: 'pass' }] }), 'All expectations met');
});

test('a history read is cut below the instructions, even when wrapped or only its end is in range', () => {
  const instructions = 'Repeat the last prompt in at most five words, as one numbered finding. Never answer the prompt yourself.';
  const pane = ['│ Your instructions: Repeat the last prompt in at most', '│ five words, as one numbered finding. Never', '│ answer the prompt yourself.', '', '👁 Main\'s prompt · list three words', '1. List three words'];
  assert.equal(belowInstructions(pane.join('\n'), instructions), '\n👁 Main\'s prompt · list three words\n1. List three words');
  assert.equal(belowInstructions(pane.slice(1).join('\n'), instructions), '\n👁 Main\'s prompt · list three words\n1. List three words'); // the instructions's start is out of range
  assert.equal(belowInstructions('1. List three words', instructions), '1. List three words'); // no instructions in range: unchanged
  assert.equal(belowInstructions('anything', ''), 'anything');
});

test('--runs: how often each expectation passed, and which runs failed', () => {
  const run = (v1, v2, report) => ({ code: v1 === 'pass' && v2 === 'pass' ? 0 : 1, res: { report, items: [{ id: 1, title: 'Asks', verdict: v1 }, { id: 2, title: 'Blast radius', verdict: v2 }] } });
  const out = runsSummary('critic', [run('pass', 'pass', 'a.md'), run('pass', 'fail', 'b.md'), { code: 2 }]);
  assert.match(out, /^Critic: 1 of 3 runs passed$/m);
  assert.match(out, /^✗ 1 · Asks\s+2\/3  failed in run 3$/m);
  assert.match(out, /^✗ 2 · Blast radius\s+1\/3  failed in run 2, 3$/m);
  assert.match(out, /^Run 2: b\.md$/m);
  assert.match(out, /^Run 3: no report$/m);
  assert.match(runsSummary('critic', [run('pass', 'pass', 'a.md')], 3), /stopped early; 3 were asked for/);
  assert.match(runsSummary('critic', [run('pass', 'pass', 'a.md'), run('pass', 'pass', 'b.md')]), /^✓ 1 · Asks\s+2\/2$/m);
});
