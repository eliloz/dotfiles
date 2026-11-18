// /lab new's brief, /lab report and list, completions and help.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectSidecars, latestReport, reportExcerpt, newSidecarBrief } from '../sidecars.mjs';
import { completions, help, EXAMPLES } from '../help.mjs';

function project(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-sidecars-'));
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); }
  return dir;
}

test('projectSidecars: only folders with expectations, named by their title', () => {
  const p = project({
    'sidecars/critic/expectations.md': '# Critic expectations\n',
    'sidecars/repeater/expectations.md': '# Something else\n',
    'sidecars/draft/sidecar.md': '# Draft\n',
  });
  assert.deepEqual(projectSidecars(p), ['Critic', 'Repeater']);
  assert.deepEqual(projectSidecars(project()), []);
});

test('latestReport and reportExcerpt', () => {
  const p = project({
    'sidecars/critic/expectations.md': '# Critic\n',
    'sidecars/critic/reports/2026-11-17-100000-lab-aaaaaa.md': 'old',
    'sidecars/critic/reports/2026-11-17-110000-lab-bbbbbb.md': '# Critic · lab report\n\n**All expectations met**\n\n![shot](x.png)\n\n## What each pane showed\n\nsecret-ish transcript',
    'sidecars/critic/reports/2026-11-17-110000-lab-bbbbbb.png': '',
  });
  const f = latestReport(p, 'Critic');
  assert.match(f, /110000-lab-bbbbbb\.md$/);
  const ex = reportExcerpt(fs.readFileSync(f, 'utf8'));
  assert.match(ex, /All expectations met/);
  assert.doesNotMatch(ex, /What each pane showed|transcript|!\[/);
  assert.equal(latestReport(p, 'Nobody'), undefined);
});

const TEMPLATE = fs.readFileSync(new URL('../new-sidecar.md', import.meta.url), 'utf8');

test('newSidecarBrief, new sidecar: interview, the format, wait for OK, then sidecar.md and the lab tool', () => {
  const p = project();
  const b = newSidecarBrief(p, 'critic', 'checks prompts', TEMPLATE);
  assert.doesNotMatch(b, /\{\{/);
  assert.match(b, /\*\*Critic\*\*: “checks prompts”/);
  assert.match(b, /at most three short questions/);
  assert.match(b, /sidecars\/critic\/expectations\.md/);
  assert.match(b, /Expect \(Critic\):/);
  assert.match(b, /wait for my OK/);
  assert.match(b, /`sidecars\/critic\/sidecar\.md`: `# Critic`, then `## Instructions`/);
  assert.match(b, /\{"action":"test","sidecar":"Critic"\}/);
  assert.match(b, /\{"action":"wait","run":"<run ID>"\}/);
  assert.match(b, /at most three runs/);
  assert.match(b, /never the expectations/);
});

test('newSidecarBrief, existing expectations: kept untouched, no expectations step (lesson line 404)', () => {
  const p = project({ 'sidecars/critic/expectations.md': '# Critic expectations\n' });
  const b = newSidecarBrief(p, 'Critic', undefined, TEMPLATE);
  assert.match(b, /already exists and is approved: \*\*leave it exactly as it is\*\*/);
  assert.match(b, /Skip writing expectations/);
  assert.doesNotMatch(b, /Write the expectations first|~~~markdown/);
  assert.match(b, /Write the sidecar/);
  const both = newSidecarBrief(project({ 'sidecars/critic/expectations.md': 'x', 'sidecars/critic/sidecar.md': '# Critic' }), 'Critic', undefined, TEMPLATE);
  assert.match(both, /sidecar\.md` already exists: read it first/);
});

test('completions: subcommands, sidecar names, test flags; free text is never replaced', () => {
  const sidecars = () => ['Critic', 'Repeater'];
  assert.equal(completions('', sidecars), EXAMPLES);
  assert.deepEqual(completions('re', sidecars).map(i => i.value), ['report ']);
  assert.deepEqual(completions('test ', sidecars).map(i => i.value), ['test Critic ', 'test Repeater ']);
  // A typed partial name comes first, as typed, so Enter keeps it.
  assert.deepEqual(completions('test cr', sidecars).map(i => i.value), ['test cr', 'test Critic ']);
  assert.deepEqual(completions('report R', sidecars).map(i => i.value), ['report R', 'report Repeater']);
  assert.equal(completions('test Critic', sidecars), null);
  assert.equal(completions('new Concierge', sidecars), null);
  assert.deepEqual(completions('test Critic ', sidecars).map(i => i.value), ['test Critic --model ', 'test Critic --sidecar-model ', 'test Critic --tester-model ', 'test Critic --behind']);
  assert.deepEqual(completions('test Critic --behind --t', sidecars).map(i => i.value), ['test Critic --behind --tester-model ']);
  assert.equal(completions('test Critic --model ', sidecars)?.some(i => i.value.endsWith('--model --model ')), false);
  assert.equal(completions('test lab-scenarios.md ', sidecars), null);
  assert.equal(completions('stop', sidecars), null);
});

test('help: both forms name new/test/report and the expectations format', () => {
  for (const p of ['lab', '/lab']) {
    const h = help(p);
    assert.match(h, new RegExp(`${p} new <Sidecar>`));
    assert.match(h, new RegExp(`${p} test <Sidecar>`));
    assert.match(h, new RegExp(`${p} report <Sidecar>`));
    assert.match(h, /--sidecar-model/);
    assert.match(h, /Absent \(Main\)/);
  }
  assert.match(help('lab'), /Pi only/);
  assert.match(help('/lab'), /arrives here as a message/);
});
