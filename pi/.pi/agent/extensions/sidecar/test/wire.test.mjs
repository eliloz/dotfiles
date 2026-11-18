import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { listen, connect } from '../wire.mjs';

const closedOf = peer => new Promise(r => { const t = setInterval(() => { if (peer.closed) { clearInterval(t); r(); } }, 10); });

test('one private ticket links one sidecar; receipts flow both ways; the ticket is single-use', async () => {
  const notes = [];
  let mainSide, ended = 0;
  const channel = await listen(
    (hello, peer) => { assert.equal(hello.child, 'child-1'); mainSide = peer; return { pending: ['early'] }; },
    (method, data) => { if (method === 'note') { notes.push(data.text); return { state: 'in Main\'s inbox' }; } throw Error('Unknown'); },
    () => ended++,
  );
  channel.ticket({ child: 'child-1' });
  const ticket = JSON.parse(readFileSync(channel.path, 'utf8'));
  assert.equal(statSync(channel.path).mode & 0o777, 0o600);
  assert.equal(ticket.token.length, 64);

  // A wrong token is refused and the socket dropped.
  const stranger = connect({ ...ticket, token: '00'.repeat(32) }, () => null, () => {});
  await assert.rejects(stranger.call('hello', { token: '00'.repeat(32), child: 'child-1' }), /Invalid sidecar ticket|closed/);

  const watched = [];
  const child = connect(ticket, (method, data) => { if (method === 'watch') { watched.push(data.text); return { state: 'queued' }; } throw Error('Unknown'); }, () => {});
  const welcome = await child.call('hello', { token: ticket.token, child: 'child-1' });
  assert.deepEqual(welcome, { pending: ['early'] });
  assert.equal(existsSync(channel.path), false, 'ticket deleted after use');

  assert.deepEqual(await child.call('note', { text: 'Repeater 1: x' }), { state: 'in Main\'s inbox' });
  assert.deepEqual(notes, ['Repeater 1: x']);
  assert.deepEqual(await mainSide.call('watch', { from: 'user', text: 'hello' }), { state: 'queued' });
  assert.deepEqual(watched, ['hello']);
  await assert.rejects(child.call('bogus', {}), /Unknown/);

  // A second connection with the same ticket is refused.
  const again = connect(ticket, () => null, () => {});
  await assert.rejects(again.call('hello', { token: ticket.token, child: 'child-1' }), /closed|ECONNREFUSED|Invalid/);

  child.close();
  await closedOf(mainSide);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(ended, 1);
  channel.close();
});

test('a hello with the right token but wrong identity is refused and the ticket stays usable', async () => {
  const channel = await listen(hello => { if (hello.child !== 'right') throw Error('Wrong or stale sidecar identity.'); return { ok: true }; }, () => null, () => {});
  channel.ticket({});
  const ticket = JSON.parse(readFileSync(channel.path, 'utf8'));
  const wrong = connect(ticket, () => null, () => {});
  await assert.rejects(wrong.call('hello', { token: ticket.token, child: 'wrong' }), /Wrong or stale/);
  wrong.close();
  const right = connect(ticket, () => null, () => {});
  assert.deepEqual(await right.call('hello', { token: ticket.token, child: 'right' }), { ok: true });
  right.close();
  channel.close();
});
