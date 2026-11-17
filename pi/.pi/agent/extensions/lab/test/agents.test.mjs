// /lab new's brief, /lab report and list, completions and help.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectAgents, latestReport, reportExcerpt, newAgentBrief } from '../agents.mjs';
import { completions, help, EXAMPLES } from '../help.mjs';

function project(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-agents-'));
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); }
  return dir;
}

test('projectAgents: only folders with expectations, named by their title', () => {
  const p = project({
    'agents/critic/expectations.md': '# Critic expectations\n',
    'agents/repeater/expectations.md': '# Something else\n',
    'agents/draft/agent.md': '# Draft\n',
  });
  assert.deepEqual(projectAgents(p), ['Critic', 'Repeater']);
  assert.deepEqual(projectAgents(project()), []);
});

test('latestReport and reportExcerpt', () => {
  const p = project({
    'agents/critic/expectations.md': '# Critic\n',
    'agents/critic/reports/2026-11-17-100000-lab-aaaaaa.md': 'old',
    'agents/critic/reports/2026-11-17-110000-lab-bbbbbb.md': '# Critic · lab report\n\n**All expectations met**\n\n![shot](x.png)\n\n## What each pane showed\n\nsecret-ish transcript',
    'agents/critic/reports/2026-11-17-110000-lab-bbbbbb.png': '',
  });
  const f = latestReport(p, 'Critic');
  assert.match(f, /110000-lab-bbbbbb\.md$/);
  const ex = reportExcerpt(fs.readFileSync(f, 'utf8'));
  assert.match(ex, /All expectations met/);
  assert.doesNotMatch(ex, /What each pane showed|transcript|!\[/);
  assert.equal(latestReport(p, 'Nobody'), undefined);
});

const TEMPLATE = fs.readFileSync(new URL('../new-agent.md', import.meta.url), 'utf8');

test('newAgentBrief, new agent: interview, the format, wait for OK, then agent.md and the lab tool', () => {
  const p = project();
  const b = newAgentBrief(p, 'critic', 'checks prompts', TEMPLATE);
  assert.doesNotMatch(b, /\{\{/);
  assert.match(b, /\*\*Critic\*\*: “checks prompts”/);
  assert.match(b, /at most three short questions/);
  assert.match(b, /agents\/critic\/expectations\.md/);
  assert.match(b, /Expect \(Critic\):/);
  assert.match(b, /wait for my OK/);
  assert.match(b, /`agents\/critic\/agent\.md`: `# Critic`, then `## Job`/);
  assert.match(b, /\{"action":"test","agent":"Critic"\}/);
  assert.match(b, /\{"action":"wait","run":"<run ID>"\}/);
  assert.match(b, /at most three runs/);
  assert.match(b, /never the expectations/);
});

test('newAgentBrief, existing expectations: kept untouched, no expectations step (lesson line 404)', () => {
  const p = project({ 'agents/critic/expectations.md': '# Critic expectations\n' });
  const b = newAgentBrief(p, 'Critic', undefined, TEMPLATE);
  assert.match(b, /already exists and is approved: \*\*leave it exactly as it is\*\*/);
  assert.match(b, /Skip writing expectations/);
  assert.doesNotMatch(b, /Write the expectations first|~~~markdown/);
  assert.match(b, /Write the agent/);
  const both = newAgentBrief(project({ 'agents/critic/expectations.md': 'x', 'agents/critic/agent.md': '# Critic' }), 'Critic', undefined, TEMPLATE);
  assert.match(both, /agent\.md` already exists: read it first/);
});

test('completions: subcommands, agent names, test flags; free text is never replaced', () => {
  const agents = () => ['Critic', 'Repeater'];
  assert.equal(completions('', agents), EXAMPLES);
  assert.deepEqual(completions('re', agents).map(i => i.value), ['report ']);
  assert.deepEqual(completions('test ', agents).map(i => i.value), ['test Critic ', 'test Repeater ']);
  // A typed partial name comes first, as typed, so Enter keeps it.
  assert.deepEqual(completions('test cr', agents).map(i => i.value), ['test cr', 'test Critic ']);
  assert.deepEqual(completions('report R', agents).map(i => i.value), ['report R', 'report Repeater']);
  assert.equal(completions('test Critic', agents), null);
  assert.equal(completions('new Concierge', agents), null);
  assert.deepEqual(completions('test Critic ', agents).map(i => i.value), ['test Critic --model ', 'test Critic --agent-model ', 'test Critic --tester-model ', 'test Critic --behind']);
  assert.deepEqual(completions('test Critic --behind --t', agents).map(i => i.value), ['test Critic --behind --tester-model ']);
  assert.equal(completions('test Critic --model ', agents)?.some(i => i.value.endsWith('--model --model ')), false);
  assert.equal(completions('test lab-scenarios.md ', agents), null);
  assert.equal(completions('stop', agents), null);
});

test('help: both forms name new/test/report and the expectations format', () => {
  for (const p of ['lab', '/lab']) {
    const h = help(p);
    assert.match(h, new RegExp(`${p} new <Agent>`));
    assert.match(h, new RegExp(`${p} test <Agent>`));
    assert.match(h, new RegExp(`${p} report <Agent>`));
    assert.match(h, /--agent-model/);
    assert.match(h, /Absent \(Main\)/);
  }
  assert.match(help('lab'), /Pi only/);
  assert.match(help('/lab'), /arrives here as a message/);
});
