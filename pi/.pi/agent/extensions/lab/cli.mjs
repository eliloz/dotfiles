#!/usr/bin/env node
// `lab`: the lab's shell command. /lab in Pi runs this same file.
import fs from 'node:fs';
import path from 'node:path';
import * as core from './core.mjs';
import { help } from './help.mjs';
import { testTarget } from './expectations.mjs';

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--with' || a.startsWith('--with=')) throw Error('--with is gone: /split and /agent carry over into the lab by themselves; add others with LAB_EXTENSIONS=path:path');
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--agent-model') o.agentModel = argv[++i];
    else if (a === '--tester-model') o.testerModel = argv[++i];
    else if (a === '--run') o.run = argv[++i];
    else if (a === '--seconds') o.seconds = Number(argv[++i]);
    else if (a === '--keep') o.keep = true;
    else if (a === '--behind') o.behind = true;
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('--')) throw Error(`Unknown option ${a}. Run lab --help`);
    else o._.push(a);
  }
  return o;
}
const progress = m => process.stderr.write(`· ${m}\n`);
// If Pi quits while /lab runs, our output pipes close; keep going so the lab still gets stopped.
for (const s of [process.stdout, process.stderr]) s.on('error', () => {});

/**
 * Ctrl-C (SIGINT), a closed terminal (SIGHUP) or Pi quitting (SIGTERM) during run/start stops the lab
 * this command started. With --keep only the lab agent is ended and the lab stays open.
 */
let signalId, signalKeep = false;
function stopOnSignal(o) {
  signalKeep = !!o.keep;
  if (stopOnSignal.on) return lab => { signalId = lab; };
  stopOnSignal.on = true;
  let busy = false;
  const handler = async sig => {
    if (busy) return;
    busy = true;
    interrupted = new Promise(() => {}); // the run's own path waits on this forever; this handler exits
    const id = signalId, r = id && core.readRun(id);
    if (!r) { console.error(`lab: ${sig}, nothing started yet`); process.exit(130); }
    try {
      if (signalKeep && r.phase !== 'starting') {
        if (r.judgePid) try { process.kill(r.judgePid, 'SIGTERM'); } catch {}
        console.error(`lab: ${sig}: ended the lab agent; ${id} is still open (--keep). Close it with: lab stop ${id}`);
      } else {
        console.error(`lab: ${sig}: stopping ${id}`);
        console.error(await stopText(id));
      }
    } catch (e) { console.error(`lab: could not stop ${id}: ${e.message}. Try: lab stop ${id}`); }
    process.exit(130);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => handler(sig));
  return lab => { signalId = lab; };
}
let interrupted; // set once a signal is being handled
const runOf = o => { const id = o.run || core.latest(); if (!id) throw Error('No lab is running. Start one with lab start or lab test'); return id; };

function leftoverText(left) {
  const lines = [];
  lines.push(left.processes.length ? `✗ still running: ${left.processes.join('; ')}` : '✓ no lab processes left');
  lines.push(left.files.length ? `✗ still on disk: ${left.files.join(', ')}` : '✓ no scratch files left');
  if (left.otherLabs?.length) lines.push(`○ other labs (not touched): ${left.otherLabs.join(', ')}`);
  for (const k of left.kept) lines.push(`○ kept: ${k}`);
  return lines.join('\n');
}

async function stopText(id) {
  const s = await core.stopLab(id);
  return `Stopped ${id}\n${s.done.map(d => `✓ ${d}`).join('\n')}\nLeft behind:\n${leftoverText(s.left)}`;
}

const DEFAULT_FILE = 'lab-scenarios.md';
const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };

/**
 * lab test                        every scenario in ./lab-scenarios.md
 * lab test FILE [N|first|words]   one scenario from FILE (none: all of them)
 * lab test "plain words"          one scenario described in words
 * Each scenario runs in its own lab, which is stopped afterwards (unless --keep).
 */
async function testCmd(o) {
  const t = testTarget(o._, isFile);
  if (t.kind === 'agent') return agentCmd(o, t.name);
  let file, scenarios;
  if (t.kind === 'scenarios') {
    file = t.file || DEFAULT_FILE;
    if (!isFile(file)) throw Error(`No ${DEFAULT_FILE} here. Give a file (lab test FILE 1), an agent (lab test critic) or the steps in words (lab test "Open a pane. Run ls.")`);
    scenarios = core.pickScenario(core.parseScenarios(fs.readFileSync(file, 'utf8')), t.pick);
  } else scenarios = core.pickScenario(core.parseScenarios(t.text));
  if (scenarios.length > 1) progress(`${scenarios.length} scenarios from ${file}, one lab each`);
  let worst = 0;
  for (const scenario of scenarios) {
    const code = await runScenario(o, scenario, file ? [path.resolve(file)] : []);
    worst = Math.max(worst, code);
  }
  return worst;
}

/** lab test <Agent>: open the agent's lab (Main, Before, /agent, then the Tester). It stays open for you to look. */
async function agentCmd(o, name) {
  const onId = stopOnSignal({}); // Ctrl-C while it opens stops the lab
  const id = await core.startAgentLab({ name, model: o.model, agentModel: o.agentModel, testerModel: o.testerModel, behind: o.behind, onId }, progress);
  const r = core.readRun(id);
  console.log([`Lab ${id} for ${r.agent}: ${r.phase === 'testing' ? 'the Tester is running' : 'open up to the Tester (not built yet)'}`,
    `Panes: ${core.panes(id).map(p => `${p.name} (${p.terminal})`).join(', ')}`,
    `Models: Main ${r.model} · ${r.agent} ${r.agentModel} · Tester ${r.testerModel}`,
    `${r.agent}'s job arrived whole: ${r.jobArrived ? 'yes' : 'no'} (${r.jobChars} characters)`,
    `Close it with: lab stop ${id}`].join('\n'));
  return 0;
}

async function runScenario(o, scenario, withheld) {
  progress(`Scenario: ${scenario.title} · ${scenario.steps.length} steps`);
  const onId = stopOnSignal(o);
  const id = await core.startLab({ model: o.model, behind: o.behind, withheld, onId }, progress);
  const carried = core.readRun(id).tools.map(t => `/${t.name}`).join(', ');
  progress(`Carried into the lab's Pi panes: ${carried || 'no extensions'}`);
  const left = Object.entries(core.readRun(id).copied?.left || {}).filter(([k, v]) => k !== 'git' && v.length);
  if (left.length) progress(`Left out of the copy: ${left.map(([k, v]) => `${k} ${v.length}`).join(', ')} (names in the report)`);
  progress(`Lab ${id} is up; the lab agent is running (${core.readRun(id).model})`);
  const problem = await core.runJudge(id, scenario, o.seconds || 900);
  if (interrupted) await interrupted;
  if (!core.readRun(id)) {
    console.log(`${scenario.title}: unfinished · ${id} was stopped during the run (lab stop), so there is no report.`);
    return 2;
  }
  const rep = core.writeReport(id, { error: core.readRun(id).phase === 'judged' ? undefined : problem || 'the lab agent did not call lab_finish' });
  const r = core.readRun(id);
  const lines = [`${scenario.title}: ${rep.result} · ${rep.passed} of ${rep.total} steps`,
    ...r.steps.map(s => `${s.verdict === 'pass' ? '✓' : '✗'} ${s.n}. ${s.verdict ? core.sentence(s) : `${s.text}: not reported`}${s.quote ? `\n     “${s.quote.replace(/\s+/g, ' ').slice(0, 200)}”` : ''}`)];
  if (rep.result === 'unfinished') lines.push(`Lab agent problem: ${problem}. Log: ${path.join(core.dirs(id).logs, 'judge.log')}${o.keep ? '' : ' (deleted with the lab; rerun with --keep to keep it)'}`);
  lines.push(`Report: ${rep.report}`);
  if (o.keep) lines.push(`The lab is still open (--keep). Close it with: lab stop ${id}`);
  else if (core.readRun(id)) { const st = await stopText(id); core.appendToReport(rep.report, `\n## Stop\n\n\`\`\`text\n${st}\n\`\`\`\n`); lines.push(st); }
  console.log(lines.join('\n') + '\n');
  return rep.result === 'passed' ? 0 : rep.result === 'failed' ? 1 : 2;
}

async function main(argv) {
  const o = parse(argv);
  const cmd = o._.shift();
  if (o.help || !cmd || cmd === 'help') { console.log(help('lab')); return 0; }
  switch (cmd) {
    case 'doctor': { const d = core.doctor(process.cwd()); console.log(o.json ? JSON.stringify(d, null, 2) : d.text); return d.ok ? 0 : 1; }
    case 'test': case 'run': return testCmd(o);
    case 'scenarios': { const f = o._[0]; if (!f) throw Error('lab scenarios FILE'); console.log(JSON.stringify(core.parseScenarios(fs.readFileSync(f, 'utf8')), null, 2)); return 0; }
    case 'start': { const id = await core.startLab({ model: o.model, behind: o.behind, onId: stopOnSignal({}) }, progress); console.log(id); return 0; }
    case 'open': console.log(await core.openPane(runOf(o), o._[0] || 'shell')); return 0;
    case 'type': { const [p, ...t] = o._; if (!p || !t.length) throw Error('lab type PANE TEXT'); console.log(await core.type(runOf(o), p, t.join(' '))); return 0; }
    case 'keys': { const [p, ...k] = o._; if (!p || !k.length) throw Error('lab keys PANE KEY...'); console.log(await core.keys(runOf(o), p, k)); return 0; }
    case 'read': console.log(core.read(runOf(o), o._[0], 40)); return 0;
    case 'shot': { const id = runOf(o); console.log(core.shot(id)); console.log(core.readRun(id).shots.at(-1)); return 0; }
    case 'close': if (!o._[0]) throw Error('lab close PANE'); console.log(await core.closePane(runOf(o), o._[0])); return 0;
    case 'list': {
      const l = core.list();
      console.log(o.json ? JSON.stringify(l, null, 2) : l.length ? l.map(x => `${x.id}  ${x.phase}  core ${x.core}  window ${x.window}  ${x.project}`).join('\n') : 'No labs.');
      return 0;
    }
    case 'stop': {
      const which = o._[0];
      const ids = which === 'all' ? core.list().map(l => l.id) : [which || core.latest()].filter(Boolean);
      if (!ids.length) { console.log(`No labs to stop.\nLeft behind:\n${leftoverText(core.leftovers())}`); return 0; }
      for (const id of ids) console.log(await stopText(id));
      return 0;
    }
    case 'leftovers': { const l = core.leftovers(o._[0]); console.log(o.json ? JSON.stringify(l, null, 2) : leftoverText(l)); return 0; }
    case 'clean': console.log(core.clean()); return 0;
    default: throw Error(`Unknown command "${cmd}". Run lab --help`);
  }
}

main(process.argv.slice(2)).then(code => process.exit(code), err => {
  console.error(`lab: ${err.message}${err.run ? ` (lab ${err.run} was stopped)` : ''}`);
  process.exit(2);
});
