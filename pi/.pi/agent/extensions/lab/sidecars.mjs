// Sidecars in a project, as /lab new, /lab report, /lab list and completions see them. Plain ESM shared by
// index.ts and the tests. Adapted from herdr-pi-lab's index.ts (projectRoles, newRolePrompt) at 0.5.0.
import fs from 'node:fs';
import path from 'node:path';
import { FORMAT, locate, locateSkill } from './expectations.mjs';

/** Sidecars with an expectations file: sidecars/<folder>/expectations.md. Named by the file's "# Name …" title, else the folder. */
export function projectSidecars(project) {
  const root = path.join(project, 'sidecars');
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const n of fs.readdirSync(root).sort()) {
    const file = path.join(root, n, 'expectations.md');
    if (!fs.existsSync(file)) continue;
    const h = fs.readFileSync(file, 'utf8').match(/^#\s+(\S+)/m);
    out.push(h && h[1].toLowerCase() === n.toLowerCase() ? h[1] : n[0].toUpperCase() + n.slice(1));
  }
  return out;
}

const newestIn = dir => { const f = fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => x.endsWith('.md')).sort().at(-1) : undefined; return f && path.join(dir, f); };
/** The newest report in sidecars/<name>/reports/, or undefined. */
export const latestReport = (project, name) => newestIn(path.join(locate(project, name).dir, 'reports'));
/** The newest report in .agents/skill-tests/<name>/reports/, or undefined. */
export const latestSkillReport = (project, name) => newestIn(path.join(locateSkill(project, name).tests, 'reports'));

/** What /lab report shows in the conversation: the report up to "What each pane showed", without the image line. */
export const reportExcerpt = text => text.split('## What each pane showed')[0].replace(/!\[[^\]]*\]\([^)]*\)\n?/g, '').trimEnd();

/**
 * /lab new's brief, sent into the conversation as a user turn. Unlike John's (which proposes changes to
 * existing expectations), an existing expectations.md stays untouched and only sidecar.md is written:
 * build guide line 404 ("If sidecars/<name>/expectations.md already exists, keep it untouched and only
 * write sidecar.md before testing").
 */
export function newSidecarBrief(project, name, instructionsText, template = fs.readFileSync(new URL('./new-sidecar.md', import.meta.url), 'utf8')) {
  const loc = locate(project, name);
  const Name = name.charAt(0).toUpperCase() + name.slice(1);
  const exp = path.relative(project, loc.file), sidecarPath = path.relative(project, loc.sidecarFile);
  const hasExp = !loc.missing, hasSidecar = fs.existsSync(loc.sidecarFile);
  const situation = [
    hasExp ? `\`${exp}\` already exists and is approved: **leave it exactly as it is** (no edits, no reformatting). Read it to learn what ${Name} must do.`
      : `${Name} is a new sidecar. It will live in \`${loc.folder}/\`.`,
    hasSidecar ? `\`${sidecarPath}\` already exists: read it first, and change it only where the expectations need it.` : '',
  ].filter(Boolean).join(' ');
  const format = '   ~~~markdown\n' + FORMAT.replace(/<Sidecar>/g, Name).replace(/\(Sidecar\)/g, `(${Name})`).split('\n').map(l => '   ' + l).join('\n') + '\n   ~~~';
  const expectationSteps = hasExp
    ? `1. **No interview about the expectations**: they are settled. If the instructions are unclear from them${instructionsText ? ' and from what I said above' : ''}, ask me at most three short questions in one message, each with a suggested answer, and wait.\n2. **Skip writing expectations.** Go on to the sidecar.`
    : [
      `1. **Interview me.** Ask at most three short questions, all in one message, only about what you can't infer: what the sidecar does, what should make it speak up, and what it must never do. Suggest an answer for each so I can just say yes.`,
      `2. **Write the expectations first**, in \`${exp}\`, using exactly this format:`,
      '',
      format,
      '',
      `   - Write 2–4 expectations. Each one is a short title and the steps a person would type, followed by what must (Expect) and must not (Never) happen on screen. Use See/Absent only for exact text the lab can check by itself.`,
      `   - The pane in parentheses is Main or ${Name}. Do lines are typed verbatim into that pane; most belong in Main. Write them as a person would type them. A sidecar watches Main: new prompts in Main reach it.`,
      `   - Say what the sidecar should do, never how its prompt should be worded. The Tester never sees the prompt.`,
      `   - Guest Main can only read files. To set up a case (plant a bug, change data), put \`Run: <shell command>\` under \`## Before\`; the lab runs it in the project copy before the first prompt.`,
      `   - Show me the file and **wait for my OK** before going on. Nothing else happens until I say yes.`,
    ].join('\n');
  const sidecarStep = `**Write the sidecar** in \`${sidecarPath}\`: \`# ${Name}\`, then \`## Instructions\` (one paragraph telling the sidecar what to do, under 2,400 characters; this is the only part /sidecar receives. A sidecar receives each prompt typed in Main and then each finished reply from Main, as two separate messages: the Instructions must say what to do for each, e.g. "When what arrives is Main's reply, reply with exactly 🟢 Nothing new"), \`## Use it when\` (two bullets), and \`## Examples\` (two prompts someone types in Main, and what ${Name} does). If ${Name} must change files or run commands, add the line \`Access: work\` under the title. Any other file ${Name}'s instructions tells it to read goes in \`${loc.folder}/\` too, committed to git (the lab copies tracked files only). Then go straight to the lab.`;
  return template
    .replaceAll('{{name}}', Name)
    .replaceAll('{{instructionsLine}}', instructionsText ? `: “${instructionsText}”` : '')
    .replaceAll('{{situation}}', situation)
    .replaceAll('{{expectationSteps}}', expectationSteps)
    .replaceAll('{{sidecarStep}}', sidecarStep)
    .replaceAll('{{sidecarPath}}', sidecarPath);
}
