// One guide for both forms: `lab …` in a shell and `/lab …` in Pi. Plus /lab's completions.
import { FORMAT } from './expectations.mjs';

export const ARG_HINT = '<new|test|report|doctor|stop|list> · --help';

export function help(p = 'lab') {
  const shell = p === 'lab';
  return `${p} ${ARG_HINT}: grow and test sidecars, and run scenarios, in a private Herdr Lab window

A lab is a second Herdr (its own app copy "Herdr Lab", core, socket and app home), a scratch Pi
profile linked to your model logins, and a copy of this project's tracked files (no .git, secrets,
sidecar instructions or expectations). Your daily Herdr is never addressed.

Sidecars (sidecars/<name>/: sidecar.md, expectations.md, reports/)
  ${p} new <Sidecar> [what it does] ${shell ? 'Pi only: type /lab new there' : 'Interview (≤3 questions), write expectations.md and wait for your OK,\n                               then write sidecar.md and run the lab, fixing only the Instructions (≤3 runs).\n                               An existing expectations.md is kept untouched.'}
  ${p} test <Sidecar>             Guest Main (read-only tools) types the Before lines, opens the sidecar
                               with /sidecar and only its "## Instructions" text; a black-box Tester below it
                               types each expectation's Do lines and judges from the screen alone.
                               ${shell ? 'Add --wait to block until the report (and --keep to leave it open).' : 'Returns at once: a checklist widget follows the run and the result\n                               arrives here as a message. The lab stays open; /lab stop closes it.'}
  ${p} report <Sidecar>           The sidecar's latest report
  ${p} sidecars                   Sidecars here with expectations

Skills (.agents/skills/<name>/: SKILL.md, expectations.md, reports/)
  ${p} test skill <name>          Guest Main (read-only tools) starts with only that skill (--no-skills
                               --skill <a staged copy without expectations, BASELINE.md or reports>);
                               a black-box Tester to its right types each Do line into Main and judges
                               from Main's screen alone. The project copy holds no .agents/ folder.
  ${p} selftest                   The lab's own check: the skill test of echo-twice (kept in the lab's folder,
                               never in a project) in a copy of this project; waits, then stops the lab.
                               A failure means the lab is broken. Reports: ~/.lab/reports/selftest/
  ${p} report skill <name>        The skill's latest report

Scenarios (lab-scenarios.md)
  ${p} test                      Every scenario in lab-scenarios.md, each in its own lab
  ${p} test FILE [N|first|words] One scenario from a file of "## title" sections, one step per line
                               (a line ending in ? is a question). Words pick the scenario, e.g. /split
  ${p} test "<steps>"            A scenario in plain words, one step per sentence or line
${shell ? '' : `
  Or ask in plain words; the sidecar calls the lab tool:
    Use the lab to run the first scenario in lab-scenarios.md
    Use the lab to test the Critic
`}
Labs
  ${p} doctor                    Check Herdr, hc, Herdr Lab, Pi, logins, /split and /sidecar
  ${p} list                      Labs on this computer${shell ? '' : ', with results, and sidecars here'}
  ${p} stop [ID|all]             Close the latest lab (or that one, or all): window, core, files${shell ? `
  ${p} start                     Isolate only: open a lab and leave it running, print its ID
  ${p} open|type|keys|read|shot|close …   Drive a started lab by hand (see below)
  ${p} leftovers                 Anything a lab left running or on disk
  ${p} clean                     Delete the cached Herdr Lab.app copy` : ''}
  ${p} --help                    This guide${shell ? '' : '. Adds nothing to the conversation.'}

Options for test
  --model p/id         Guest Main, the Tester and a scenario's Tester. Default: $LAB_MODEL, else
                       ${shell ? 'your Pi default' : "this conversation's model"}
  --sidecar-model p/id   The sidecar under test. Default: fast (/sidecar's small default)
  --tester-model p/id  The Tester (the judge). Default: --model
  --behind             Open the lab window behind your windows${shell ? `
  --wait / --keep      Sidecar or skill test: wait for the report; keep the lab open afterwards
  --runs N             Sidecar or skill test: run it N times, one lab after another, and print how often each
                       expectation passed. One pass says little about a sidecar on a small model
  --seconds N          Give up after N seconds (default 900)` : ''}

Expectations: sidecars/<name>/expectations.md or .agents/skills/<name>/expectations.md. In a skill
test a line without a pane means Main. Do lines are typed exactly; Expect/Never are judged by the
Tester from quoted screen text (a quote that was not on a screen it was shown is rejected); See/Absent
are checked by the lab itself and override the Tester.
${FORMAT.split('\n').map(l => '  ' + l).join('\n')}

Examples
  ${p} doctor
  ${shell ? `${p} test Critic --wait\n  ${p} test Critic --runs 5 --behind` : `${p} new Critic Check every prompt for missing facts, blast radius and size`}
  ${p} test Critic --behind
  ${p} report Critic
  ${p} test lab-scenarios.md /split
  ${p} stop${shell ? `

Driving by hand (a sidecar can do this too; ID defaults to the latest lab)
  lab start                       → lab-1a2b3c
  lab open harness                → [lab] opened pane P2 (harness)
  lab type P2 "Reply with the word ready."
  lab keys P2 enter
  lab read P2
  lab shot
  lab close P2
  lab stop

Exit codes for test: 0 all passed, 1 something failed, 2 the lab could not run,
130 interrupted (the lab is stopped; with --keep it stays open).` : `

Quitting Pi while a lab is opening stops that lab.`}

Reports: <folder>/reports/<time>-<run>.md (+ .png) for sidecars and skills; ~/.lab/reports/ for scenarios.
Each run uses model tokens.`;
}

/**
 * Shown after "/lab ". In pi 1.5.2 Enter applies the highlighted suggestion instead of submitting,
 * so every value leaves a valid command behind, and typed free text is never swapped for an example.
 */
export const EXAMPLES = [
  { value: '--help', label: '/lab --help', description: 'the guide, with examples; starts nothing' },
  { value: 'new ', label: '/lab new <Sidecar> [what it does]', description: 'interview, expectations (your OK), sidecar.md, lab' },
  { value: 'test ', label: '/lab test <Sidecar>', description: 'test a sidecar against its expectations' },
  { value: 'report ', label: '/lab report <Sidecar>', description: "a sidecar's latest report" },
  { value: 'test lab-scenarios.md 1', label: '/lab test lab-scenarios.md 1', description: "scenario 1 from the project's scenarios file" },
  { value: 'doctor', label: '/lab doctor', description: 'check Herdr, hc, Herdr Lab, Pi, /split and /sidecar' },
  { value: 'list', label: '/lab list', description: 'labs on this computer, with results' },
  { value: 'stop', label: '/lab stop', description: 'close the latest lab: window, core, files' },
];
export const SUBCOMMANDS = ['new', 'test', 'report', 'doctor', 'list', 'stop', '--help'];
const TEST_FLAGS = [
  { value: '--model ', label: '--model provider/id', description: 'guest Main and the Tester' },
  { value: '--sidecar-model ', label: '--sidecar-model provider/id', description: 'the sidecar under test (default fast)' },
  { value: '--tester-model ', label: '--tester-model provider/id', description: 'the judge' },
  { value: '--behind', label: '--behind', description: 'open the lab window behind yours' },
];

export function completions(prefix, sidecars = () => []) {
  if (prefix === '') return EXAMPLES;
  const words = prefix.split(' ');
  if (words.length === 1) {
    const hits = SUBCOMMANDS.filter(s => s.startsWith(prefix) && s !== prefix);
    return hits.length ? hits.map(s => EXAMPLES.find(e => e.value.trim() === s) ?? { value: s, label: `/lab ${s}` }) : null;
  }
  const [sub, ...rest] = words;
  const arg = rest.join(' ');
  if (['test', 'report', 'new'].includes(sub) && rest.length === 1) {
    // Sidecar names with expectations (for new too: growing one keeps its file and writes sidecar.md).
    const names = sidecars().filter(n => n.toLowerCase().startsWith(arg.toLowerCase()) && n.toLowerCase() !== arg.toLowerCase());
    if (!names.length) return null;
    const keep = arg ? [{ value: prefix, label: arg, description: 'what I typed' }] : [];
    return [...keep, ...names.map(n => ({ value: `${sub} ${n}${sub === 'test' ? ' ' : ''}`, label: n, description: sub === 'new' ? 'has expectations: write sidecar.md' : 'has expectations' }))];
  }
  if (sub === 'test' && rest.length >= 2 && !/\.md$/i.test(rest[0])) {
    const last = rest.at(-1);
    if (last !== '' && !last.startsWith('-')) return null;
    const used = new Set(rest);
    const head = prefix.slice(0, prefix.length - last.length);
    const flags = TEST_FLAGS.filter(f => !used.has(f.value.trim()) && f.value.startsWith(last) && f.value.trim() !== last);
    return flags.length ? flags.map(f => ({ ...f, value: head + f.value })) : null;
  }
  return null;
}
