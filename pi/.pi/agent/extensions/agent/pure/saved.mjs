// Saved agents: agents/<name>/agent.md in the project. Only the text under "## Job" is the job,
// so the job the lab tested is the job /agent <name> opens with.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NAME, RESERVED } from './args.mjs';

export const JOB_LIMIT = 2400;

function agentFile(cwd, name) {
  const slug = String(name).trim().toLowerCase();
  if (!NAME.test(slug)) return undefined;
  const file = join(cwd, 'agents', slug, 'agent.md');
  return existsSync(file) ? { file, shown: `agents/${slug}/agent.md` } : undefined;
}

/** The "## Job" section of a saved agent, or undefined when there is no agent.md. Throws a plain message if unusable. */
export function savedJob(cwd, name) {
  const found = agentFile(cwd, name);
  if (!found) return undefined;
  const text = readFileSync(found.file, 'utf8');
  const m = /^##[ \t]+Job[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/m.exec(text);
  if (!m) throw Error(`${found.shown} has no "## Job" section. Add one: a paragraph telling the agent what to do.`);
  const body = m[1].replace(/\s+/g, ' ').trim();
  if (!body) throw Error(`${found.shown}: the "## Job" section is empty. Write what the agent should do under it.`);
  if (body.length > JOB_LIMIT) throw Error(`${found.shown}: the Job section is ${body.length.toLocaleString('en-US')} characters; /agent accepts up to 2,400.`);
  return body;
}

/** [name, description] for every agents/<name>/agent.md in the project. */
export function savedAgents(cwd) {
  let dirs = [];
  try { dirs = readdirSync(join(cwd, 'agents'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort(); } catch { return []; }
  return dirs.filter(n => NAME.test(n) && !RESERVED.test(n) && agentFile(cwd, n)).map(n => [n, `saved · agents/${n}/agent.md`]);
}
