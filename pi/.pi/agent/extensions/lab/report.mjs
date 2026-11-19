// The report of a sidecar or skill test: Markdown in <run.folder>/reports/ of the real project
// (sidecars/<name>/ or .agents/skills/<name>/), plus a screenshot of the
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
  const skill = run.kind === 'skill';
  const files = run.skillFiles?.copied || [];
  const lines = [
    `# ${skill ? `Skill ${run.skill}` : run.sidecar} · lab report`, '',
    `**${headline(results)}** · ${when.toLocaleString()} · run \`${id}\``, '',
    summary, '',
    skill
      ? `Skill: guest Main started with \`--no-skills --skill <staged copy of ${run.folder}/>\` (${files.length} file${files.length === 1 ? '' : 's'}: ${files.join(', ') || 'none'})`
      : `Sidecar: \`/sidecar ${run.work ? '--work ' : ''}${run.sidecar} --model ${run.sidecarModel} <Instructions from ${run.folder}/sidecar.md, ${run.instructionsChars} characters>\`${run.instructionsArrived ? ' · instructions arrived whole' : ''}`,
    skill
      ? `Models: Main \`${run.model}\` · Tester \`${run.testerModel}\``
      : `Models: Main \`${run.model}\` · ${run.sidecar} \`${run.sidecarModel}\` · Tester \`${run.testerModel}\``,
    ...(skill ? [
      `Main's tools: \`${run.mainTools || 'read,grep,find,ls'}\`${/(^|,)bash(,|$)/.test(run.mainTools || '') ? ' (bash: Main could run commands; the lab gives it no GitHub or GitLab login)' : ''}`,
      `Tracker: local Markdown in \`.scratch/\` (the lab's default)${run.tracker ? `; the project's own tracker file is ${run.tracker.project}` : ''}`,
    ] : []),
    `Expectations: \`${run.selftest ? run.expectations : `${run.folder}/expectations.md`}\``, '',
  ];
  for (const i of results.items) {
    lines.push(`## ${i.verdict === 'pass' ? '✓' : '✗'} ${i.id} · ${i.title}`, '', i.reason || '(no reason given)', '');
    for (const e of i.evidence || []) lines.push(`- ${e.pane}: “${e.quote}”`);
    for (const a of i.absent || []) lines.push(`- Not on ${a.pane}: “${a.text}”`);
    for (const o of i.observed || []) {
      if (o.kind !== 'check') { lines.push(`- Lab check ${o.ok ? '✓' : '✗'} ${o.kind === 'see' ? 'shows' : 'does not show'} on ${o.pane}: “${o.text}”`); continue; }
      lines.push(`- Lab check ${o.ok ? '✓' : '✗'} \`${o.text}\` exited ${o.status}`);
      const out = (i.checks || []).find(c => c.command === o.text)?.output;
      if (!o.ok && out?.trim()) lines.push('', fence(out), '');
    }
    if (i.tester && i.tester !== i.verdict) lines.push(`- The Tester said ${i.tester}; the lab's own checks decided ${i.verdict}.`);
    lines.push('');
  }
  if (shot) lines.push(`![The lab window at the end of the run](${path.basename(shot)})`, '');
  lines.push('## What each pane showed', '', skill ? '_From each pane\'s Pi session. The Tester never read this._' : '_From each pane\'s Pi session; the sidecar\'s forked history and instructions are left out. The Tester never read this._', '');
  for (const [k, s] of Object.entries(screens)) lines.push(`### ${k}`, '', fence(s.length > 8000 ? '…' + s.slice(-8000) : s || '(nothing)'), '');
  return lines.join('\n');
}

/** Write the report (and a window screenshot) into sidecars/<name>/reports/ of the real project. */
export function writeReport(id, { summary }) {
  const run = core.readRun(id), results = core.readResults(id);
  const dir = run.reportsDir || path.join(run.project, run.folder, 'reports');
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

/**
 * `lab test <Sidecar> --runs N`: how often each expectation passed. runs = [{ code, res }] in order;
 * code 0 passed, 1 failed, 2 no report. A run without a report counts against every expectation.
 */
export function runsSummary(sidecar, runs, wanted = runs.length) {
  const Name = sidecar.charAt(0).toUpperCase() + sidecar.slice(1);
  const clean = runs.filter(r => r.code === 0).length;
  const titles = runs.find(r => r.res?.items)?.res.items.map(i => ({ id: i.id, title: i.title })) || [];
  const width = Math.max(0, ...titles.map(t => `${t.id} · ${t.title}`.length));
  const lines = [`${Name}: ${clean} of ${runs.length} runs passed${runs.length < wanted ? ` (stopped early; ${wanted} were asked for)` : ''}`];
  for (const t of titles) {
    const failed = runs.map((r, n) => r.res?.items?.find(i => i.id === t.id)?.verdict === 'pass' ? 0 : n + 1).filter(Boolean);
    lines.push(`${failed.length ? '✗' : '✓'} ${`${t.id} · ${t.title}`.padEnd(width)}  ${runs.length - failed.length}/${runs.length}${failed.length ? `  failed in run ${failed.join(', ')}` : ''}`);
  }
  runs.forEach((r, n) => lines.push(`Run ${n + 1}: ${r.res?.report || 'no report'}`));
  return lines.join('\n');
}
