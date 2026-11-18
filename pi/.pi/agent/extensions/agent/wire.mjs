// One private link per agent: a 127.0.0.1 TCP socket, opened with a single-use ticket file.
// Frames are JSON lines {id, method, data}; every call gets a receipt {id, value} or {id, error}.
import net from 'node:net';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX = 128 * 1024;
export const RECEIPT_MS = 8000;

/** Wrap a socket. `handle(method, data)` answers calls (may return a promise); `onClose` runs once. */
export function wire(socket, handle, onClose) {
  let buffer = '', closed = false;
  const pending = new Map();
  socket.setEncoding('utf8');
  socket.setNoDelay(true);

  function write(frame) {
    const line = JSON.stringify(frame) + '\n';
    if (closed || socket.destroyed || !socket.writable) throw Error('The agent link is closed.');
    if (Buffer.byteLength(line) > MAX) throw Error('Message too large for the agent link.');
    socket.write(line);
  }
  async function answer(row) {
    try { write({ id: row.id, value: (await handle(row.method, row.data)) ?? null }); }
    catch (err) { try { write({ id: row.id, error: String(err?.message ?? err).slice(0, 300) }); } catch {} }
  }

  socket.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > MAX * 2) return socket.destroy();
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      let row;
      try { row = JSON.parse(line); } catch { return socket.destroy(); }
      if (typeof row?.id !== 'string' || row.id.length > 64) return socket.destroy();
      if (typeof row.method === 'string') void answer(row);
      else if (pending.has(row.id)) {
        const p = pending.get(row.id);
        pending.delete(row.id);
        clearTimeout(p.timer);
        if (row.error) p.reject(Error(row.error)); else p.resolve(row.value);
      }
    }
  });
  socket.on('error', () => socket.destroy());
  socket.once('close', () => {
    closed = true;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('The link closed before a receipt came back; delivery unknown.')); }
    pending.clear();
    onClose?.();
  });

  return {
    get closed() { return closed; },
    close: () => socket.destroy(),
    call(method, data) {
      if (pending.size >= 48) return Promise.reject(Error('Too many messages waiting for a receipt.'));
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => { pending.delete(id); reject(Error('No receipt from the other pane; delivery unknown.')); }, RECEIPT_MS);
        timer.unref?.();
        pending.set(id, { resolve, reject, timer });
        try { write({ id, method, data }); } catch (err) { clearTimeout(timer); pending.delete(id); reject(err); }
      });
    },
  };
}

/**
 * Main's side. The first frame on a connection must be "hello" carrying the ticket's token;
 * `onHello(data, peer)` checks the identities and returns the welcome. After one accepted hello the
 * server stops listening and the ticket file is deleted, so the ticket cannot be used twice.
 */
export async function listen(onHello, handle, onClose) {
  const token = randomBytes(32);
  const dir = mkdtempSync(join(tmpdir(), 'pi-agent-'));
  const path = join(dir, 'ticket.json');
  const sockets = new Set();
  let taken = false, closed = false;

  const server = net.createServer(sock => {
    if (taken || closed) return sock.destroy();
    sockets.add(sock);
    sock.setTimeout(5000, () => sock.destroy());
    let accepted = false;
    const peer = wire(sock, async (method, data) => {
      if (!accepted) {
        const given = Buffer.from(String(data?.token ?? ''), 'hex');
        if (taken || closed || method !== 'hello' || given.length !== token.length || !timingSafeEqual(given, token)) {
          setImmediate(() => sock.destroy());
          throw Error('Invalid agent ticket.');
        }
        const welcome = await onHello(data, peer);
        accepted = taken = true;
        sock.setTimeout(0);
        server.close();
        rmSync(dir, { recursive: true, force: true });
        return welcome;
      }
      return handle(method, data);
    }, () => { sockets.delete(sock); if (accepted && !closed) onClose?.(); });
  });
  server.maxConnections = 4;

  function close() {
    if (closed) return;
    closed = true;
    server.close();
    for (const s of sockets) s.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
  try {
    await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  } catch (err) { close(); throw err; }
  return {
    path,
    close,
    /** Write the ticket (mode 0600, fails if it exists). */
    ticket(data) {
      writeFileSync(path, JSON.stringify({ ...data, token: token.toString('hex'), port: server.address().port }), { flag: 'wx', mode: 0o600 });
    },
  };
}

/** The agent's side. */
export function connect(ticket, handle, onClose) {
  return wire(net.connect(ticket.port, '127.0.0.1'), handle, onClose);
}
