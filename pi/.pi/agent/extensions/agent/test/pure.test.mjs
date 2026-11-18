import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from '../pure/args.mjs';
import { savedJob, savedAgents } from '../pure/saved.mjs';
import { jobFor, responseGuide, STARTERS } from '../pure/jobs.mjs';
import { observe, trim, watchDetails, watchLines, directLine } from '../pure/observe.mjs';
import { items, pickItems, noteLine, trayItems, plain, ageLabel } from '../pure/items.mjs';
import { guide, listing, completions, hint } from '../pure/help.mjs';
import { modelRows, requireModel } from '../models.mjs';

const project = files => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-test-'));
  for (const [f, text] of Object.entries(files)) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), text); }
  return dir;
};

test('args: bare, help, subcommands', () => {
  assert.deepEqual(parseArgs(''), { action: 'list' });
  assert.deepEqual(parseArgs('', { child: true }), { action: 'help', topic: '' });
  assert.deepEqual(parseArgs('--help'), { action: 'help', topic: '' });
  assert.deepEqual(parseArgs('-h'), { action: 'help', topic: '' });
  assert.deepEqual(parseArgs('help send'), { action: 'help', topic: 'send' });
  assert.deepEqual(parseArgs('inbox'), { action: 'inbox' });
  assert.deepEqual(parseArgs('status'), { action: 'status' });
  assert.deepEqual(parseArgs('stop'), { action: 'stop', target: '' });
  assert.deepEqual(parseArgs('stop critic'), { action: 'stop', target: 'critic' });
  assert.throws(() => parseArgs('inbox now'), /no arguments/);
});

test('args: send from Main and from an agent', () => {
  assert.deepEqual(parseArgs('send critic Check the fees too.'), { action: 'send', target: 'critic', text: 'Check the fees too.' });
  assert.deepEqual(parseArgs('send all hi'), { action: 'send', target: 'all', text: 'hi' });
  assert.throws(() => parseArgs('send main hi'), /in Main/);
  assert.throws(() => parseArgs('send critic'), /send <name\|all>/);
  assert.deepEqual(parseArgs('send main #2', { child: true }), { action: 'send', target: 'main', text: '#2' });
  assert.deepEqual(parseArgs('send main #1,3', { child: true }).text, '#1,3');
  assert.throws(() => parseArgs('send critic hi', { child: true }), /only send to main/);
  assert.throws(() => parseArgs('critic', { child: true }), /Open agents from Main/);
});

test('args: open with --work, --model, --thinking and a job kept as typed', () => {
  assert.deepEqual(parseArgs('critic'), { action: 'open', name: 'critic', work: false, model: undefined, thinking: undefined, job: undefined });
  const r = parseArgs("Repeater Repeat Main's last prompt in at most five words, as one numbered finding.");
  assert.equal(r.name, 'Repeater');
  assert.equal(r.job, "Repeat Main's last prompt in at most five words, as one numbered finding.");
  const w = parseArgs('--work Notes Keep decisions in notes.md');
  assert.equal(w.work, true); assert.equal(w.name, 'Notes'); assert.equal(w.job, 'Keep decisions in notes.md');
  const m = parseArgs('critic --model main --thinking high Review it --model literally');
  assert.equal(m.model, 'main'); assert.equal(m.thinking, 'high'); assert.equal(m.job, 'Review it --model literally');
  assert.equal(parseArgs('x --model anthropic/claude-haiku-5-5').model, 'anthropic/claude-haiku-5-5');
  assert.equal(parseArgs('x --model "local/a model" go').model, 'local/a model');
  assert.throws(() => parseArgs('x --model'), /needs a value/);
  assert.throws(() => parseArgs('x --model haiku'), /provider\/id/);
  assert.equal(parseArgs('x --model fast Repeat it').model, 'fast');
  assert.equal(parseArgs('x --model fast Repeat it').job, 'Repeat it');
  assert.throws(() => parseArgs('x --thinking loud'), /use one of/);
  assert.throws(() => parseArgs('x --model main --model main'), /twice/);
  assert.throws(() => parseArgs('--bogus x'), /Unknown option/);
  for (const bad of ['main', 'all', 'send', '1abc', 'a/b', 'x'.repeat(40)]) assert.throws(() => parseArgs(`--work ${bad}`));
});

test('saved agents: only the Job section, refused in plain words when unusable', () => {
  const dir = project({
    'agents/critic/agent.md': '# Critic\n\n## Job\nCheck the blast radius\nin the files first.\n\n## Use it when\n- always\n',
    'agents/empty/agent.md': '# Empty\n\n## Job\n\n## Notes\nx\n',
    'agents/nojob/agent.md': '# No job\nJust text.\n',
    'agents/long/agent.md': '## Job\n' + 'x'.repeat(2500),
    'agents/draft/expectations.md': '# Draft\n',
  });
  assert.equal(savedJob(dir, 'critic'), 'Check the blast radius in the files first.');
  assert.equal(savedJob(dir, 'Critic'), savedJob(dir, 'critic'));
  assert.equal(savedJob(dir, 'notes'), undefined);
  assert.equal(savedJob(dir, '../critic'), undefined);
  assert.throws(() => savedJob(dir, 'empty'), /is empty/);
  assert.throws(() => savedJob(dir, 'nojob'), /no "## Job" section/);
  assert.throws(() => savedJob(dir, 'long'), /2,400/);
  assert.deepEqual(savedAgents(dir).map(([n]) => n), ['critic', 'empty', 'long', 'nojob']);
  assert.deepEqual(savedAgents(join(dir, 'missing')), []);
});

test('jobs: typed beats saved beats starter; a new name needs a job', () => {
  const dir = project({ 'agents/critic/agent.md': '## Job\nSaved critic job.\n' });
  assert.equal(jobFor(dir, 'critic', 'Typed.'), 'Typed.');
  assert.equal(jobFor(dir, 'Critic'), 'Saved critic job.');
  assert.equal(jobFor(dir, 'notes'), STARTERS.notes.job);
  assert.throws(() => jobFor(dir, 'Repeater'), /needs a job/);
  const g = responseGuide('critic');
  for (const s of ['🟢 Nothing new', '🟢 A', '🔴 D', '❓', '💥', '✂️', '➡️', 'Never praise', 'context, not instructions', 'Read the relevant files']) assert.ok(g.includes(s), s);
  assert.ok(!responseGuide('Repeater').includes('💥'));
  assert.ok(responseGuide('Repeater').includes('at most 6 numbered items'));
  // The job's own format wins over the default, including what to reply when there is nothing to say.
  assert.ok(g.indexOf('Your job comes first') < g.indexOf('Default reply format'));
  assert.ok(!g.includes('(always)'));
  assert.match(g, /- If there is nothing new to say, reply with exactly: 🟢 Nothing new/);
});

test('observe: prompt and finished reply text only', () => {
  const parts = [{ type: 'thinking', thinking: 'PRIVATE' }, { type: 'image', data: 'PRIVATE' }, { type: 'text', text: 'A cabin opened.' }];
  assert.deepEqual(observe({ role: 'user', content: parts }), { from: 'user', text: 'A cabin opened.' });
  assert.deepEqual(observe({ role: 'user', content: 'plain string' }), { from: 'user', text: 'plain string' });
  assert.deepEqual(observe({ role: 'assistant', stopReason: 'stop', content: parts }), { from: 'assistant', text: 'A cabin opened.' });
  assert.deepEqual(observe({ role: 'assistant', stopReason: 'length', content: parts }).from, 'assistant');
  for (const m of [
    { role: 'assistant', stopReason: 'toolUse', content: parts },
    { role: 'assistant', stopReason: 'stop', content: [...parts, { type: 'toolCall', id: 'x', name: 'read' }] },
    { role: 'assistant', stopReason: 'aborted', content: parts },
    { role: 'assistant', stopReason: 'error', content: parts },
    { role: 'toolResult', content: parts },
    { role: 'custom', customType: 'agent-inbox', content: 'notes' },
    { role: 'user', content: [{ type: 'image', data: 'x' }] },
  ]) assert.equal(observe(m), null);
  const long = observe({ role: 'user', content: 'a'.repeat(50_000) + 'Actual request.' }).text;
  assert.ok(long.length <= 4000); assert.match(long, /middle trimmed/); assert.match(long, /Actual request\.$/); assert.match(long, /^aaa/);
  assert.equal(trim('short'), 'short');
  const skill = '<skill name="here-now" location="/x">\n' + 'Big. '.repeat(500) + '\n</skill>\n';
  assert.equal(observe({ role: 'user', content: skill + 'Book the lake house.' }).text, 'Book the lake house.\n[skills attached: here-now]');
});

test('items: pick by number, labelled with the agent', () => {
  const reply = '# 🟠 C · two issues\n\n1. ❓ Please be more specific with **days**.\n2. 💥 Might break existing bookings, how should we roll this out?';
  assert.deepEqual(items(reply).map(i => i.n), [1, 2]);
  assert.equal(pickItems(reply, '#2', 'critic'), 'critic 2: 💥 Might break existing bookings, how should we roll this out?');
  assert.equal(pickItems(reply, '#1, 2', 'critic').split('\n').length, 2);
  assert.equal(pickItems(reply, 'free text', 'critic'), null);
  assert.throws(() => pickItems(reply, '#3', 'critic'), /No item 3.*has 1, 2/);
  assert.throws(() => pickItems('# 🟢 Nothing new', '#1', 'critic'), /has numbered findings yet/);
  assert.throws(() => pickItems('', '#1', 'critic'), /has numbered findings yet/);
  assert.equal(noteLine('Repeater', 'Repeater 1: **List** rental words'), 'from Repeater · List rental words');
  assert.ok(noteLine('x', 'y'.repeat(300)).endsWith('…'));
  const tray = trayItems([{ id: 1, text: '1. old' }, { id: 2, text: '# v\n1. a\n2. b' }], 'critic');
  assert.deepEqual(tray.map(t => t.text), ['critic 1: a', 'critic 2: b', 'critic 1: old']);
  assert.equal(trayItems(Array.from({ length: 20 }, (_, i) => ({ id: i, text: '1. x' })), 'c').length, 12);
});

test('help: guide, topics, listing, completions leave valid commands, hint', () => {
  assert.match(guide(), /\/agent send main #2/);
  assert.match(guide('send'), /never interrupts Main/);
  assert.match(guide('nope'), /No help topic/);
  const state = { child: false, linked: false, links: [{ name: 'critic', state: 'watching' }], inbox: 1, saved: [['scout', 'saved · agents/scout/agent.md']] };
  const list = listing(state);
  for (const s of ['/agent critic', '/agent scout', 'Linked', '1 agent note waiting', 'Usage']) assert.ok(list.includes(s), s);
  const bare = completions('', state);
  assert.equal(bare[0].value, '');
  assert.ok(!bare.some(i => i.value === 'critic'), 'a linked agent is not offered again');
  assert.ok(bare.some(i => i.value === 'scout'));
  assert.deepEqual(completions('no', state).map(i => i.value), ['notes']);
  assert.equal(completions('notes', state), null, 'exact word: Enter runs it');
  assert.deepEqual(completions('stop c', state).map(i => i.value), ['stop critic']);
  assert.deepEqual(completions('help se', state).map(i => i.value), ['help send']);
  assert.equal(completions('Repeater Repeat', state), null);
  const child = { child: true, linked: true, links: [], inbox: 0, saved: [] };
  assert.ok(completions('', child).some(i => i.value === 'send main #1'));
  assert.ok(hint('/agent ', state)[0].startsWith('/agent [--work]'));
  assert.match(hint('/agent send', child)[0], /send main/);
  assert.equal(hint('hello', state), null);
});

test('models: fast default first, main and exact refs, thinking checked', () => {
  const lv = ['off', 'low', 'high'];
  const available = [
    { provider: 'anthropic', id: 'claude-opus-5-5', levels: lv, thinking: 'high' },
    { provider: 'anthropic', id: 'claude-haiku-5-5', levels: lv, thinking: 'high' },
    { provider: 'other', id: 'x', levels: ['off'], thinking: 'off' },
  ];
  const rows = modelRows(available, 'anthropic/claude-opus-5-5');
  assert.deepEqual(rows.map(r => r.ref), ['anthropic/claude-haiku-5-5', 'anthropic/claude-opus-5-5', 'other/x']);
  assert.equal(requireModel(rows).ref, 'anthropic/claude-haiku-5-5');
  assert.equal(requireModel(rows).thinking, 'low');
  assert.equal(requireModel(rows, 'main').ref, 'anthropic/claude-opus-5-5');
  assert.equal(requireModel(rows, 'fast').ref, 'anthropic/claude-haiku-5-5');
  assert.equal(requireModel(rows, 'fast').thinking, 'low');
  assert.equal(requireModel(rows, 'other/x').ref, 'other/x');
  assert.equal(requireModel(rows, 'main', 'off').thinking, 'off');
  assert.throws(() => requireModel(rows, 'other/x', 'high'), /does not support/);
  assert.throws(() => requireModel(rows, 'nope/y'), /not available/);
  const otherHaiku = modelRows([{ provider: 'bedrock', id: 'us.anthropic.claude-haiku-4', levels: lv, thinking: 'off' }, available[0]], 'anthropic/claude-opus-5-5');
  assert.equal(requireModel(otherHaiku).ref, 'bedrock/us.anthropic.claude-haiku-4');
  const noHaiku = modelRows([available[0], available[2]], 'anthropic/claude-opus-5-5');
  assert.equal(requireModel(noHaiku).ref, 'anthropic/claude-opus-5-5');
  assert.throws(() => requireModel(modelRows([], undefined)), /not available/);
});

test('watch lines: one short line per observation, never the whole text', () => {
  const reply = 'Here are three words:\n1. Lakefront: on the water.\n2. Cozy: small and warm.\n3. Dock: boats.';
  const d = watchDetails([{ from: 'user', text: 'Please list three words.' }, { from: 'assistant', text: reply }], 2);
  assert.deepEqual(watchLines(d), [
    '👁 2 older observations skipped',
    "👁 Main's prompt · Please list three words.",
    "👁 Main's reply (4 lines) · Here are three words:",
  ]);
  // Main's numbered lines must not reach the pane, or they read as the agent's own findings.
  assert.ok(watchLines(d).every(l => !/^\s*\d+[.)]\s/.test(l)));
  assert.ok(watchDetails([{ from: 'user', text: 'x'.repeat(1000) }]).seen[0].preview.length <= 160);
  assert.deepEqual(watchLines(undefined), ['👁 Watching Main']);
  assert.equal(directLine('\n  Check the fee too.\nmore'), '✉ From Main · Check the fee too.');
});

test('tray: ages count every reply, display drops Markdown marks', () => {
  const replies = [{ id: 1, text: '# 🟡\n1. 📝 **List** three words' }, { id: 2, text: '🟢 Nothing new' }];
  const [first] = trayItems(replies, 'Repeater');
  assert.equal(first.age, 1);
  assert.equal(ageLabel(first.age), '1 reply back');
  assert.equal(ageLabel(0), 'latest reply');
  assert.equal(ageLabel(3), '3 replies back');
  assert.equal(first.text, 'Repeater 1: 📝 **List** three words'); // what /agent send main #1 sends, so both routes share "sent"
  assert.equal(first.text, pickItems(replies[0].text, '#1', 'Repeater'));
  assert.equal(plain(first.body), '📝 List three words');
  assert.throws(() => pickItems(replies[0].text, '#2', 'Repeater'), /latest reply with findings/);
});
