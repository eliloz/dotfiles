// Expectations: sidecars/<name>/expectations.md, a plain Markdown file a person reads and edits.
// Parsing, the lab's own See/Absent checks and quote matching are deterministic; only Expect and
// Never lines need the Tester's judgment. Adapted from herdr-pi-lab's expectations.mjs (0.5.0).
import fs from 'node:fs';
import path from 'node:path';

export const KINDS = ['do', 'run', 'tools', 'expect', 'never', 'see', 'absent', 'check'];
/** Pi's built-in tools a skill test may give guest Main with a Tools line. bash is never the default. */
export const PI_TOOLS = ['read', 'grep', 'find', 'ls', 'write', 'edit', 'bash'];
const BEFORE = /^(before|setup)$/i;
export const NAME = /^[a-z][a-z0-9_-]{0,31}$/i;

export const FORMAT = `# <Sidecar> expectations

## Before
Run: <optional: a shell command the lab runs in the project copy first, e.g. to plant a bug>
Do (Main): <optional: a prompt Main gets before the sidecar opens>
Tools (Main): <skill tests only, optional: guest Main's tools, e.g. read, grep, find, ls, write, edit (default read, grep, find, ls)>

## <Expectation title>
Do (Main): <what to type in Main>
Do (Sidecar): <only when the check is about typing in the sidecar's own pane, e.g. /sidecar send main #1>
Expect (Sidecar): <what must happen, judged from the screen>
Never (Sidecar): <what must not happen>
See (Main): "<exact text that must appear>"
Absent (Main): "<exact text that must not appear>"
Check: <optional: a shell command the lab runs in the project copy after the step; exit 0 passes>`;

const unquote = text => { const t = text.trim(), m = t.match(/^["“'‘](.*)["”'’]$/s); return m ? m[1] : t; };

/**
 * Parse expectations Markdown into { title, before: [line], tools, items: [{ id, title, lines: [line] }] },
 * where line = { kind, pane, text, line } and tools is guest Main's tool list from a Tools line (undefined: the default). "(Sidecar)" means the sidecar under test. Throws with a line number.
 */
export function parse(markdown, sidecar = 'Sidecar') {
  const out = { title: '', before: [], tools: undefined, items: [] };
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
    const m = line.match(/^(Do|Run|Tools|Expect|Never|See|Absent|Check)\s*(?:\(([^)]+)\))?\s*:\s*(.+)$/i);
    if (!m) {
      // An indented line continues the line above it.
      if (section?.lines.length && /^\s/.test(raw)) { section.lines.at(-1).text += ' ' + line.trim(); continue; }
      if (!section) continue; // prose before the first heading is commentary
      throw Error(`Line ${n}: start with Do, Run, Tools, Expect, Never, See, Absent or Check, e.g. "Expect (${sidecar}): asks which homes it covers".`);
    }
    if (!section) throw Error(`Line ${n}: put "${m[1]}" under a "## Title" heading.`);
    const kind = m[1].toLowerCase();
    let pane = (m[2] || (kind === 'do' ? 'Main' : 'Sidecar')).trim();
    if (/^sidecar$/i.test(pane) || pane.toLowerCase() === sidecar.toLowerCase()) pane = sidecar;
    else if (/^main$/i.test(pane)) pane = 'Main';
    // Any other pane name is kept; the lab notes it (extraPanes) and does not open it, like herdr-pi-lab.
    if (section.setup && !['do', 'run', 'tools'].includes(kind)) throw Error(`Line ${n}: the Before section only holds Do, Run and Tools lines.`);
    if (kind === 'run' && !section.setup) throw Error(`Line ${n}: Run lines belong under "## Before"; the lab runs them before the first prompt.`);
    if (kind === 'tools') {
      if (!section.setup) throw Error(`Line ${n}: the Tools line belongs under "## Before"; it sets guest Main's tools for the whole lab run.`);
      if (out.tools) throw Error(`Line ${n}: one Tools line per file.`);
      if (m[2] && !/^main$/i.test(m[2].trim())) throw Error(`Line ${n}: Tools sets guest Main's tools: write "Tools (Main): …".`);
      const tools = m[3].split(/[\s,]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
      const bad = tools.filter(t => !PI_TOOLS.includes(t));
      if (bad.length) throw Error(`Line ${n}: ${bad.join(', ')} ${bad.length === 1 ? 'is not a tool' : 'are not tools'} guest Main can get. Use some of: ${PI_TOOLS.join(', ')}.`);
      out.tools = [...new Set(tools)];
      continue;
    }
    if (kind === 'run' || kind === 'check') {
      if (m[2] && !/^lab$/i.test(m[2].trim())) throw Error(`Line ${n}: the lab runs ${m[1]} lines itself, in the project copy: write "${m[1]}: <command>".`);
      section.lines.push({ kind, pane: 'lab', text: m[3].trim(), line: n }); continue;
    }
    const text = kind === 'see' || kind === 'absent' ? unquote(m[3]) : m[3].trim();
    if (!text) throw Error(`Line ${n}: ${m[1]} needs text.`);
    section.lines.push({ kind, pane, text, line: n });
  }
  if (!out.items.length) throw Error('No expectations yet. Add a "## Title" section with at least one Expect, Never, See, Absent or Check line.');
  for (const item of out.items) if (!item.lines.some(l => l.kind !== 'do')) throw Error(`"${item.title}" has no check. Add an Expect, Never, See, Absent or Check line.`);
  return out;
}

export const judged = item => item.lines.filter(l => l.kind === 'expect' || l.kind === 'never');
export const observed = item => item.lines.filter(l => l.kind === 'see' || l.kind === 'absent');
export const steps = item => item.lines.filter(l => l.kind === 'do');
export const checks = item => item.lines.filter(l => l.kind === 'check');

/** Panes named in the file other than Main and the sidecar: the lab does not open them, it says so. */
export function extraPanes(spec, sidecar) {
  const all = new Set([...spec.before, ...spec.items.flatMap(i => i.lines)].map(l => l.pane));
  for (const p of ['Main', sidecar, 'lab']) all.delete(p);
  return [...all];
}

/** Terminal text wraps, pads and decorates lines: compare letters and digits only. */
export const fold = text => String(text).normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, '');
export function contains(screen, quote) {
  const q = fold(quote);
  return q.length > 0 && fold(screen).includes(q);
}

/**
 * Screen text with everything up to the end of the sidecar's instructions cut off. A history read reaches the top
 * of a pane, where the instructions are shown (the sidecar's first message; the /sidecar line typed in Main), and the
 * Tester must not read it. Matches on the instructions's last words, so instructions whose start is out of range is cut too.
 */
export function belowInstructions(text, instructions) {
  const tail = fold(instructions).slice(-40);
  if (tail.length < 12) return String(text);
  const lines = String(text).split('\n'), ends = [];
  let folded = '';
  for (const l of lines) { folded += fold(l); ends.push(folded.length); }
  const at = folded.lastIndexOf(tail);
  if (at < 0) return String(text);
  return lines.slice(ends.findIndex(e => e >= at + tail.length) + 1).join('\n');
}

/** sidecars/<name>/: its folder, its expectations file and its sidecar.md. */
export function locate(project, name) {
  if (!NAME.test(String(name || ''))) throw Error(`"${name}" is not a sidecar name. Use one word, such as Critic (a letter first, up to 32 characters).`);
  const dir = path.join(project, 'sidecars', name.toLowerCase());
  const file = path.join(dir, 'expectations.md');
  return { dir, file, sidecarFile: path.join(dir, 'sidecar.md'), folder: `sidecars/${name.toLowerCase()}`, missing: !fs.existsSync(file) };
}

/** Where a skill under test lives: .agents/skills/<name>/, with its SKILL.md and expectations.md. */
export const SKILLS = '.agents/skills';
export function locateSkill(project, name) {
  if (!name) throw Error('Name the skill: lab test skill <name>, its folder in .agents/skills/.');
  if (!NAME.test(String(name))) throw Error(`"${name}" is not a skill name. Use the skill's folder name, such as grilling.`);
  const folder = `${SKILLS}/${name}`, dir = path.join(project, SKILLS, name);
  const file = path.join(dir, 'expectations.md'), skillFile = path.join(dir, 'SKILL.md');
  return { dir, file, skillFile, folder, missing: !fs.existsSync(file), noSkill: !fs.existsSync(skillFile) };
}

/**
 * The sidecar's instructions: the "## Instructions" section of sidecar.md, whitespace collapsed. Without a "## Instructions" heading,
 * the whole file minus its title (herdr-pi-lab). undefined when there is no sidecar.md.
 */
export function instructions(dir) {
  const file = path.join(dir, 'sidecar.md');
  if (!fs.existsSync(file)) return undefined;
  const text = fs.readFileSync(file, 'utf8');
  const m = /^##[ \t]+Instructions[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/m.exec(text);
  const shown = `sidecars/${path.basename(dir)}/sidecar.md`;
  const body = (m ? m[1] : text.replace(/^#.*$/m, '')).replace(/\s+/g, ' ').trim();
  if (!body) throw Error(`${shown} needs a "## Instructions" section: one paragraph telling the sidecar what to do.`);
  if (body.length > 2400) throw Error(`${shown}: the Instructions section is ${body.length.toLocaleString('en-US')} characters; /sidecar accepts up to 2,400.`);
  return body;
}

/** "Access: work" on its own line in sidecar.md: the sidecar changes files or runs commands, so it opens with /sidecar --work. */
export function access(dir) {
  const file = path.join(dir, 'sidecar.md');
  return fs.existsSync(file) && /^Access:[ \t]*work\b/im.test(fs.readFileSync(file, 'utf8')) ? 'work' : 'read';
}

/**
 * What `lab test …` means: a scenarios file (the default lab-scenarios.md, or a file named first),
 * one sidecar by name (a single word that is not a file: sidecars/<name>/), or a scenario in plain words.
 */
export function testTarget(args, isFile) {
  const [first, ...rest] = args;
  if (!first || isFile(first)) return { kind: 'scenarios', file: first, pick: rest.join(' ') || undefined };
  if (first === 'skill' && args.length <= 2) return { kind: 'skill', name: rest[0] };
  if (args.length === 1 && NAME.test(first)) return { kind: 'sidecar', name: first };
  return { kind: 'words', text: args.join('\n') };
}

/**
 * One verdict, decided by the lab. `given` maps a pane to the screen text the Tester was shown during
 * this expectation (its quotes must come from there: screen only, no transcript); `saw` maps a pane to
 * every screen the lab read during it (See/Absent are checked there). Throws, for the Tester to fix,
 * on a quote it was not shown, an "absent" claim that is on screen, or a pass without a quote.
 * `ran` holds the results of this expectation's Check lines, [{ line, command, status, ok }], run by the lab after the
 * step; a Check line with no result (never run) fails. Returns { verdict, observed: [{ kind, pane, text, ok }] }.
 * See/Absent and Check override the Tester's verdict.
 */
export function decide(item, p, given, saw, ran = []) {
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
  for (const l of checks(item)) { const r = ran.find(x => x.line === l.line); obs.push({ kind: 'check', pane: 'lab', text: l.text, ok: !!r?.ok, status: r ? r.status : 'not run' }); }
  const judgedOk = judged(item).length ? p.verdict === 'pass' : true;
  return { verdict: judgedOk && obs.every(o => o.ok) ? 'pass' : 'fail', observed: obs };
}
