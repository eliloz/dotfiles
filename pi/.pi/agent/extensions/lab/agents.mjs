// Agents in a project, as /lab new, /lab report, /lab list and completions see them. Plain ESM shared by
// index.ts and the tests. Adapted from herdr-pi-lab's index.ts (projectRoles, newRolePrompt) at 0.5.0.
import fs from 'node:fs';
import path from 'node:path';
import { FORMAT, locate } from './expectations.mjs';

/** Agents with an expectations file: agents/<folder>/expectations.md. Named by the file's "# Name …" title, else the folder. */
export function projectAgents(project) {
  const root = path.join(project, 'agents');
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

/** The newest report in agents/<name>/reports/, or undefined. */
export function latestReport(project, name) {
  const dir = path.join(locate(project, name).dir, 'reports');
  const f = fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => x.endsWith('.md')).sort().at(-1) : undefined;
  return f && path.join(dir, f);
}

/** What /lab report shows in the conversation: the report up to "What each pane showed", without the image line. */
export const reportExcerpt = text => text.split('## What each pane showed')[0].replace(/!\[[^\]]*\]\([^)]*\)\n?/g, '').trimEnd();

/**
 * /lab new's brief, sent into the conversation as a user turn. Unlike John's (which proposes changes to
 * existing expectations), an existing expectations.md stays untouched and only agent.md is written:
 * build guide line 404 ("If agents/<name>/expectations.md already exists, keep it untouched and only
 * write agent.md before testing").
 */
export function newAgentBrief(project, name, jobText, template = fs.readFileSync(new URL('./new-agent.md', import.meta.url), 'utf8')) {
  const loc = locate(project, name);
  const Name = name.charAt(0).toUpperCase() + name.slice(1);
  const exp = path.relative(project, loc.file), agentPath = path.relative(project, loc.agentFile);
  const hasExp = !loc.missing, hasAgent = fs.existsSync(loc.agentFile);
  const situation = [
    hasExp ? `\`${exp}\` already exists and is approved: **leave it exactly as it is** (no edits, no reformatting). Read it to learn what ${Name} must do.`
      : `${Name} is a new agent. It will live in \`${loc.folder}/\`.`,
    hasAgent ? `\`${agentPath}\` already exists: read it first, and change it only where the expectations need it.` : '',
  ].filter(Boolean).join(' ');
  const format = '   ~~~markdown\n' + FORMAT.replace(/<Agent>/g, Name).replace(/\(Agent\)/g, `(${Name})`).split('\n').map(l => '   ' + l).join('\n') + '\n   ~~~';
  const expectationSteps = hasExp
    ? `1. **No interview about the expectations**: they are settled. If the job is unclear from them${jobText ? ' and from what I said above' : ''}, ask me at most three short questions in one message, each with a suggested answer, and wait.\n2. **Skip writing expectations.** Go on to the agent.`
    : [
      `1. **Interview me.** Ask at most three short questions, all in one message, only about what you can't infer: what job the agent does, what should make it speak up, and what it must never do. Suggest an answer for each so I can just say yes.`,
      `2. **Write the expectations first**, in \`${exp}\`, using exactly this format:`,
      '',
      format,
      '',
      `   - Write 2–4 expectations. Each one is a short title and the steps a person would type, followed by what must (Expect) and must not (Never) happen on screen. Use See/Absent only for exact text the lab can check by itself.`,
      `   - The pane in parentheses is Main or ${Name}. Do lines are typed verbatim into that pane; most belong in Main. Write them as a person would type them. An agent watches Main: new prompts in Main reach it.`,
      `   - Say what the agent should do, never how its prompt should be worded. The Tester never sees the prompt.`,
      `   - Guest Main can only read files. To set up a case (plant a bug, change data), put \`Run: <shell command>\` under \`## Before\`; the lab runs it in the project copy before the first prompt.`,
      `   - Show me the file and **wait for my OK** before going on. Nothing else happens until I say yes.`,
    ].join('\n');
  const agentStep = `**Write the agent** in \`${agentPath}\`: \`# ${Name}\`, then \`## Job\` (one paragraph telling the agent what to do, under 2,400 characters; this is the only part /agent receives. An agent receives each prompt typed in Main and then each finished reply from Main, as two separate messages: the Job must say what to do for each, e.g. "When what arrives is Main's reply, reply with exactly 🟢 Nothing new"), \`## Use it when\` (two bullets), and \`## Examples\` (two prompts someone types in Main, and what ${Name} does). If ${Name} must change files or run commands, add the line \`Access: work\` under the title. Any other file ${Name}'s job tells it to read goes in \`${loc.folder}/\` too, committed to git (the lab copies tracked files only). Then go straight to the lab.`;
  return template
    .replaceAll('{{name}}', Name)
    .replaceAll('{{jobLine}}', jobText ? `: “${jobText}”` : '')
    .replaceAll('{{situation}}', situation)
    .replaceAll('{{expectationSteps}}', expectationSteps)
    .replaceAll('{{agentStep}}', agentStep)
    .replaceAll('{{agentPath}}', agentPath);
}
