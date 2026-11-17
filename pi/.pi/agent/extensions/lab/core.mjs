// Lab core: a private Herdr (own app copy, app home, core, socket) with its own Pi profile and a
// copy of the project, driven through hc and judged from the screen by a black-box lab agent.
//
// Safety rule: every hc / herdr-app call goes through run(id, …), which uses env(id) — the caller's
// environment with every Herdr, hc, Pi and XDG-state variable removed and the lab's own set. Nothing
// here can address the everyday core or window. stop() only acts on what run.json says this lab made.
//
// Checked against: Herdr app 0.1.16, hc 0.1.21, Pi 1.5.2 (macOS). Recheck after upgrading any of them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse, locate, job, access } from './expectations.mjs';

export const HERE = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
export const LAB_HOME = process.env.LAB_HOME || path.join(os.homedir(), '.lab');
export const REPORTS = path.join(LAB_HOME, 'reports');
const APP_CACHE = path.join(LAB_HOME, 'app');
// macOS caps a Unix socket path at 103 bytes, so core state lives under a short root.
const SOCK_ROOT = '/private/tmp/hlab';
const BUNDLE_ID = 'dev.herdr.lab';
// Herdr's updater has no off switch; a closed local port makes every check fail at once (update.rs releases()).
const NO_UPDATES = 'http://127.0.0.1:9';
const DAILY_PI = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
const DAILY_HERDR = path.join(os.homedir(), '.config', 'herdr-app');
export const ID_RE = /^lab-[0-9a-f]{6}$/;
export const JUDGE_TOOLS = ['lab_open', 'lab_type', 'lab_keys', 'lab_read', 'lab_shot', 'lab_close', 'lab_step', 'lab_finish'];

const mkdir = p => fs.mkdirSync(p, { recursive: true, mode: 0o700 });
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => { mkdir(path.dirname(p)); const t = `${p}.${process.pid}.tmp`; fs.writeFileSync(t, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(t, p); };
export const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ---------- places ----------

export function dirs(id) {
  if (!ID_RE.test(id)) throw Error(`Not a lab id: ${id}`);
  const root = path.join(LAB_HOME, id);
  const sock = path.join(SOCK_ROOT, id);
  return {
    root, run: path.join(root, 'run.json'), captured: path.join(root, 'captured.txt'),
    profile: path.join(root, 'pi-agent'), judgeProfile: path.join(root, 'judge-agent'), judgeCwd: path.join(root, 'judge-cwd'),
    tmp: path.join(root, 'tmp'), app: path.join(root, 'app'), config: path.join(root, 'config'), logs: path.join(root, 'logs'), shots: path.join(root, 'shots'),
    sock, state: path.join(sock, 'st'), coreSocket: path.join(sock, 'st', 'herdr-core', id, `${id}.sock`),
  };
}
export const readRun = id => readJson(dirs(id).run, undefined);
export const writeRun = (id, patch) => { const next = { ...(readRun(id) || {}), ...patch, updated: new Date().toISOString() }; writeJson(dirs(id).run, next); return next; };
export const coreUp = id => fs.existsSync(dirs(id).coreSocket);

/** The lab's environment: yours, minus anything naming another Herdr core, window or Pi profile. */
export function env(id, extra = {}) {
  const d = dirs(id), e = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(HC_|HERDR_|PI_|LAB_|XDG_(STATE|CONFIG|RUNTIME)_)/.test(k) || k === 'TMUX' || k === 'TMUX_PANE') continue;
    e[k] = v;
  }
  return {
    ...e, HC_SESSION: id, XDG_STATE_HOME: d.state, XDG_CONFIG_HOME: d.config, HERDR_APP_HOME: d.app,
    HERDR_APP_NO_SOUND: '1', HERDR_TELEMETRY: '0', HERDR_RELEASES_URL: NO_UPDATES, PI_CODING_AGENT_DIR: d.profile, PI_SKIP_VERSION_CHECK: '1', LAB_RUN: id, ...extra,
  };
}

function exec(cmd, args, { id, timeout = 30000, check = true, envOverride } = {}) {
  const r = spawnSync(cmd, args, { env: envOverride || (id ? env(id) : process.env), encoding: 'utf8', timeout, maxBuffer: 64 << 20 });
  if (check && (r.error || r.status !== 0)) throw Error(`${path.basename(cmd)} ${args.slice(0, 2).join(' ')}: ${(r.error?.message || r.stderr || r.stdout || 'failed').trim().slice(0, 500)}`);
  return r.stdout || '';
}
const lastJson = s => { const t = String(s).trim(); try { return JSON.parse(t); } catch {} try { return JSON.parse(t.split('\n').filter(Boolean).at(-1)); } catch { return undefined; } };

export function which(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch {}
  }
}
const need = name => { const p = which(name); if (!p) throw Error(`${name} is not on PATH`); return p; };

// Lab-scoped command wrappers. The only way this file talks to Herdr.
export const hc = (id, args, o = {}) => exec(need('hc'), args, { id, ...o });
export const hcJson = (id, args, o) => lastJson(hc(id, [...args, '--json'], o));
export const app = (id, args, o = {}) => exec(need('herdr-app'), args, { id, ...o });
export const appJson = (id, args, o) => lastJson(app(id, args, o));

// ---------- isolate: the Herdr Lab app copy ----------

function sourceApp() {
  for (const p of [process.env.LAB_HERDR_APP, '/Applications/Herdr.app', path.join(os.homedir(), 'Applications/Herdr.app')]) if (p && fs.existsSync(p)) return p;
  const cli = which('herdr-app');
  if (cli) { const real = fs.realpathSync(cli); const i = real.indexOf('.app/'); if (i > 0) return real.slice(0, i + 4); }
  throw Error('Herdr.app not found in /Applications or ~/Applications');
}
const plist = (file, key) => spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, file], { encoding: 'utf8' });

/** A cached copy of Herdr named "Herdr Lab" with its own bundle id, so macOS never mixes it up with your Herdr. */
export function labApp() {
  const src = sourceApp(), info = path.join(src, 'Contents/Info.plist');
  const version = plist(info, 'CFBundleShortVersionString').stdout.trim();
  const exe = plist(info, 'CFBundleExecutable').stdout.trim();
  const dest = path.join(APP_CACHE, version, 'Herdr Lab.app'), ready = path.join(APP_CACHE, version, '.ready');
  const ours = () => plist(path.join(dest, 'Contents/Info.plist'), 'CFBundleIdentifier').stdout.trim() === BUNDLE_ID
    && spawnSync('/usr/bin/codesign', ['--verify', '--deep', dest]).status === 0;
  if (!fs.existsSync(ready) || !ours()) {
    unlock(path.dirname(dest));
    fs.rmSync(path.dirname(dest), { recursive: true, force: true });
    mkdir(path.dirname(dest));
    exec('/usr/bin/ditto', [src, dest], { timeout: 180000 });
    const p = path.join(dest, 'Contents/Info.plist');
    for (const [k, v] of [['CFBundleIdentifier', BUNDLE_ID], ['CFBundleName', 'Herdr Lab'], ['CFBundleDisplayName', 'Herdr Lab']]) {
      exec('/usr/libexec/PlistBuddy', ['-c', plist(p, k).status === 0 ? `Set :${k} ${v}` : `Add :${k} string ${v}`, p]);
    }
    // The edited Info.plist breaks Herdr's signature; sign the copy ad hoc, for this Mac only.
    exec('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', dest], { timeout: 180000 });
    fs.writeFileSync(ready, JSON.stringify({ source: src, version, bundleId: BUNDLE_ID }) + '\n');
  }
  // Read-only folder: an updater cannot rename the bundle aside to swap in a new one.
  fs.chmodSync(path.dirname(dest), 0o555);
  return { bundle: dest, bin: path.join(dest, 'Contents/MacOS', exe), version, source: src };
}

const unlock = dir => { try { fs.chmodSync(dir, 0o700); } catch {} };

/** The lab window gets your Herdr look and keys, nothing else (no mods, no layouts, no shared state). */
function appHome(appDir) {
  const daily = readJson(path.join(DAILY_HERDR, 'settings.json'), {});
  const look = ['zoom', 'font', 'font_size', 'font_weight', 'font_ligatures', 'ui_font', 'theme', 'appearance', 'colors', 'minimum_contrast', 'option_as_alt'];
  writeJson(path.join(appDir, 'settings.json'), { ...Object.fromEntries(look.filter(k => k in daily).map(k => [k, daily[k]])), core: need('hc'), telemetry: false, sounds: { enabled: false } });
  writeJson(path.join(appDir, 'shared.json'), { 'frame.welcomed': 'skipped' });
  // keys.json: your bindings. update-notes.json: without it the window opens with an "Updated to …" toast.
  for (const n of ['keys.json', 'update-notes.json']) if (fs.existsSync(path.join(DAILY_HERDR, n))) fs.copyFileSync(path.join(DAILY_HERDR, n), path.join(appDir, n));
}

// ---------- isolate: Pi profiles ----------

/** A scratch Pi profile. Links (never copies) your model logins; nothing else from your profile. */
function piProfile(dir) {
  mkdir(dir);
  for (const f of ['auth.json', 'models.json']) {
    const a = path.join(DAILY_PI, f);
    if (fs.existsSync(a)) fs.symlinkSync(fs.realpathSync(a), path.join(dir, f));
  }
  const s = readJson(path.join(DAILY_PI, 'settings.json'), {});
  const keep = ['lastChangelogVersion', 'defaultProvider', 'defaultModel', 'defaultThinkingLevel', 'enabledModels', 'theme'];
  writeJson(path.join(dir, 'settings.json'), { ...Object.fromEntries(keep.filter(k => k in s).map(k => [k, s[k]])), quietStartup: true, enableInstallTelemetry: false });
}

/** The model the lab uses when none is given: your Pi default. */
/** The model when --model is not given: LAB_MODEL if set, else your Pi default. */
export function defaultModel() {
  if (process.env.LAB_MODEL) return process.env.LAB_MODEL;
  const s = readJson(path.join(DAILY_PI, 'settings.json'), {});
  return s.defaultProvider && s.defaultModel ? `${s.defaultProvider}/${s.defaultModel}` : undefined;
}

/**
 * Extensions that carry over into the lab's Pi panes, as in herdr-pi-lab: /split and /agent wherever this
 * computer has them (the project's .pi, your Pi extensions or git packages), plus LAB_EXTENSIONS (paths
 * separated by ":"). Nothing else from your Pi setup is loaded there, and never /lab itself.
 */
export const CARRIED = [['split', ['split', 'herdr-pi-split']], ['agent', ['agent', 'role', 'herdr-pi-role']]];
export function carriedExtensions(project = process.cwd()) {
  const found = [];
  const file = c => [c, `${c}.ts`, `${c}.js`, path.join(c, 'index.ts'), path.join(c, 'index.js')].find(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });
  for (const [name, dirNames] of CARRIED) {
    const candidates = dirNames.flatMap(n => [path.join(project, '.pi', 'extensions', n), path.join(project, '.pi', 'git', 'github.com', 'johnlindquist', n),
      path.join(DAILY_PI, 'extensions', n), path.join(DAILY_PI, 'git', 'github.com', 'johnlindquist', n)]);
    for (const c of candidates) { const f = file(c); if (f) { found.push({ name, file: fs.realpathSync(f) }); break; } }
  }
  for (const extra of (process.env.LAB_EXTENSIONS || '').split(path.delimiter).filter(Boolean)) {
    const f = file(path.resolve(extra.replace(/^~(?=\/)/, os.homedir())));
    if (!f) throw Error(`LAB_EXTENSIONS: ${extra} not found`);
    found.push({ name: path.basename(f).replace(/\.(ts|js)$/, '').replace(/^index$/, path.basename(path.dirname(f))), file: fs.realpathSync(f) });
  }
  const here = fs.realpathSync(HERE);
  return found.filter((t, i) => !t.file.startsWith(here + path.sep) && found.findIndex(x => x.file === t.file) === i);
}

// ---------- isolate: the project copy ----------

// Left out of every copy. Each rule names why, and the report lists what each one caught.
const LEAVE_OUT = [
  ['git', /(^|\/)\.git(\/|$)|(^|\/)\.gitmodules$/],
  ['secret', /(^|\/)\.env($|\.|rc$)|(^|\/)\.(netrc|npmrc|pypirc)$|(^|\/)id_[^/]*$|\.(pem|key|p12|pfx|jks|keystore|asc|gpg)$|(^|\/)([^/]*[-_.])?(auth|credentials?|secrets?|tokens?|passwords?)([-_.][^/]*)?\.(json|ya?ml|toml|txt|ini)$|(^|\/)service[-_]?account[^/]*\.json$/i],
  ['agent', /(^|\/)(AGENTS|CLAUDE|GEMINI)(\.override)?\.md$|(^|\/)\.(pi|claude|cursor|codex|gemini|windsurf|aider[^/]*)(\/|$)|^(agents|roles)(\/|$)|(^|\/)(agents|roles)\/(.*\/)?[^/]*\.md$|(^|\/)\.cursorrules$|copilot-instructions\.md$/i],
  ['expectations', /expectation|(^|\/)lab-scenarios\.md$|(^|\/)lab-reports(\/|$)/i],
];
/**
 * Why a project file (path relative to the project) stays out of the lab copy, or undefined when it goes in.
 * agentFolder ("agents/critic") is the agent under test; a scenario check has none.
 *
 * The rule: testing agent X, the files directly in agents/X/ go in (a glossary, memories: what its job
 * tells it to read), but never agent.md (the agent sees only its Job, typed into /agent), any expectations
 * file, or a subfolder such as reports/. No other agent's folder goes in, and a check copies no agents/ at all.
 * Secrets stay out everywhere. (herdr-pi-lab 0.5.0 copies agent.md too; the lesson says never: we follow the lesson.)
 */
export function leaveOutReason(file, agentFolder) {
  const f = String(file).replace(/\\/g, '/');
  for (const [why, re] of LEAVE_OUT) {
    if (why === 'agent' && ownFile(f, agentFolder)) continue;
    if (re.test(f)) return why;
  }
}
function ownFile(f, agentFolder) {
  const own = String(agentFolder || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!/^agents\/[a-z][a-z0-9_-]{0,31}$/i.test(own) || !f.toLowerCase().startsWith(own.toLowerCase() + '/')) return false;
  const name = f.slice(own.length + 1);
  return !name.includes('/') && !/^(agent|AGENTS|CLAUDE|GEMINI)(\.override)?\.md$/i.test(name);
}
/** Does this file go into the lab copy? See leaveOutReason. */
export const labCopies = (file, agentFolder) => !leaveOutReason(file, agentFolder);

/** Copy only git-tracked files, without .git, secrets, agent files or expectations. No new repository. */
export function copyProject(project, dest, withheld = [], agentFolder) {
  const ls = spawnSync('git', ['-C', project, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (ls.status !== 0) throw Error(`${project} is not a git repository, so it has no tracked files to copy. Run the lab from inside a git project.`);
  const never = new Set(withheld.map(w => path.relative(project, path.resolve(project, w))));
  const left = { git: [], secret: [], agent: [], expectations: [], withheld: [], other: [] };
  let copied = 0, bytes = 0;
  mkdir(dest);
  for (const f of ls.stdout.split('\0').filter(Boolean)) {
    if (never.has(f)) { left.withheld.push(f); continue; }
    const why = leaveOutReason(f, agentFolder);
    if (why) { left[why].push(f); continue; }
    const a = path.join(project, f);
    let s; try { s = fs.lstatSync(a); } catch { left.other.push(`${f} (missing on disk)`); continue; }
    if (!s.isFile()) { left.other.push(`${f} (${s.isSymbolicLink() ? 'symlink' : 'not a file'})`); continue; }
    if (s.size > 5 << 20) { left.other.push(`${f} (over 5 MB)`); continue; }
    mkdir(path.dirname(path.join(dest, f)));
    fs.copyFileSync(a, path.join(dest, f));
    fs.chmodSync(path.join(dest, f), s.mode & 0o777);
    copied++; bytes += s.size;
  }
  return { copied, bytes, left };
}

// ---------- isolate: start a lab ----------

async function until(test, seconds, what) {
  const end = Date.now() + seconds * 1000;
  for (;;) { const v = await test(); if (v) return v; if (Date.now() > end) throw Error(`Timed out after ${seconds}s waiting for ${what}`); await sleep(300); }
}

function findAppPid(id) {
  const home = dirs(id).app;
  const out = spawnSync('/bin/ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8' }).stdout || '';
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!m || !m[2].includes('Herdr Lab.app')) continue;
    const e = spawnSync('/bin/ps', ['eww', '-p', m[1], '-o', 'command='], { encoding: 'utf8' }).stdout || '';
    if (e.includes(`HERDR_APP_HOME=${home}`)) return Number(m[1]);
  }
}

/** A new lab id with its run folder, before anything is started. */
function newLab(project, patch) {
  const id = `lab-${randomBytes(3).toString('hex')}`;
  const d = dirs(id);
  const projectName = (path.basename(project).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+/, '') || 'project').slice(0, 40);
  for (const p of [d.root, d.logs, d.config, d.app, d.shots, d.judgeCwd, d.state, d.tmp]) mkdir(p);
  writeRun(id, { id, project, copy: path.join(d.root, projectName), created: new Date().toISOString(), phase: 'starting', panes: {}, made: [], ...patch });
  fs.writeFileSync(d.captured, '');
  return id;
}

/** Copy the project, make the Pi profiles, start the private core and open the Herdr Lab window (no panes yet). */
async function openLab(id, o, progress) {
  const d = dirs(id), r = readRun(id);
  progress('Copying the project (tracked files only)');
  const copied = copyProject(r.project, r.copy, o.withheld || [], o.agentFolder);
  writeRun(id, { copied, made: ['run folder', 'project copy'] });

  progress('Making the lab Pi profiles (linked to your model logins)');
  piProfile(d.profile); piProfile(d.judgeProfile);
  mkdir(path.join(d.config, 'herdr-core'));
  fs.writeFileSync(path.join(d.config, 'herdr-core', 'config.toml'), `notes = false\nshell = ${JSON.stringify(userShell())}\n`);

  progress('Preparing the Herdr Lab app copy');
  const a = labApp();
  appHome(d.app);
  writeRun(id, { app: a });

  progress(`Starting core ${id}`);
  hc(id, ['server', 'start'], { timeout: 20000 });
  const status = hcJson(id, ['server', 'status']);
  writeRun(id, { corePid: status?.pid, coreId: status?.core?.id, made: ['run folder', 'project copy', 'core'] });

  progress('Opening the Herdr Lab window');
  const vars = ['HC_SESSION', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'HERDR_APP_HOME', 'HERDR_APP_NO_SOUND', 'HERDR_TELEMETRY', 'HERDR_RELEASES_URL', 'PI_CODING_AGENT_DIR', 'PI_SKIP_VERSION_CHECK', 'LAB_RUN'];
  const e = env(id), log = path.join(d.logs, 'app.log');
  exec('/usr/bin/open', ['-n', ...(o.behind ? ['-g'] : []), '-a', a.bundle, ...vars.flatMap(k => ['--env', `${k}=${e[k]}`]), '--stdout', log, '--stderr', log], { id });
  // A freshly signed copy is verified by macOS on its first launch, which can take a while.
  await until(() => appJson(id, ['status'], { check: false, timeout: 5000 }), 120, 'the Herdr Lab window');
  writeRun(id, { appPid: findAppPid(id), made: ['run folder', 'project copy', 'core', 'window'] });
}

async function failed(id, o, err) {
  writeRun(id, { phase: 'failed', error: err.message });
  if (!o.keepOnError) await stopLab(id).catch(() => {});
  err.run = id;
  return err;
}

/**
 * Isolate: copy the project, make the Pi profiles, start a private core and the Herdr Lab window,
 * and open pane P1 (a shell in the copy). Returns the run id. On any failure the lab is stopped.
 */
export async function startLab(o = {}, progress = () => {}) {
  if (process.platform !== 'darwin') throw Error('The lab is built for macOS (it copies and signs Herdr.app)');
  const project = path.resolve(o.project || process.cwd());
  const tools = carriedExtensions(project);
  const model = o.model || defaultModel();
  if (!model) throw Error('No model given and no default model in your Pi settings. Pass --model provider/id');
  need('hc'); need('herdr-app'); need('pi');
  const id = newLab(project, { model, tools });
  o.onId?.(id);
  try {
    await openLab(id, o, progress);
    progress('Opening pane P1 (a shell in the project copy)');
    await openPane(id, 'shell');
    writeRun(id, { phase: 'ready' });
    return id;
  } catch (err) { throw await failed(id, o, err); }
}

// ---------- isolate: start a lab for one agent ----------

/** Guest Main reads but never runs commands or edits: the lab tests the agent, not Main's coding (herdr-pi-lab). */
export const MAIN_TOOLS = 'read,grep,find,ls';
export const TESTER_TOOLS = ['lab_do', 'lab_look', 'lab_find', 'lab_verdict', 'lab_finish'];
const TESTER = path.join(HERE, 'tester', 'index.ts');

/** The /agent line Main gets. The job is the "## Job" text of agent.md, typed as one line. */
export const agentCommand = ({ name, work, model, job }) => `/agent ${work ? '--work ' : ''}${name} --model ${model} ${job}`;

/**
 * Start a lab for agents/<name>/: copy the project (the agent's own files, never agent.md, expectations
 * or reports), open guest Main (Pi, only /agent, read-only tools, --name Main), run the Before lines,
 * open the agent with /agent, check that its whole job arrived, then open the Tester below it.
 * Until tester/index.ts exists the lab stops before the Tester (phase "agent"). Returns the run id.
 */
export async function startAgentLab(o = {}, progress = () => {}) {
  if (process.platform !== 'darwin') throw Error('The lab is built for macOS (it copies and signs Herdr.app)');
  const project = path.resolve(o.project || process.cwd());
  const loc = locate(project, o.name);
  if (loc.missing) throw Error(`No expectations for ${o.name} yet. Write ${path.relative(project, loc.file)}, or run /lab new ${o.name} to write them together.`);
  const name = o.name.charAt(0).toUpperCase() + o.name.slice(1);
  const spec = parse(fs.readFileSync(loc.file, 'utf8'), name);
  const agentJob = job(loc.dir);
  if (!agentJob) throw Error(`${name} has no agent.md yet. Write ${path.relative(project, loc.agentFile)} with a "## Job" section first (or run /lab new ${name}).`);
  const agentExt = carriedExtensions(project).find(t => t.name === 'agent');
  if (!agentExt) throw Error('/agent was not found (project .pi/extensions, ~/.pi/agent/extensions or its git package), so the lab cannot open the agent.');
  const model = o.model || defaultModel();
  if (!model) throw Error('No model given and no default model in your Pi settings. Pass --model provider/id');
  need('hc'); need('herdr-app'); need('pi');
  const work = access(loc.dir) === 'work';
  const agentModel = o.agentModel || 'fast';

  const id = newLab(project, {
    kind: 'agent', agent: name, folder: loc.folder, expectations: loc.file, model, agentModel, testerModel: o.testerModel || model,
    tools: [agentExt], work, jobChars: agentJob.length,
    items: spec.items.map(i => ({ id: i.id, title: i.title, verdict: null })),
  });
  o.onId?.(id);
  try {
    await openLab(id, { behind: o.behind, agentFolder: loc.folder, withheld: [loc.file] }, progress);
    const d = dirs(id), r = readRun(id);

    progress('Starting guest Main');
    const mainArgv = ['/usr/bin/env', ...userXdg(), `PI_CODING_AGENT_DIR=${d.profile}`, 'PI_SKIP_VERSION_CHECK=1', `TMPDIR=${d.tmp}`,
      need('pi'), '--no-extensions', '-e', agentExt.file, '--tools', MAIN_TOOLS,
      '--no-skills', '--no-prompt-templates', '--no-themes', '--no-mcp', '--name', 'Main', '--model', model];
    const space = appJson(id, ['do', 'space.new', JSON.stringify({ machine: '', name: `Lab · ${name}`, folder: r.copy, argv: mainArgv })], { timeout: 20000 });
    if (!space?.terminal) throw Error(`Herdr Lab did not confirm guest Main: ${JSON.stringify(space)}`);
    const main = space.terminal;
    hc(id, ['label', main, 'lab.pane=Main'], { check: false });
    writeRun(id, { phase: 'main', panes: { Main: main } });
    await piReady(id, main, 90);

    // Run lines prepare the copy (plant a bug, seed data); the lab runs them itself, not a model.
    const setup = [];
    for (const step of spec.before.filter(s => s.kind === 'run')) {
      progress(`Before: ${step.text.slice(0, 60)}`);
      const res = spawnSync('/bin/sh', ['-c', step.text], { cwd: r.copy, env: { ...env(id), TMPDIR: d.tmp }, encoding: 'utf8', timeout: 120000 });
      setup.push({ command: step.text, status: res.status, output: ((res.stdout || '') + (res.stderr || '')).slice(-2000) });
      writeRun(id, { setup });
      if (res.status !== 0) throw Error(`Before (line ${step.line}): "${step.text}" exited ${res.status ?? res.signal}: ${(res.stderr || res.stdout || '').trim().slice(-400) || 'no output'}`);
    }
    for (const step of spec.before.filter(s => s.kind === 'do')) {
      progress(`Before: ${step.text.slice(0, 60)}`);
      await sendLine(id, main, step.text, [main], { quiet: 2 });
    }

    progress(`Opening ${name} with /agent (${agentModel}${work ? ', --work' : ''})`);
    const known = new Set(panes(id).map(p => p.terminal));
    hc(id, ['send', main, agentCommand({ name, work, model: agentModel, job: agentJob })], { timeout: 20000 });
    const opened = await until(() => panes(id).find(p => !known.has(p.terminal)), 60, `the ${name} pane (look at guest Main for an /agent error)`);
    hc(id, ['label', opened.terminal, `lab.pane=${name}`], { check: false });
    writeRun(id, { panes: { Main: main, [name]: opened.terminal } });
    await piReady(id, opened.terminal, 90);
    await settleOn(id, [main, opened.terminal], { quiet: 3, seconds: 120 });

    // hc send must deliver the whole job as one line; the agent's owner entry holds what /agent received.
    const arrived = ownerJob(sessionFile(d.profile, name));
    const jobArrived = squash1(arrived || '') === squash1(agentJob);
    writeRun(id, { phase: 'agent', jobArrived });
    if (!jobArrived) throw Error(`${name} opened, but its job did not arrive whole (${(arrived || '').length} of ${agentJob.length} characters). Look at guest Main.`);

    if (!fs.existsSync(TESTER)) { progress('The Tester is not built yet; the lab stops here, open for you to look'); return id; }
    progress('Opening the Tester');
    const testerArgv = ['/usr/bin/env', ...userXdg(), `PI_CODING_AGENT_DIR=${d.judgeProfile}`, 'PI_SKIP_VERSION_CHECK=1', need('pi'),
      '--no-extensions', '-e', TESTER, '--tools', TESTER_TOOLS.join(','),
      '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-mcp', '--no-session', '--name', 'Tester',
      '--model', o.testerModel || model, '--append-system-prompt', path.join(HERE, 'tester', 'prompt.md'), '--lab-run', id, 'Begin the black-box test.'];
    const before = new Set(panes(id).map(p => p.terminal));
    // In the Tester's own empty folder, so it never starts inside the project copy.
    appJson(id, ['do', 'pane.split', JSON.stringify({ pane: opened.pane, direction: 'down', argv: ['/bin/sh', '-c', 'cd "$1" && shift && exec "$@"', 'lab', d.judgeCwd, ...testerArgv] })], { timeout: 20000 });
    const tester = await until(() => panes(id).find(p => !before.has(p.terminal)), 30, 'the Tester pane');
    hc(id, ['label', tester.terminal, 'lab.pane=Tester'], { check: false });
    writeRun(id, { phase: 'testing', panes: { Main: main, [name]: opened.terminal, Tester: tester.terminal } });
    return id;
  } catch (err) { throw await failed(id, o, err); }
}

/** The job /agent recorded in an agent's owner entry: what actually arrived. */
export function ownerJob(file) {
  if (!file) return undefined;
  return readSession(file).findLast(e => e.type === 'custom' && e.customType === MARK.owner)?.data?.job;
}

// ---------- drive ----------

const record = (id, text) => { fs.appendFileSync(dirs(id).captured, text.replace(/\s+$/, '') + '\n'); return text; };
export const captured = id => { try { return fs.readFileSync(dirs(id).captured, 'utf8'); } catch { return ''; } };

/** Panes in the lab window right now. Panes the lab opened have names (P1, P2…); others show their terminal (t3). */
export function panes(id) {
  const names = Object.fromEntries(Object.entries(readRun(id)?.panes || {}).map(([n, t]) => [t, n]));
  const ls = appJson(id, ['ls'], { check: false, timeout: 10000 }) || {};
  const out = [];
  for (const sp of ls.spaces || []) for (const tab of sp.tabs || []) for (const t of tab.terminals || []) if (t.pane) out.push({ name: names[t.terminal] || t.terminal, terminal: t.terminal, pane: t.pane });
  return out;
}
const paneList = id => panes(id).map(p => p.name).join(', ') || 'none';
function pane(id, name) {
  const all = panes(id), want = String(name || '').trim().toLowerCase();
  const hit = all.find(p => p.name.toLowerCase() === want || p.terminal.toLowerCase() === want);
  if (!hit) throw Error(`No pane "${name}". Panes now: ${all.map(p => p.name).join(', ') || 'none'}`);
  return hit;
}

export const screen = (id, terminal, lines = 0) =>
  hc(id, ['read', terminal, ...(lines ? ['--lines', String(lines)] : [])], { check: false, timeout: 15000 }).replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, '');
// A fullscreen Pi pads its screen with blank rows; squeeze them so the end of the screen is the conversation.
const tail = (s, n) => s.split('\n').map(l => l.trimEnd()).filter((l, i, a) => l || a[i - 1]).join('\n').trim().split('\n').slice(-n).join('\n');

/** Wait until no pane's screen has changed for `quiet` seconds. */
export async function settle(id, { quiet = 2, seconds = 120 } = {}) {
  const end = Date.now() + seconds * 1000;
  let last = '', since = Date.now();
  for (;;) {
    const sig = panes(id).map(p => p.terminal + screen(id, p.terminal)).join('\0');
    if (sig !== last) { last = sig; since = Date.now(); }
    if (Date.now() - since >= quiet * 1000) return true;
    if (Date.now() > end) return false;
    await sleep(400);
  }
}

// ---------- quiet, from Herdr's terminal state (herdr-pi-lab) ----------

/** One terminal's Herdr record: status is "working", "idle", "done" or null (a plain shell), turn counts turns. */
export const term = (id, t) => hcJson(id, ['get', t], { check: false, timeout: 10000 }) || {};
const stateOf = g => (g?.status && typeof g.status === 'object' ? g.status.state : g?.status);
export const idle = g => ['idle', 'done'].includes(stateOf(g));

/** Pi in this terminal is up and waiting for a prompt. */
export const piReady = (id, t, seconds = 60) =>
  until(() => { const g = term(id, t); return idle(g) && /\S/.test(screen(id, t)) && g; }, seconds, `Pi in ${t}`);

/**
 * Wait until every listed terminal is idle and its state and turn have not changed for `quiet` seconds
 * (an agent watching Main starts its turn after Main ends). { settled, terminals }.
 */
export async function settleOn(id, terminals, { quiet = 4, seconds = 240 } = {}) {
  const end = Date.now() + seconds * 1000;
  let last = '', since = Date.now();
  for (;;) {
    const gs = terminals.map(t => term(id, t));
    const sig = gs.map(g => `${stateOf(g)}:${g.turn}`).join('|');
    if (sig !== last) { last = sig; since = Date.now(); }
    const result = settled => ({ settled, terminals: Object.fromEntries(terminals.map((t, i) => [t, gs[i]])) });
    if (gs.every(idle) && Date.now() - since >= quiet * 1000) return result(true);
    if (Date.now() > end) return result(false);
    await sleep(400);
  }
}

/** Type one line into a terminal exactly as written, then wait until the listed terminals are quiet. */
export async function sendLine(id, terminal, text, all, opt = {}) {
  hc(id, ['send', terminal, text], { timeout: 20000 });
  // A prompt starts a turn; a slash command may not. Give either a moment to begin.
  await sleep(1500);
  return settleOn(id, all, opt);
}

/** Read the visible text of one pane, or every pane. What it returns is recorded as evidence. */
export function read(id, name, lines = 40) {
  const list = name ? [pane(id, name)] : panes(id);
  return record(id, [`[lab] panes now: ${paneList(id)}`, ...list.map(p => `--- ${p.name}: visible text (last ${lines} lines) ---\n${tail(screen(id, p.terminal), lines) || '(blank)'}`)].join('\n'));
}

// ---------- transcripts (from the lab profile's Pi sessions) ----------

/** Session entry types written by our /agent extension (agent/fork.ts OWNER, agent/index.ts the rest). */
export const MARK = { owner: 'agent-identity', watch: 'agent-watch', direct: 'agent-direct', note: 'agent-note', inbox: 'agent-inbox' };

export const readSession = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } });
const sessionName = entries => entries.filter(e => e.type === 'session_info').at(-1)?.name;
const textOf = m => typeof m.content === 'string' ? m.content : (m.content || []).filter(b => b?.type === 'text').map(b => b.text).join('\n');
const squash1 = s => String(s).replace(/\s+/g, ' ').trim();

/**
 * What a pane showed, from its session entries: prompts, replies and /agent events, as text.
 * For an agent, everything up to and including its owner entry (the forked history, its job, its name)
 * is left out, and so are `system` messages (Pi saves the system prompt, which holds the job). If the
 * job's text still turns up (an agent quoting it), it is replaced, so the Tester never reads it.
 */
export function transcriptOf(entries, pane) {
  const ownerAt = entries.findLastIndex(e => e.type === 'custom' && e.customType === MARK.owner);
  const job = ownerAt >= 0 ? squash1(entries[ownerAt].data?.job || '') : '';
  const hide = t => job && squash1(t).includes(job) ? squash1(t).split(job).join('(the agent\'s job, withheld)') : t;
  const out = [];
  const add = (e, who, text) => { if (String(text).trim()) out.push({ at: e.timestamp, who, text: hide(String(text).trim()) }); };
  for (const e of entries.slice(ownerAt + 1)) {
    if (e.type === 'message') {
      const m = e.message || {};
      if (m.role === 'user') add(e, 'typed', textOf(m));
      else if (m.role === 'assistant') add(e, pane, textOf(m));
    } else if (e.type === 'custom_message' && e.customType === MARK.watch) add(e, 'lab', '(Main\'s conversation reached this agent)');
    else if (e.type === 'custom_message' && e.customType === MARK.direct) add(e, 'lab', `(a message sent from Main with /agent send: ${String(e.content).replace(/^Message from the person in Main, sent to you directly:\n/, '')})`);
    else if (e.type === 'custom' && e.customType === MARK.note) add(e, 'lab', `(a note from ${e.data?.name || 'an agent'} arrived and waits for the next prompt: ${String(e.data?.text || '').slice(0, 300)})`);
    else if (e.type === 'custom_message' && e.customType === MARK.inbox) { const n = e.details?.ids?.length || 0; add(e, 'lab', `(${n} agent note${n === 1 ? '' : 's'} joined this prompt)`); }
  }
  return out;
}

/** The newest session file in a Pi profile whose name (session_info) is `pane`, any case. */
export function sessionFile(profile, pane) {
  const root = path.join(profile, 'sessions');
  if (!fs.existsSync(root)) return undefined;
  const files = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory())
    .flatMap(d => fs.readdirSync(path.join(root, d.name)).filter(f => f.endsWith('.jsonl')).map(f => path.join(root, d.name, f)));
  const want = String(pane).toLowerCase();
  return files.filter(f => String(sessionName(readSession(f))).toLowerCase() === want)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

/** What a lab pane (Main, or an agent by name) has shown since it started. Empty if no session has that name. */
export function transcript(id, pane) {
  const f = sessionFile(dirs(id).profile, pane);
  return f ? transcriptOf(readSession(f), pane) : [];
}
export const transcriptText = items => items.map(i => `[${i.who}] ${i.text}`).join('\n\n');

/**
 * XDG_CONFIG_HOME points at the lab's folder only so the lab core reads its own config.toml (the core
 * has no other setting for it). Programs in lab panes get yours back, so tools that keep their config
 * there (mise, git, gh…) work as in your daily shell. The socket comes from HC_SESSION + XDG_STATE_HOME,
 * which stay the lab's.
 */
const userXdg = () => process.env.XDG_CONFIG_HOME ? [`XDG_CONFIG_HOME=${process.env.XDG_CONFIG_HOME}`] : ['-u', 'XDG_CONFIG_HOME'];
const userShell = () => ['/usr/bin/env', ...userXdg(), process.env.SHELL || '/bin/zsh', '-l'];

/** The program a pane runs: a shell, or Pi with only the extensions that carry over (carriedExtensions). */
function argvFor(id, program) {
  const r = readRun(id), d = dirs(id);
  if (program === 'shell') return userShell();
  if (program !== 'harness') throw Error('A pane runs "shell" or "harness"');
  return ['/usr/bin/env', ...userXdg(), `PI_CODING_AGENT_DIR=${d.profile}`, 'PI_SKIP_VERSION_CHECK=1', need('pi'), '--no-extensions', ...r.tools.flatMap(t => ['-e', t.file]),
    '--no-skills', '--no-prompt-templates', '--no-themes', '--no-mcp', '--model', r.model];
}

export async function openPane(id, program = 'shell') {
  const r = readRun(id), d = dirs(id);
  const argv = argvFor(id, program);
  const name = `P${(r.paneCount || 0) + 1}`;
  const before = new Set(panes(id).map(p => p.terminal));
  if (!before.size) {
    const sp = appJson(id, ['do', 'space.new', JSON.stringify({ machine: '', name: 'Lab', folder: r.copy, argv })], { timeout: 20000 });
    if (!sp?.terminal) throw Error(`Herdr Lab did not confirm the pane: ${JSON.stringify(sp)}`);
  } else {
    // pane.split has no folder argument: cd first, with the folder passed as data, never as shell source.
    const from = panes(id).at(-1);
    appJson(id, ['do', 'pane.split', JSON.stringify({ pane: from.pane, direction: 'right', argv: ['/bin/sh', '-c', 'cd "$1" && shift && exec "$@"', 'lab', r.copy, ...argv] })], { timeout: 20000 });
  }
  const opened = await until(() => panes(id).find(p => !before.has(p.terminal)), 30, 'the new pane');
  hc(id, ['label', opened.terminal, `lab.pane=${name}`], { check: false });
  writeRun(id, { paneCount: (r.paneCount || 0) + 1, panes: { ...(readRun(id).panes || {}), [name]: opened.terminal } });
  await until(() => /\S/.test(screen(id, opened.terminal)), 60, `${name} to show something`);
  await settle(id, { quiet: program === 'harness' ? 3 : 1, seconds: 60 });
  return record(id, `[lab] opened pane ${name} (${program}) · panes now: ${paneList(id)}`);
}

export async function type(id, name, text) {
  const p = pane(id, name);
  hc(id, ['send', p.terminal, text], { timeout: 20000 });
  writeRun(id, { typed: [...(readRun(id).typed || []), text] });
  await sleep(1200);
  const quiet = await settle(id);
  return `typed into ${p.name}: ${text}${quiet ? '' : '  (screens still changing after 2 minutes)'}\n${read(id)}`;
}

export async function keys(id, name, list) {
  const p = pane(id, name);
  hc(id, ['keys', p.terminal, ...list], { timeout: 20000 });
  await sleep(1000);
  await settle(id);
  return `pressed in ${p.name}: ${list.join(' ')}\n${read(id)}`;
}

export function shot(id) {
  const r = readRun(id), d = dirs(id), n = (r.shots || []).length + 1, file = path.join(d.shots, `shot-${n}.png`);
  app(id, ['shot', file], { timeout: 40000 });
  if (!fs.existsSync(file)) throw Error('Herdr Lab did not save the screenshot');
  writeRun(id, { shots: [...(r.shots || []), file] });
  return record(id, `[lab] screenshot saved: shot-${n}.png (${fs.statSync(file).size} bytes)`);
}

export async function closePane(id, name) {
  const p = pane(id, name);
  appJson(id, ['do', 'pane.close', JSON.stringify({ pane: p.pane })], { timeout: 15000 });
  await until(() => !panes(id).some(x => x.terminal === p.terminal), 20, `${p.name} to close`);
  return record(id, `[lab] closed pane ${p.name} · panes now: ${paneList(id)}`);
}

// ---------- judge: the black-box lab agent ----------

const squash = s => String(s).replace(/\s+/g, ' ').trim();
/**
 * A pass needs a quote the lab itself captured (screen text or a [lab] line); otherwise it becomes a fail.
 * Text the lab agent typed is cut out first: its own typing echoed on screen proves nothing.
 */
export function judgeStep(capturedText, steps, p, typed = []) {
  const step = steps.find(s => s.n === p.step);
  if (!step) throw Error(`There is no step ${p.step}. Steps: 1-${steps.length}`);
  const quote = squash(p.quote || '');
  const all = squash(capturedText);
  // Whole words only, so typing "ls" does not cut "ls" out of "tools".
  const own = [...new Set(typed.map(squash))].filter(Boolean).sort((a, b) => b.length - a.length);
  const seen = own.reduce((h, t) => h.replace(new RegExp(`(?<!\\S)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\S)`, 'g'), '\u241E'), all);
  const found = quote.length >= 3 && seen.includes(quote);
  const onlyTyped = !found && quote.length >= 3 && all.includes(quote);
  let { verdict, got } = p;
  if (verdict === 'pass' && !found) { verdict = 'fail'; got = `${got} [the lab changed this to fail: ${!quote ? 'no quote given' : onlyTyped ? 'the quote is only text the lab agent typed itself' : 'the quote is not text the lab captured'}]`; }
  return { n: step.n, text: step.text, tried: p.tried, expected: p.expected, got, verdict, quote: p.quote || '', quoteFound: found };
}

/** Parse scenarios: "## title" headings, each line under one is a step. Plain text without headings is one scenario. */
export function parseScenarios(text) {
  const out = [];
  let cur;
  const stepOf = l => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
  for (const raw of String(text).split('\n')) {
    const h = raw.match(/^##\s+(.*)$/);
    if (h) { cur = { title: h[1].trim(), steps: [] }; out.push(cur); continue; }
    if (/^#\s/.test(raw) || !raw.trim() || /^\s*<!--/.test(raw)) continue;
    if (!cur) { cur = { title: 'Scenario', steps: [] }; out.push(cur); }
    cur.steps.push(stepOf(raw));
  }
  // One line of plain words: one step per sentence.
  if (out.length === 1 && out[0].steps.length === 1 && out[0].title === 'Scenario') {
    out[0].steps = out[0].steps[0].split(/(?<=[.?!])\s+(?=[A-Z/])/).map(s => s.trim()).filter(Boolean);
  }
  return out.filter(s => s.steps.length).map((s, i) => ({ ...s, n: i + 1, steps: s.steps.map((t, j) => ({ n: j + 1, text: t })) }));
}
export function pickScenario(all, sel) {
  if (!all.length) throw Error('No scenarios found');
  if (!sel) return all; // nothing chosen: every scenario, each in its own lab
  if (/^\d+$/.test(sel)) { const s = all.find(x => x.n === Number(sel)); if (s) return [s]; throw Error(`No scenario ${sel}; there are ${all.length}`); }
  if (sel === 'first') return [all[0]];
  const hits = all.filter(s => (s.title + ' ' + s.steps.map(t => t.text).join(' ')).toLowerCase().includes(sel.toLowerCase()));
  if (hits.length === 1) return hits;
  throw Error(hits.length ? `"${sel}" matches ${hits.length} scenarios: ${hits.map(s => s.n).join(', ')}` : `"${sel}" matches no scenario`);
}

/** Run the lab agent as a headless Pi: empty folder, its own profile, only the lab_* tools. */
export function runJudge(id, scenario, seconds = 900) {
  const d = dirs(id), r = readRun(id);
  writeRun(id, { scenario, steps: scenario.steps.map(s => ({ ...s, verdict: null })), phase: 'judging' });
  const prompt = `Run this scenario in the lab.\n\n${scenario.title}\n${scenario.steps.map(s => `${s.n}. ${s.text}`).join('\n')}\n\nThe lab right now:\n${read(id)}`;
  const args = ['-p', '--no-extensions', '-e', path.join(HERE, 'judge.ts'), '--tools', JUDGE_TOOLS.join(','),
    '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-mcp', '--no-session',
    '--model', r.model, '--append-system-prompt', path.join(HERE, 'judge.md'), prompt];
  const log = fs.openSync(path.join(d.logs, 'judge.log'), 'a');
  const child = spawn(need('pi'), args, { cwd: d.judgeCwd, env: env(id, { PI_CODING_AGENT_DIR: d.judgeProfile }), stdio: ['ignore', log, log] });
  writeRun(id, { judgePid: child.pid });
  return new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGTERM'), seconds * 1000);
    const done = problem => { clearTimeout(timer); try { fs.closeSync(log); } catch {} resolve(problem); };
    child.on('error', e => done(e.message));
    child.on('exit', (code, sig) => done(code === 0 ? undefined : `the lab agent exited ${code ?? sig}`));
  });
}

// ---------- report ----------

const bare = t => String(t || '').trim().replace(/[.\s]+$/, '');
// Lowercase a leading capital so it reads mid-sentence, but keep "I" and acronyms (P2, URL).
const lower = t => bare(t).replace(/^(?!I\b)[A-Z](?=[a-z]|\s)/, c => c.toLowerCase());
/** "I tried X, expected Y, got Z." */
export const sentence = s => `I tried ${lower(s.tried)}, expected ${lower(s.expected)}, got ${lower(s.got)}.`;

const stamp = () => new Date().toISOString().replace(/:/g, '').replace(/\..*$/, '').replace('T', '-');

export function writeReport(id, extra = {}) {
  const r = readRun(id);
  mkdir(REPORTS);
  const base = path.join(REPORTS, `${stamp()}-${id}`);
  const shots = (r.shots || []).filter(f => fs.existsSync(f)).map((f, i) => { const to = `${base}-shot-${i + 1}.png`; fs.copyFileSync(f, to); return to; });
  const steps = r.steps || [];
  const passed = steps.filter(s => s.verdict === 'pass').length;
  const result = extra.error ? 'unfinished' : steps.length && passed === steps.length ? 'passed' : 'failed';
  const left = r.copied?.left || {};
  const lines = [
    `# Lab report · ${r.scenario?.title || 'manual session'}`, '',
    `**${result}** · ${passed} of ${steps.length} steps · ${new Date().toLocaleString()} · ${id}`, '',
    `- Project: \`${r.project}\` → copy of ${r.copied?.copied ?? '?'} tracked files`,
    `- Model: \`${r.model}\` · tools in the lab: ${r.tools?.length ? r.tools.map(t => `/${t.name}`).join(', ') : 'none'}`,
    ...(extra.error ? [`- **Error:** ${extra.error}`] : []), '',
    '## Steps', '',
    ...steps.flatMap(s => [
      `### ${s.verdict === 'pass' ? '✓' : '✗'} ${s.n}. ${s.text}`, '',
      s.verdict ? sentence(s) : 'Not reported by the lab agent: counted as failed.',
      ...(s.quote ? ['', `> ${s.quote.replace(/\n/g, '\n> ')}`, '', s.quoteFound ? '_Quote verified against the captured screen text._' : '_Quote NOT found in captured screen text._'] : []), '']),
    ...(r.summary ? ['## Lab agent summary', '', r.summary, ''] : []),
    ...(shots.length ? ['## Screenshots', '', ...shots.map(f => `![${path.basename(f)}](${path.basename(f)})`), ''] : []),
    '## Isolation', '',
    `- Herdr Lab window: bundle \`${BUNDLE_ID}\`, app home \`${dirs(id).app}\``,
    `- Core: \`HC_SESSION=${id}\`, socket \`${dirs(id).coreSocket}\`${r.corePid ? `, pid ${r.corePid}` : ''}`,
    `- Pi profile: \`${dirs(id).profile}\` (auth.json linked, nothing else); judge profile \`${dirs(id).judgeProfile}\``,
    `- Lab agent: \`pi -p --no-extensions --tools ${JUDGE_TOOLS.join(',')} --no-context-files --no-skills --no-mcp --no-session\` in empty folder \`${dirs(id).judgeCwd}\``,
    ...Object.entries(left).filter(([, v]) => v.length).map(([k, v]) => `- Left out (${k}): ${v.slice(0, 20).map(f => `\`${f}\``).join(', ')}${v.length > 20 ? ` and ${v.length - 20} more` : ''}`), '',
    '## Everything the lab captured', '', '```text', captured(id).trim(), '```', '',
  ];
  fs.writeFileSync(`${base}.md`, lines.join('\n'));
  writeRun(id, { report: `${base}.md`, result });
  return { report: `${base}.md`, result, passed, total: steps.length, shots };
}
export function appendToReport(file, text) { try { fs.appendFileSync(file, text); } catch {} }

// ---------- stop ----------

export function list() {
  if (!fs.existsSync(LAB_HOME)) return [];
  return fs.readdirSync(LAB_HOME).filter(n => ID_RE.test(n)).map(id => {
    const r = readRun(id) || {};
    return { id, project: r.project, phase: r.phase, created: r.created, core: coreUp(id) ? 'running' : 'stopped', window: r.appPid && alive(r.appPid) ? 'open' : 'closed', report: r.report };
  }).sort((a, b) => String(b.created).localeCompare(String(a.created)));
}
export const latest = () => list().find(l => l.core === 'running' || l.window === 'open')?.id || list()[0]?.id;

/** Close only what this lab started: its judge, its terminals, its window, its core; then delete its files. */
export async function stopLab(id) {
  const d = dirs(id), r = readRun(id);
  if (!r) throw Error(`No lab ${id}. \`lab list\` shows labs on this computer.`);
  const done = [];
  if (r.judgePid && alive(r.judgePid)) { process.kill(r.judgePid, 'SIGTERM'); done.push(`lab agent (pid ${r.judgePid}) ended`); }
  if (coreUp(id)) {
    const ts = hcJson(id, ['ls'], { check: false })?.terminals || [];
    for (const t of ts) hc(id, ['kill', t.address], { check: false });
    if (ts.length) done.push(`${ts.length} lab terminal(s) ended`);
  }
  const pid = r.appPid || findAppPid(id);
  if (pid && alive(pid)) {
    app(id, ['do', 'app.quit'], { check: false, timeout: 5000 });
    for (let i = 0; i < 40 && alive(pid); i++) await sleep(200);
    // Signal only if that pid is still this lab's window (checked by its app home), never anything else.
    if (alive(pid) && findAppPid(id) === pid) process.kill(pid, 'SIGTERM');
    done.push(`Herdr Lab window (pid ${pid}) closed`);
  }
  if (coreUp(id)) {
    hc(id, ['server', 'stop'], { check: false });
    for (let i = 0; i < 50 && coreUp(id); i++) await sleep(100);
    done.push(`core ${id}${r.corePid ? ` (pid ${r.corePid})` : ''} stopped`);
  }
  // Herdr can respawn a space's first terminal while the window quits; once the core is gone it is an
  // orphaned shell still running the lab's own command line. End only processes naming this lab's folders.
  const strays = await endStrays(id);
  if (strays) done.push(`${strays} stray lab process(es) ended`);
  fs.rmSync(d.sock, { recursive: true, force: true });
  fs.rmSync(d.root, { recursive: true, force: true });
  done.push(`deleted ${d.root} (project copy, Pi profiles, logs, screenshots) and ${d.sock}`);
  return { id, done, left: leftovers(id, { window: pid, core: r.corePid, 'lab agent': r.judgePid }) };
}

const labMarkers = id => [`${path.join(LAB_HOME, id)}/`, `${path.join(SOCK_ROOT, id)}/`];
/** Pids whose command line names this lab's run or socket folder, never this process or its parent. */
function labProcesses(id) {
  const ps = spawnSync('/bin/ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8' }).stdout || '';
  const self = new Set([process.pid, process.ppid]);
  return ps.split('\n').map(l => l.trim().match(/^(\d+)\s+(.*)$/)).filter(m => m && !self.has(Number(m[1])) && !m[2].startsWith('/bin/ps')
    && labMarkers(id).some(k => m[2].includes(k))).map(m => Number(m[1]));
}
async function endStrays(id) {
  let pids = labProcesses(id);
  if (!pids.length) return 0;
  for (const p of pids) try { process.kill(p, 'SIGTERM'); } catch {}
  for (let i = 0; i < 20 && pids.some(alive); i++) await sleep(100);
  for (const p of pids.filter(alive)) try { process.kill(p, 'SIGKILL'); } catch {}
  return pids.length;
}

/** What is still around after a stop. For one lab: anything of it. Always: the shared app copy and reports. */
export function leftovers(id, pids = {}) {
  const ps = spawnSync('/bin/ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8' }).stdout || '';
  // Match the lab's own paths (its app bundle, run folder, socket folder), not any text naming the id,
  // and never this process or its parent (the shell that ran `lab stop`).
  const markers = id ? labMarkers(id) : ['Herdr Lab.app/', `${SOCK_ROOT}/`];
  const self = new Set([process.pid, process.ppid]);
  const procs = ps.split('\n').map(l => l.trim()).filter(l => {
    const m = l.match(/^(\d+)\s+(.*)$/);
    return m && !self.has(Number(m[1])) && !m[2].startsWith('/bin/ps') && markers.some(k => m[2].includes(k));
  });
  // The pids this lab recorded (window, core, lab agent): any still alive is a leftover.
  for (const [what, pid] of Object.entries(pids)) if (pid && alive(pid) && !procs.some(l => l.startsWith(`${pid} `))) procs.push(`${pid} (${what})`);
  const files = id ? [dirs(id).root, dirs(id).sock].filter(p => fs.existsSync(p)) : [];
  const otherLabs = list().filter(l => l.id !== id).map(l => `${l.id} (core ${l.core}, window ${l.window})`);
  const kept = [];
  if (fs.existsSync(APP_CACHE)) kept.push(`${APP_CACHE} (cached Herdr Lab.app copy, reused by every lab; delete with \`lab clean\`)`);
  if (fs.existsSync(REPORTS)) kept.push(`${REPORTS} (reports, kept on purpose)`);
  return { processes: procs, files, otherLabs, kept };
}

export function clean() {
  if (list().some(l => l.core === 'running' || l.window === 'open')) throw Error('A lab is still running; `lab stop all` first');
  if (fs.existsSync(APP_CACHE)) for (const v of fs.readdirSync(APP_CACHE)) unlock(path.join(APP_CACHE, v));
  fs.rmSync(APP_CACHE, { recursive: true, force: true });
  return `deleted ${APP_CACHE}`;
}

// ---------- doctor ----------

export function doctor(project = process.cwd()) {
  const checks = [];
  const add = (part, name, fn, note = false) => {
    try { checks.push({ part, name, ok: true, detail: fn() }); }
    catch (e) { checks.push({ part, name, ok: note, note, detail: e.message }); }
  };
  add('workspace', 'platform', () => { if (process.platform !== 'darwin') throw Error(`${process.platform}: the lab is built for macOS`); return `macOS ${os.release()}`; });
  add('workspace', 'hc', () => exec(need('hc'), ['--version']).trim());
  add('workspace', 'herdr-app CLI', () => `${need('herdr-app')} → ${fs.realpathSync(need('herdr-app'))}`);
  add('workspace', 'Herdr.app', () => { const s = sourceApp(); return `${s} ${plist(path.join(s, 'Contents/Info.plist'), 'CFBundleShortVersionString').stdout.trim()}`; });
  add('workspace', 'Herdr Lab app copy', () => fs.existsSync(APP_CACHE) && fs.readdirSync(APP_CACHE).length ? `cached: ${fs.readdirSync(APP_CACHE).join(', ')}` : 'made on first run (about a minute)');
  add('workspace', 'open --env', () => { const v = Number(os.release().split('.')[0]); if (v < 22) throw Error('macOS 13 or later is needed for open --env'); return 'supported'; });
  add('harness', 'pi', () => exec(need('pi'), ['--version']).trim());
  add('harness', 'model logins', () => { if (!fs.existsSync(path.join(DAILY_PI, 'auth.json'))) throw Error(`no auth.json in ${DAILY_PI}; run /login in Pi`); return `${path.join(DAILY_PI, 'auth.json')} (linked, never copied)`; });
  add('harness', 'default model', () => { const m = defaultModel(); if (!m) throw Error('none: set LAB_MODEL or a Pi default, or pass --model provider/id'); return `${m} (${process.env.LAB_MODEL ? 'LAB_MODEL' : 'your Pi default; set LAB_MODEL for a cheaper lab model'})`; });
  // Like herdr-pi-lab: say whether /split and /agent were found. A missing one is a note, not a failure.
  let carried = [];
  add('harness', 'extensions that carry over', () => { carried = carriedExtensions(project); return carried.length ? carried.map(t => `/${t.name}`).join(', ') : 'none'; });
  for (const [name] of CARRIED) add('harness', `/${name}`, () => { const t = carried.find(x => x.name === name); if (!t) throw Error('not found; scenarios that use it will fail'); return t.file; }, true);
  add('project', 'git project', () => {
    const ls = spawnSync('git', ['-C', project, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (ls.status !== 0) throw Error(`${project} is not a git repository; run the lab from a git project`);
    const n = ls.stdout.split('\0').filter(Boolean).length;
    if (!n) throw Error(`${project} has no tracked files yet, so the lab copy would be empty`);
    return `${project} (${n} tracked files)`;
  }, true);
  add('project', 'running labs', () => { const r = list().filter(l => l.core === 'running' || l.window === 'open'); if (r.length) throw Error(`${r.map(l => l.id).join(', ')} still running; \`lab stop all\``); return 'none'; }, true);
  const ready = part => checks.filter(c => c.part === part).every(c => c.ok);
  const headline = `Lab workspace ${ready('workspace') ? 'ready' : 'NOT ready'} · lab harness ${ready('harness') ? 'ready' : 'NOT ready'}`;
  const ok = ready('workspace') && ready('harness');
  const text = [headline, ...checks.map(c => `${c.note ? '○' : c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`), ok ? 'Ready for lab test or /lab test.' : 'Fix the ✗ lines, then run lab doctor again.'].join('\n');
  return { ok, headline, checks, text };
}
