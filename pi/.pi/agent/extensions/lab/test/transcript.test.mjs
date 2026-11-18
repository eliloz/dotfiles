// transcript(): what the Tester reads from a pane's Pi session. The sidecar's instructions must never be in it.
// The fixture copies the entry shapes of a real /sidecar session (Pi 1.5.2): fork history, the instructions as a
// user message, session_info, the owner entry, then the saved system prompt holding the instructions again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MARK, sessionFile, transcriptOf, transcriptText, readSession, repliesSince } from '../core.mjs';
import { parse, decide } from '../expectations.mjs';

const INSTRUCTIONS = 'Repeat the last prompt in Main in at most five words, as one numbered finding.';
const at = n => `2026-11-17T20:54:${String(n).padStart(2, '0')}.000Z`;
const msg = (n, role, text) => ({ type: 'message', id: `m${n}`, timestamp: at(n), message: { role, content: [{ type: 'text', text }] } });

const sidecar = [
  { type: 'session', version: 3, id: 's-sidecar', timestamp: at(0), cwd: '/x', parentSession: '/x/main.jsonl' },
  msg(1, 'user', 'Forked history: please plan the lake cabin listing'),
  msg(2, 'assistant', 'Forked reply from Main'),
  msg(3, 'user', `Any messages above are a copy of Main's conversation, for context only. From here on you are Repeater.\n\nYour instructions: ${INSTRUCTIONS}`),
  { type: 'session_info', id: 'i', timestamp: at(4), name: 'Repeater' },
  { type: 'custom', customType: MARK.owner, id: 'o', timestamp: at(5), data: { id: 's-sidecar', name: 'Repeater', instructions: INSTRUCTIONS } },
  { type: 'thinking_level_change', id: 't', timestamp: at(6), thinkingLevel: 'low' },
  { type: 'message', id: 'sys', timestamp: at(7), message: { role: 'system', content: '', sections: { sidecar: `Your instructions as Repeater: ${INSTRUCTIONS}` } } },
  { type: 'custom_message', customType: MARK.watch, id: 'w', timestamp: at(8), display: true, content: "Watching Main:\nMain's prompt:\nlist three cabin words" },
  { type: 'message', id: 'a1', timestamp: at(9), message: { role: 'assistant', content: [{ type: 'thinking', thinking: `my instructions are ${INSTRUCTIONS}` }, { type: 'text', text: 'Repeater 1: list three cabin words' }, { type: 'toolCall', id: 'c', name: 'read' }] } },
  { type: 'custom_message', customType: MARK.direct, id: 'd', timestamp: at(10), display: true, content: 'Message from the person in Main, sent to you directly:\n#1' },
  msg(11, 'assistant', `You asked me: my instructions are ${INSTRUCTIONS.replace(/ /g, '\n')} Done.`),
  { type: 'message', id: 'tr', timestamp: at(12), message: { role: 'toolResult', content: [{ type: 'text', text: 'file contents' }] } },
];

const main = [
  { type: 'session', version: 3, id: 's-main', timestamp: at(0), cwd: '/x' },
  { type: 'session_info', id: 'i', timestamp: at(0), name: 'Main' },
  { type: 'message', id: 'sys', timestamp: at(1), message: { role: 'system', content: '' } },
  msg(2, 'user', 'list three cabin words'),
  msg(3, 'assistant', '1. Lakefront 2. Dock 3. Cozy'),
  { type: 'custom', customType: MARK.note, id: 'n', timestamp: at(4), data: { id: 'n1', name: 'Repeater', text: 'Repeater 1: list three cabin words', to: 's-main' } },
  msg(5, 'user', 'ok'),
  { type: 'custom_message', customType: MARK.inbox, id: 'ib', timestamp: at(6), display: true, details: { ids: ['n1'] }, content: 'Notes sent explicitly by your sidecars:\nRepeater: Repeater 1: list three cabin words' },
  msg(7, 'assistant', 'Noted.'),
];

const folded = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

test('a sidecar transcript starts after its owner entry and never holds the instructions', () => {
  const items = transcriptOf(sidecar, 'Repeater');
  const text = transcriptText(items);
  assert.ok(!folded(text).includes(folded(INSTRUCTIONS)), text);
  assert.ok(!folded(text).includes('fivewords'), text);
  assert.ok(!text.includes('Forked'), 'the forked history is left out');
  assert.deepEqual(items.map(i => i.who), ['lab', 'Repeater', 'lab', 'Repeater']);
  assert.equal(items[1].text, 'Repeater 1: list three cabin words', 'text blocks only: no thinking, no tool calls');
  assert.match(items[2].text, /\/sidecar send: #1\)$/);
  assert.match(items[3].text, /^You asked me: my instructions are \(the sidecar's instructions, withheld\) Done\.$/);
});

test('Main\'s transcript shows prompts, replies, and notes as lab events', () => {
  const items = transcriptOf(main, 'Main');
  assert.deepEqual(items.map(i => `${i.who}: ${i.text}`), [
    'typed: list three cabin words',
    'Main: 1. Lakefront 2. Dock 3. Cozy',
    'lab: (a note from Repeater arrived and waits for the next prompt: Repeater 1: list three cabin words)',
    'typed: ok',
    'lab: (1 sidecar note joined this prompt)',
    'Main: Noted.',
  ]);
});

test('sessionFile finds a pane by its session name, newest first, any case', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-sessions-'));
  const dir = path.join(profile, 'sessions', '--x--');
  fs.mkdirSync(dir, { recursive: true });
  const put = (f, entries, mtime) => { const p = path.join(dir, f); fs.writeFileSync(p, entries.map(e => JSON.stringify(e)).join('\n') + '\n{broken'); fs.utimesSync(p, mtime, mtime); return p; };
  put('a.jsonl', main, 1000);
  const older = put('b.jsonl', sidecar, 2000);
  const newer = put('c.jsonl', sidecar.map(e => e.type === 'custom' ? { ...e, data: { ...e.data, instructions: 'other' } } : e), 3000);
  put('d.jsonl', [...main, { type: 'session_info', name: 'Renamed' }], 4000);
  assert.equal(sessionFile(profile, 'repeater'), newer);
  assert.notEqual(sessionFile(profile, 'Repeater'), older);
  assert.equal(sessionFile(profile, 'MAIN'), path.join(dir, 'a.jsonl'), 'the last session_info name counts');
  assert.equal(sessionFile(profile, 'Nobody'), undefined);
  assert.equal(sessionFile(path.join(profile, 'missing'), 'Main'), undefined);
  assert.equal(readSession(path.join(dir, 'a.jsonl')).length, main.length + 1, 'a broken line is read as {}');
  fs.rmSync(profile, { recursive: true, force: true });
});

// Pi is fullscreen: a long reply's start leaves the screen and no terminal history keeps it, so a See line on the
// first line of a long reply could never pass. lab_do adds each pane's reply to the current step from its session.
test('repliesSince gives only the pane\'s own replies after a point: no typed text, no earlier replies', () => {
  const items = [
    { who: 'typed', text: '/skill:grilling … SKILL TEXT …' },
    { who: 'Main', text: 'Q1 first round' },
    { who: 'typed', text: 'Yes to all.' },
    { who: 'lab', text: '(an event)' },
    { who: 'Main', text: 'Q4 second round,' },
    { who: 'Main', text: 'continued' },
  ];
  assert.equal(repliesSince(items, 0, 'Main'), 'Q1 first round\n\nQ4 second round,\n\ncontinued');
  assert.equal(repliesSince(items, 2, 'Main'), 'Q4 second round,\n\ncontinued');
  assert.equal(repliesSince(items, 6, 'Main'), '');
  assert.ok(!repliesSince(items, 0, 'Main').includes('SKILL TEXT'));
});

test('a See line and a quote match a reply whose start scrolled off, once the reply is in given and saw', () => {
  const [it] = parse('# x\n\n## Opens with a round\nDo (Main): /skill:grilling idea\nExpect (Main): asks numbered questions\nSee (Main): "Q1"\n', 'Main').items;
  const screen = 'Q5 - Reason\n➡️ Yes.';
  const reply = '❓ **Q1** - **Who may withdraw**: Only the buyer?\n\n➡️ Yes.\n\n' + screen;
  const p = { verdict: 'pass', reason: 'ok', evidence: [{ pane: 'Main', quote: 'Q1 - Who may withdraw' }] };
  assert.equal(decide(it, { ...p, evidence: [{ pane: 'Main', quote: 'Q5 - Reason' }] }, { Main: [screen] }, { Main: [screen] }).verdict, 'fail');
  assert.equal(decide(it, p, { Main: [screen, reply] }, { Main: [screen, reply] }).verdict, 'pass');
});
