// The agent lab's report: Markdown in agents/<name>/reports/ of the real project, plus a screenshot of the
// lab window. Adapted from herdr-pi-lab's report.mjs (0.5.0). Every quote in it was checked against a
// screen the Tester was shown; "What each pane showed" comes from the panes' Pi sessions (transcript()).
import fs from 'node:fs';
import path from 'node:path';
import * as core from './core.mjs';

const stamp = d => d.toISOString().replace(/:/g, '').replace(/\..*$/, '').replace('T', '-');
const fence = s => '~~~text\n' + String(s).replace(/~~~/g, '~ ~ ~').replace(/\s+$/, '') + '\n~~~';

/** The headline for a finished checklist: "All expectations met" or "1 of 2 expectations failed". */
export const headline = s => { const c = core.tally(s); return c.pass === c.total ? 'All expectations met' : `${c.total - c.pass} of ${c.total} expectations failed`; };

/** Pure: the report's Markdown. */
export function reportText({ run, results, summary, screens, shot, when = new Date(), id }) {
  const lines = [
    `# ${run.agent} · lab report`, '',
    `**${headline(results)}** · ${when.toLocaleString()} · run \`${id}\``, '',
    summary, '',
    `Agent: \`/agent ${run.work ? '--work ' : ''}${run.agent} --model ${run.agentModel} <Job from ${run.folder}/agent.md, ${run.jobChars} characters>\`${run.jobArrived ? ' · job arrived whole' : ''}`,
    `Models: Main \`${run.model}\` · ${run.agent} \`${run.agentModel}\` · Tester \`${run.testerModel}\``,
    `Expectations: \`${run.folder}/expectations.md\``, '',
  ];
  for (const i of results.items) {
    lines.push(`## ${i.verdict === 'pass' ? '✓' : '✗'} ${i.id} · ${i.title}`, '', i.reason || '(no reason given)', '');
    for (const e of i.evidence || []) lines.push(`- ${e.pane}: “${e.quote}”`);
    for (const a of i.absent || []) lines.push(`- Not on ${a.pane}: “${a.text}”`);
    for (const o of i.observed || []) lines.push(`- Lab check ${o.ok ? '✓' : '✗'} ${o.kind === 'see' ? 'shows' : 'does not show'} on ${o.pane}: “${o.text}”`);
    if (i.tester && i.tester !== i.verdict) lines.push(`- The Tester said ${i.tester}; the lab's own checks decided ${i.verdict}.`);
    lines.push('');
  }
  if (shot) lines.push(`![The lab window at the end of the run](${path.basename(shot)})`, '');
  lines.push('## What each pane showed', '', '_From each pane\'s Pi session; the agent\'s forked history and job are left out. The Tester never read this._', '');
  for (const [k, s] of Object.entries(screens)) lines.push(`### ${k}`, '', fence(s.length > 8000 ? '…' + s.slice(-8000) : s || '(nothing)'), '');
  return lines.join('\n');
}

/** Write the report (and a window screenshot) into agents/<name>/reports/ of the real project. */
export function writeReport(id, { summary }) {
  const run = core.readRun(id), results = core.readResults(id);
  const dir = path.join(run.project, run.folder, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const when = new Date(), base = path.join(dir, `${stamp(when)}-${id}`);
  let shot = `${base}.png`;
  try { core.app(id, ['shot', shot], { timeout: 40000 }); } catch {}
  if (!fs.existsSync(shot)) shot = undefined;
  const screens = Object.fromEntries(Object.entries(run.panes || {}).filter(([k]) => k !== 'Tester')
    .map(([k, t]) => [k, core.transcriptText(core.transcript(id, k)) || core.lastLines(core.screen(id, t), 60)]));
  const file = `${base}.md`;
  fs.writeFileSync(file, reportText({ run, results, summary, screens, shot, when, id }));
  return { file, shot };
}
