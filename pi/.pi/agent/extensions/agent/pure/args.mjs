// Parse what follows "/agent". Pure: no Pi, no Herdr.
//
//   /agent                                  list (Main) · help (agent pane)
//   /agent --help | -h | help [topic]       guide
//   /agent [--work] NAME [--model X] [--thinking L] [JOB…]
//   /agent send <name|all|main> <text>
//   /agent inbox | status | stop [name]

export const NAME = /^[a-z][a-z0-9_-]{0,31}$/i;
export const RESERVED = /^(main|all|send|inbox|status|stop|help|open|list)$/i;
export const THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function checkName(name) {
  if (!NAME.test(name)) throw Error(`"${name}" is not an agent name. Use one word such as Critic or release-notes (a letter first, up to 32 characters).`);
  if (RESERVED.test(name)) throw Error(`"${name}" is a /agent subcommand, not an agent name.`);
  return name;
}

/** Leading --model / --thinking switches after NAME. Once job text starts, it is kept as typed. */
function switches(rest) {
  const out = {};
  for (;;) {
    const m = /^--(model|thinking)(?:\s+("(?:[^"\\]|\\.)*"|\S+))?(?:\s+([\s\S]*))?$/.exec(rest);
    if (!m) break;
    const [, key, raw, tail] = m;
    if (!raw || raw.startsWith('--')) throw Error(`--${key} needs a value. Example: /agent critic --model anthropic/claude-haiku-5-5 --thinking low`);
    if (out[key] !== undefined) throw Error(`--${key} is given twice.`);
    let value = raw;
    if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { throw Error(`--${key}: the quoted value is not closed.`); } }
    if (key === 'thinking' && !THINKING.includes(value)) throw Error(`--thinking ${value}: use one of ${THINKING.join(', ')}.`);
    if (key === 'model' && value !== 'main' && value !== 'fast' && !/^[^/\s]+\/\S.*$/.test(value)) throw Error(`--model ${value}: use provider/id (for example anthropic/claude-haiku-5-5), fast or main.`);
    out[key] = value;
    rest = (tail ?? '').trim();
  }
  return { ...out, job: rest };
}

export function parseArgs(raw, { child = false } = {}) {
  const text = String(raw ?? '').trim();
  if (!text) return child ? { action: 'help', topic: '' } : { action: 'list' };
  const [, first, rest = ''] = /^(\S+)\s*([\s\S]*)$/.exec(text);
  const word = first.toLowerCase();

  if (word === '--help' || word === '-h' || word === 'help') return { action: 'help', topic: rest.trim().toLowerCase() };
  if (word === 'inbox' || word === 'status' || word === 'list') {
    if (rest.trim()) throw Error(`/agent ${word} takes no arguments.`);
    return { action: word };
  }
  if (word === 'stop') {
    const target = rest.trim();
    if (target && /\s/.test(target)) throw Error('Use /agent stop NAME (one name).');
    return { action: 'stop', target };
  }
  if (word === 'send') {
    const m = /^(\S+)\s+([\s\S]*\S)\s*$/.exec(rest);
    if (!m) throw Error(child ? 'Use /agent send main #N or /agent send main <text>.' : 'Use /agent send <name|all> <text>.');
    const target = m[1];
    if (child && target.toLowerCase() !== 'main') throw Error('From an agent pane you can only send to main: /agent send main #1');
    if (!child && target.toLowerCase() === 'main') throw Error('You are in Main. Send to an agent by name, or to all.');
    return { action: 'send', target, text: m[2] };
  }
  if (child) throw Error('Open agents from Main. Here you can use /agent send main #N, status, stop and help.');

  let body = text, work = false;
  const w = /^--work(?:\s+([\s\S]*))?$/.exec(body);
  if (w) { work = true; body = (w[1] ?? '').trim(); }
  if (body.startsWith('-')) throw Error(`Unknown option ${body.split(/\s/, 1)[0]}. Run /agent --help`);
  const m = /^(\S+)\s*([\s\S]*)$/.exec(body);
  if (!m) throw Error('Name the agent: /agent --work NAME [job]');
  const name = checkName(m[1]);
  const { model, thinking, job } = switches(m[2].trim());
  return { action: 'open', name, work, model, thinking, job: job || undefined };
}
