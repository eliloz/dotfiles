// Numbered items in an agent's reply: the pieces that can be sent to Main one at a time.
export const NOTE_LIMIT = 2400;

export function items(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s{0,3}(\d{1,2})[.)]\s+(\S.*)$/.exec(line);
    if (m) out.push({ n: Number(m[1]), text: m[2].trim() });
  }
  return out;
}

/** "#2" or "#1,3" → those items of `reply`, labelled with the agent. Returns null if `ref` is free text. */
export function pickItems(reply, ref, name) {
  const m = /^#\s*(\d{1,2}(?:\s*,\s*\d{1,2})*)\s*$/.exec(String(ref).trim());
  if (!m) return null;
  if (!reply) throw Error('No reply here has numbered findings yet.');
  const list = items(reply);
  if (!list.length) throw Error('No reply here has numbered findings yet. Send your own words instead: /agent send main <text>');
  const want = [...new Set(m[1].split(',').map(s => Number(s.trim())))];
  const missing = want.filter(n => !list.some(i => i.n === n));
  if (missing.length) throw Error(`No item ${missing.join(', ')} in the latest reply with findings; it has ${list.map(i => i.n).join(', ')}.`);
  return want.map(n => `${name} ${n}: ${list.find(i => i.n === n).text}`).join('\n');
}

/** The one line Main shows when a note arrives. */
export function noteLine(name, text) {
  const esc = String(name).replace(/[^\w-]/g, '');
  const body = String(text).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().replace(new RegExp(`^${esc} \\d{1,2}: `, 'i'), '');
  return `from ${name} · ${body.length > 96 ? body.slice(0, 95).trimEnd() + '…' : body}`;
}

/** Text for the screen: Markdown bold and code marks removed. What is sent keeps them. */
export const plain = s => String(s ?? '').replace(/\*\*|__|`/g, '');

/**
 * Selectable items from the newest replies, newest reply first, items in order. `replies` holds
 * every finished reply (also "🟢 Nothing new"), so `age` counts real replies back from the newest.
 * `text` is what is sent to Main; `body` is the item alone, for display.
 */
export function trayItems(replies, name, keep = 12) {
  const out = [];
  replies.slice(-keep).reverse().forEach((reply, age) => {
    for (const i of items(reply.text)) out.push({ key: `${reply.id}:${i.n}`, age, n: i.n, body: i.text, text: `${name} ${i.n}: ${i.text}` });
  });
  return out;
}

/** "latest reply", "1 reply back", "3 replies back". */
export const ageLabel = age => (age === 0 ? 'latest reply' : `${age} repl${age === 1 ? 'y' : 'ies'} back`);
