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
    // Any other pane name is kept; the lab notes it (extraPanes) and does not open it, like herdr-pi-lab.
    if (section.setup && kind !== 'do' && kind !== 'run') throw Error(`Line ${n}: the Before section only holds Do and Run lines.`);
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

/** Panes named in the file other than Main and the agent: the lab does not open them, it says so. */
export function extraPanes(spec, agent) {
  const all = new Set([...spec.before, ...spec.items.flatMap(i => i.lines)].map(l => l.pane));
  for (const p of ['Main', agent, 'lab']) all.delete(p);
  return [...all];
}

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
 * The agent's job: the "## Job" section of agent.md, whitespace collapsed. Without a "## Job" heading,
 * the whole file minus its title (herdr-pi-lab). undefined when there is no agent.md.
 */
export function job(dir) {
  const file = path.join(dir, 'agent.md');
  if (!fs.existsSync(file)) return undefined;
  const text = fs.readFileSync(file, 'utf8');
  const m = /^##[ \t]+Job[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/m.exec(text);
  const shown = `agents/${path.basename(dir)}/agent.md`;
  const body = (m ? m[1] : text.replace(/^#.*$/m, '')).replace(/\s+/g, ' ').trim();
  if (!body) throw Error(`${shown} needs a "## Job" section: one paragraph telling the agent what to do.`);
  if (body.length > 2400) throw Error(`${shown}: the Job section is ${body.length.toLocaleString('en-US')} characters; /agent accepts up to 2,400.`);
  return body;
}

/** "Access: work" on its own line in agent.md: the agent changes files or runs commands, so it opens with /agent --work. */
export function access(dir) {
  const file = path.join(dir, 'agent.md');
  return fs.existsSync(file) && /^Access:[ \t]*work\b/im.test(fs.readFileSync(file, 'utf8')) ? 'work' : 'read';
}

/**
 * What `lab test …` means: a scenarios file (the default lab-scenarios.md, or a file named first),
 * one agent by name (a single word that is not a file: agents/<name>/), or a scenario in plain words.
 */
export function testTarget(args, isFile) {
  const [first, ...rest] = args;
  if (!first || isFile(first)) return { kind: 'scenarios', file: first, pick: rest.join(' ') || undefined };
  if (args.length === 1 && NAME.test(first)) return { kind: 'agent', name: first };
  return { kind: 'words', text: args.join('\n') };
}

/**
 * One verdict, decided by the lab. `given` maps a pane to the screen text the Tester was shown during
 * this expectation (its quotes must come from there: screen only, no transcript); `saw` maps a pane to
 * every screen the lab read during it (See/Absent are checked there). Throws, for the Tester to fix,
 * on a quote it was not shown, an "absent" claim that is on screen, or a pass without a quote.
 * Returns { verdict, observed: [{ kind, pane, text, ok }] }. See/Absent override the Tester's verdict.
 */
export function decide(item, p, given, saw) {
  const on = (pool, pane) => {
    const key = Object.keys(pool).find(k => k.toLowerCase() === String(pane).trim().toLowerCase());
    return key === undefined ? undefined : [].concat(pool[key]).join('\n');
  };
  const bad = (p.evidence || []).filter(e => { const s = on(given, e.pane); return s === undefined || !contains(s, e.quote); });
  if (bad.length) throw Error(`Not on a screen you were shown, so not evidence: ${bad.map(e => `${e.pane}: "${e.quote}"`).join('; ')}. Quote exactly from a lab_do or lab_look screen, or fail the expectation.`);
  const there = (p.absent || []).filter(a => contains(on(saw, a.pane) || '', a.text));
  if (there.length) throw Error(`These ARE on screen: ${there.map(a => `${a.pane}: "${a.text}"`).join('; ')}. Re-check before claiming they are absent.`);
  if (judged(item).length && p.verdict === 'pass' && !(p.evidence || []).length) throw Error('A pass needs at least one quote from the screen.');
  const obs = observed(item).map(l => { const found = contains(on(saw, l.pane) || '', l.text); return { kind: l.kind, pane: l.pane, text: l.text, ok: l.kind === 'see' ? found : !found }; });
  const judgedOk = judged(item).length ? p.verdict === 'pass' : true;
  return { verdict: judgedOk && obs.every(o => o.ok) ? 'pass' : 'fail', observed: obs };
}
