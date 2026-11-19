// M6: the bench for headless factory stages.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from '../expectations.mjs';
import { fill, caseBranch, checkScript, judgePrompt, parseVerdicts, verdicts, locateCase, BENCH } from '../bench.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
const git = (cwd, ...a) => { const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
function repo() {
  const d = tmp(); git(d, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(d, 'a.txt'), 'one\n'); git(d, 'add', '.'); git(d, 'commit', '-qm', 'base');
  return d;
}
const patchOf = (d, edit) => { fs.writeFileSync(path.join(d, 'a.txt'), edit); const p = spawnSync('git', ['diff'], { cwd: d, encoding: 'utf8' }).stdout; git(d, 'checkout', '-q', '--', '.'); return p; };

test('fill sets known placeholders and refuses unknown ones', () => {
  assert.equal(fill('x --branch {branch} --out {out}', { branch: 'b/1', out: '/o' }), 'x --branch b/1 --out /o');
  assert.throws(() => fill('x {approach}', { branch: 'b' }), /uses \{approach\}, which the bench does not set/);
});

test('caseBranch commits base plus patch on a new branch and leaves no worktree', () => {
  const d = repo(), base = git(d, 'rev-parse', 'HEAD');
  const p = path.join(tmp(), 'change.patch'); fs.writeFileSync(p, patchOf(d, 'two\n'));
  const sha = caseBranch(d, base, p, 'bench/x-1');
  assert.equal(git(d, 'rev-parse', 'bench/x-1'), sha);
  assert.equal(git(d, 'show', 'bench/x-1:a.txt'), 'two');
  assert.equal(git(d, 'rev-parse', 'HEAD'), base); // the checkout is untouched
  assert.equal(git(d, 'worktree', 'list').split('\n').length, 1);
  const empty = path.join(tmp(), 'change.patch'); fs.writeFileSync(empty, '');
  assert.equal(git(d, 'rev-parse', `${caseBranch(d, base, empty, 'bench/x-2')}^`), base); // the clean case: an empty commit
});

test('caseBranch refuses a base that already holds the bench folder', () => {
  const d = repo();
  fs.mkdirSync(path.join(d, BENCH, 'review'), { recursive: true }); fs.writeFileSync(path.join(d, BENCH, 'review', 'stage.json'), '{}');
  git(d, 'add', '.'); git(d, 'commit', '-qm', 'bench');
  const p = path.join(tmp(), 'change.patch'); fs.writeFileSync(p, '');
  assert.throws(() => caseBranch(d, 'HEAD', p, 'bench/leak'), /would contain \.sandcastle\/bench/);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '-q', 'bench/leak'], { cwd: d }).status, 1);
});

test('checkScript runs setup once and each Check from its own file', () => {
  const s = checkScript('npm ci', 2);
  assert.match(s, /\( npm ci \) >\/bench\/setup\.log/);
  assert.match(s, /bash \/bench\/check-0\.sh .*"status\\":\$\?/);
  assert.match(s, /bash \/bench\/check-1\.sh/);
  const out = spawnSync('bash', ['-c', checkScript('true', 2).replace(/\/bench/g, '$B').replace('cd /home/agent/workspace', 'cd $B')], { encoding: 'utf8', env: { ...process.env, B: (() => { const b = tmp(); fs.writeFileSync(path.join(b, 'check-0.sh'), 'true\n'); fs.writeFileSync(path.join(b, 'check-1.sh'), "jq -e '.x == 1' <<< '{\"x\": 2}'\n"); return b; })() } });
  assert.deepEqual(out.stdout.trim().split('\n').map(l => JSON.parse(l)), [{ i: 0, status: 0 }, { i: 1, status: 1 }]);
});

const md = '# c\n## Names it\nCheck: true\nExpect: a finding names the bug\n## Fixes it\nCheck: false\n## Quiet\nNever: a finding invents a bug';
test('judgePrompt lists only judged expectations, with ticket, diff and output', () => {
  const items = parse(md, 'Review').items;
  const p = judgePrompt({ ticket: 'TICKET', diff: '+x', output: '{"findings":[]}', items });
  assert.match(p, /1\. Names it\n   Expect: a finding names the bug/);
  assert.match(p, /3\. Quiet\n   Never: a finding invents a bug/);
  assert.doesNotMatch(p, /Fixes it/);
  assert.match(p, /TICKET[\s\S]*\+x[\s\S]*"findings":\[\]/);
});

test('parseVerdicts takes the last block, fenced or not', () => {
  assert.deepEqual(parseVerdicts('<verdicts>[]</verdicts> then <verdicts>\n```json\n[{"id":1,"verdict":"pass"}]\n```\n</verdicts>'), [{ id: 1, verdict: 'pass' }]);
  assert.throws(() => parseVerdicts('no block'), /no <verdicts> block/);
});

test('verdicts: Checks decide, a judged pass needs a quote that is in the output', () => {
  const items = parse(md, 'Review').items, output = '{"findings":[{"title":"Decided requests show a waiting time"}]}';
  const ran = [{ line: 3, command: 'true', status: 0, ok: true }, { line: 6, command: 'false', status: 1, ok: false }];
  const [names, fixes, quiet] = verdicts(items, ran, [
    { id: 1, verdict: 'pass', quote: 'Decided requests show a waiting time' },
    { id: 3, verdict: 'pass', quote: 'a quote the review never wrote' },
  ], output);
  assert.equal(names.verdict, 'pass');
  assert.equal(fixes.verdict, 'fail'); // its Check failed; nothing judged
  assert.equal(quiet.verdict, 'fail');
  assert.match(quiet.reason, /Overruled: Not on a screen/);
  const [n2] = verdicts(items, [{ ...ran[0], ok: false, status: 1 }, ran[1]], [{ id: 1, verdict: 'pass', quote: 'Decided requests show a waiting time' }], output);
  assert.equal(n2.verdict, 'fail'); // the judge passed it, the Check did not
  assert.equal(verdicts(items, ran, [], output)[0].verdict, 'fail'); // no verdict from the judge
});

test('locateCase finds stage.json and cases, and names what is missing', () => {
  const d = tmp();
  assert.throws(() => locateCase(d, 'review'), /No \.sandcastle\/bench\/review\/stage\.json/);
  fs.mkdirSync(path.join(d, BENCH, 'review', 'clean'), { recursive: true });
  fs.writeFileSync(path.join(d, BENCH, 'review', 'stage.json'), '{"base":"x","image":"i"}');
  assert.throws(() => locateCase(d, 'review'), /needs "command"/);
  fs.writeFileSync(path.join(d, BENCH, 'review', 'stage.json'), '{"base":"x","image":"i","command":"c"}');
  fs.writeFileSync(path.join(d, BENCH, 'review', 'clean', 'expectations.md'), md);
  assert.deepEqual(locateCase(d, 'review').cases, ['clean']);
  assert.throws(() => locateCase(d, 'review', 'nope'), /No case "nope".*Cases: clean/);
});
