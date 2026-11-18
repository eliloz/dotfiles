// What an agent may see of Main: user prompt text and finished reply text. Nothing else.
export const LIMIT = 4000;

export const clean = s => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').trim();

/** Keep the head and the tail; the end of a prompt usually holds the actual request. */
export function trim(text, limit = LIMIT) {
  if (text.length <= limit) return text;
  const marker = '\n[… middle trimmed …]\n';
  const head = Math.floor((limit - marker.length) * 0.45);
  return text.slice(0, head) + marker + text.slice(text.length - (limit - marker.length - head));
}

/** Expanded skill blocks at the start of a prompt are named, not passed on. */
function stripSkills(text) {
  const names = [];
  for (;;) {
    const m = /^\s*<skill name="([\w.-]+)"[^>\n]*>\n[\s\S]*?\n<\/skill>[ \t]*(?:\n|$)/.exec(text);
    if (!m) break;
    names.push(m[1]);
    text = text.slice(m[0].length);
  }
  text = text.trim();
  return names.length ? `${text || '(no request text)'}\n[skills attached: ${names.join(', ')}]` : text;
}

/** message → {from: 'user'|'assistant', text} or null. */
export function observe(m) {
  if (!m || typeof m !== 'object') return null;
  const finished = m.role === 'assistant' && (m.stopReason === 'stop' || m.stopReason === 'length');
  if (m.role !== 'user' && !finished) return null;
  const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content : [];
  if (parts.some(b => b?.type === 'toolCall')) return null;
  let text = clean(parts.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n'));
  if (m.role === 'user') text = stripSkills(text);
  return text ? { from: m.role, text: trim(text) } : null;
}

/** First non-empty line of a text, for a one-line preview. */
const firstLine = s => String(s ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? '';

/** What an agent pane stores about one delivered batch (the full text goes to the model only). */
export function watchDetails(batch, skipped = 0) {
  return { skipped, seen: batch.map(v => ({ from: v.from, lines: String(v.text).split('\n').length, preview: firstLine(v.text).slice(0, 160) })) };
}

/**
 * One short line per observation, so Main's conversation does not fill the agent's pane and push
 * the agent's own findings off screen. Example: 👁 Main's reply (9 lines) · Here are three words
 */
export function watchLines(details) {
  const out = [];
  const skipped = Number(details?.skipped) || 0;
  if (skipped) out.push(`👁 ${skipped} older observation${skipped === 1 ? '' : 's'} skipped`);
  for (const s of Array.isArray(details?.seen) ? details.seen : []) {
    const who = s?.from === 'assistant' ? "Main's reply" : "Main's prompt";
    const size = Number(s?.lines) > 1 ? ` (${s.lines} lines)` : '';
    out.push(`👁 ${who}${size}${s?.preview ? ` · ${s.preview}` : ''}`);
  }
  return out.length ? out : ['👁 Watching Main'];
}

/** The one line shown for a direct message from Main. */
export const directLine = text => `✉ From Main · ${firstLine(text)}`;
