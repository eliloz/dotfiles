// Expectations: agents/<name>/expectations.md, a plain Markdown file a person reads and edits.
// Parsing, the lab's own See/Absent checks and quote matching are deterministic; only Expect and
// Never lines need the Tester's judgment. Adapted from herdr-pi-lab's expectations.mjs (0.5.0).
import fs from 'node:fs';
import path from 'node:path';

export const KINDS = ['do', 'run', 'expect', 'never', 'see', 'absent'];
const BEFORE = /^(before|setup)$/i;
export const NAME = /^[a-z][a-z0-9_-]{0,31}$/i;

export const FORMAT = `# <Agent> expectations

## Before
Run: <optional: a shell command the lab runs in the project copy first, e.g. to plant a bug>
Do (Main): <optional: a prompt Main gets before the agent opens>

## <Expectation title>
Do (Main): <what to type in Main>
Do (Agent): <only when the check is about typing in the agent's own pane, e.g. /agent send main #1>
Expect (Agent): <what must happen, judged from the screen>
Never (Agent): <what must not happen>
See (Main): "<exact text that must appear>"
Absent (Main): "<exact text that must not appear>"`;

const unquote = text => { const t = text.trim(), m = t.match(/^["“'‘](.*)["”'’]$/s); return m ? m[1] : t; };

/**
 * Parse expectations Markdown into { title, before: [line], items: [{ id, title, lines: [line] }] },
 * where line = { kind, pane, text, line }. "(Agent)" means the agent under test. Throws with a line number.
 */
export function parse(markdown, agent = 'Agent') {
  const out = { title: '', before: [], items: [] };
  let section = null, n = 0;
  for (const raw of String(markdown).split(/\r?\n/)) {
    n++;
    const line = raw.replace(/^\s*[-*]\s+/, '').trimEnd();
    if (!line.trim() || line.trim().startsWith('<!--')) continue;
    const h1 = line.match(/^#\s+(.*)$/);
    if (h1) { out.title = h1[1].trim(); continue; }
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      const title = h2[1].replace(/^\d+[.)]\s*/, '').trim();
      if (BEFORE.test(title)) {
        if (out.items.length) throw Error(`Line ${n}: "## ${title}" must come before the first expectation.`);
        section = { setup: true, lines: out.before };
      } else { const item = { id: out.items.length + 1, title, lines: [] }; out.items.push(item); section = item; }
      continue;
    }
    const m = line.match(/^(Do|Run|Expect|Never|See|Absent)\s*(?:\(([^)]+)\))?\s*:\s*(.+)$/i);
    if (!m) {
      // An indented line continues the line above it.
      if (section?.lines.length && /^\s/.test(raw)) { section.lines.at(-1).text += ' ' + line.trim(); continue; }
      if (!section) continue; // prose before the first heading is commentary
      throw Error(`Line ${n}: start with Do, Run, Expect, Never, See or Absent, e.g. "Expect (${agent}): asks which homes it covers".`);
    }
    if (!section) throw Error(`Line ${n}: put "${m[1]}" under a "## Title" heading.`);
    const kind = m[1].toLowerCase();
    let pane = (m[2] || (kind === 'do' ? 'Main' : 'Agent')).trim();
    if (/^agent$/i.test(pane) || pane.toLowerCase() === agent.toLowerCase()) pane = agent;
    else if (/^main$/i.test(pane)) pane = 'Main';
    else throw Error(`Line ${n}: the pane in brackets is Main or ${agent}, not "${pane}".`);
    if (section.setup && kind !== 'do' && kind !== 'run') throw Error(`Line ${n}: the Before section only holds Do and Run lines.`);
    if (section.setup && kind === 'do' && pane !== 'Main') throw Error(`Line ${n}: Before runs before ${agent} opens, so its Do lines go to Main.`);
    if (kind === 'run' && !section.setup) throw Error(`Line ${n}: Run lines belong under "## Before"; the lab runs them before the first prompt.`);
    if (kind === 'run') { section.lines.push({ kind, pane: 'lab', text: m[3].trim(), line: n }); continue; }
    const text = kind === 'see' || kind === 'absent' ? unquote(m[3]) : m[3].trim();
    if (!text) throw Error(`Line ${n}: ${m[1]} needs text.`);
    section.lines.push({ kind, pane, text, line: n });
  }
  if (!out.items.length) throw Error('No expectations yet. Add a "## Title" section with at least one Expect, Never, See or Absent line.');
  for (const item of out.items) if (!item.lines.some(l => l.kind !== 'do')) throw Error(`"${item.title}" has no check. Add an Expect, Never, See or Absent line.`);
  return out;
}

export const judged = item => item.lines.filter(l => l.kind === 'expect' || l.kind === 'never');
export const observed = item => item.lines.filter(l => l.kind === 'see' || l.kind === 'absent');
export const steps = item => item.lines.filter(l => l.kind === 'do');

/** Terminal text wraps, pads and decorates lines: compare letters and digits only. */
export const fold = text => String(text).normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, '');
export function contains(screen, quote) {
  const q = fold(quote);
  return q.length > 0 && fold(screen).includes(q);
}

/** agents/<name>/: its folder, its expectations file and its agent.md. */
export function locate(project, name) {
  if (!NAME.test(String(name || ''))) throw Error(`"${name}" is not an agent name. Use one word, such as Critic (a letter first, up to 32 characters).`);
  const dir = path.join(project, 'agents', name.toLowerCase());
  const file = path.join(dir, 'expectations.md');
  return { dir, file, agentFile: path.join(dir, 'agent.md'), folder: `agents/${name.toLowerCase()}`, missing: !fs.existsSync(file) };
}

/**
 * The agent's job: the "## Job" section of agent.md, whitespace collapsed (the same rule as /agent's
 * saved.mjs). undefined when there is no agent.md; an error when it has no usable Job section.
 */
export function job(dir) {
  const file = path.join(dir, 'agent.md');
  if (!fs.existsSync(file)) return undefined;
  const m = /^##[ \t]+Job[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/m.exec(fs.readFileSync(file, 'utf8'));
  const shown = `agents/${path.basename(dir)}/agent.md`;
  if (!m) throw Error(`${shown} has no "## Job" section. Add one: a paragraph telling the agent what to do.`);
  const body = m[1].replace(/\s+/g, ' ').trim();
  if (!body) throw Error(`${shown}: the "## Job" section is empty. Write what the agent should do under it.`);
  if (body.length > 2400) throw Error(`${shown}: the Job section is ${body.length.toLocaleString('en-US')} characters; /agent accepts up to 2,400.`);
  return body;
}

/** "Access: work" on its own line in agent.md: the agent changes files or runs commands, so it opens with /agent --work. */
export function access(dir) {
  const file = path.join(dir, 'agent.md');
  return fs.existsSync(file) && /^Access:[ \t]*work\b/im.test(fs.readFileSync(file, 'utf8')) ? 'work' : 'read';
}
