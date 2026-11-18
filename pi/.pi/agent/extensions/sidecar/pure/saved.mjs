// Saved sidecars: sidecars/<name>/sidecar.md in the project. Only the text under "## Instructions" counts,
// so the instructions the lab tested are the instructions /sidecar <name> opens with.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NAME, RESERVED } from './args.mjs';

export const INSTRUCTIONS_LIMIT = 2400;

function sidecarFile(cwd, name) {
  const slug = String(name).trim().toLowerCase();
  if (!NAME.test(slug)) return undefined;
  const file = join(cwd, 'sidecars', slug, 'sidecar.md');
  return existsSync(file) ? { file, shown: `sidecars/${slug}/sidecar.md` } : undefined;
}

/** The "## Instructions" section of a saved sidecar, or undefined when there is no sidecar.md. Throws a plain message if unusable. */
export function savedInstructions(cwd, name) {
  const found = sidecarFile(cwd, name);
  if (!found) return undefined;
  const text = readFileSync(found.file, 'utf8');
  const m = /^##[ \t]+Instructions[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/m.exec(text);
  if (!m) throw Error(`${found.shown} has no "## Instructions" section. Add one: a paragraph telling the sidecar what to do.`);
  const body = m[1].replace(/\s+/g, ' ').trim();
  if (!body) throw Error(`${found.shown}: the "## Instructions" section is empty. Write what the sidecar should do under it.`);
  if (body.length > INSTRUCTIONS_LIMIT) throw Error(`${found.shown}: the Instructions section is ${body.length.toLocaleString('en-US')} characters; /sidecar accepts up to 2,400.`);
  return body;
}

/** [name, description] for every sidecars/<name>/sidecar.md in the project. */
export function savedSidecars(cwd) {
  let dirs = [];
  try { dirs = readdirSync(join(cwd, 'sidecars'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort(); } catch { return []; }
  return dirs.filter(n => NAME.test(n) && !RESERVED.test(n) && sidecarFile(cwd, n)).map(n => [n, `saved · sidecars/${n}/sidecar.md`]);
}
