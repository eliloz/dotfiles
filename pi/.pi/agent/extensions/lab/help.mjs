// One guide for both forms: `lab …` in a shell and `/lab …` in Pi.
export const ARG_HINT = '<test|doctor|stop|list> · --help';

export function help(p = 'lab') {
  const shell = p === 'lab';
  return `${p} ${ARG_HINT}: a private Herdr Lab window where a black-box lab agent tries a scenario

It opens a second Herdr (its own app copy "Herdr Lab", core, socket and app home), a scratch
Pi profile linked to your model logins, and a copy of this project's tracked files (no .git,
secrets, agent or expectations files). A lab agent types and presses keys there, judges only
from the visible pane text, quotes it, and writes a report. Then the lab stops itself.
Your daily Herdr is never addressed.
${shell ? '' : `
Or ask in plain words; the agent calls the lab tool and reports every step:
  Use the lab to run the first check in lab-scenarios.md
  Now use the lab to run the /split check
  Use the lab to check that ls lists README.md
`}
Commands
  ${p} test                      Every scenario in lab-scenarios.md, each in its own lab
  ${p} test FILE [N|first|words] One scenario from a file of "## title" sections, one step
                               per line (a line ending in ? is a question). Words pick the
                               scenario that contains them, such as /split
  ${p} test "<steps>"            A scenario in plain words, one step per sentence or line
  ${p} doctor                    Check Herdr, hc, Herdr Lab, Pi, logins, /split and /agent
  ${p} stop [ID|all]             Close the latest lab (or that one, or all): window, core, files
  ${p} list                      Labs on this computer${shell ? `
  ${p} start                     Isolate only: open a lab and leave it running, print its ID
  ${p} open|type|keys|read|shot|close …   Drive a started lab by hand (see below)
  ${p} leftovers                 Anything a lab left running or on disk
  ${p} clean                     Delete the cached Herdr Lab.app copy` : ''}
  ${p} --help                    This guide${shell ? '' : '. Adds nothing to the conversation.'}

Options for test${shell ? ' and start' : ''}
  --model p/id       Model for the lab's Pi panes and the lab agent. Default: $LAB_MODEL,
                     else your Pi default. Each run uses tokens, so a small model is a good
                     LAB_MODEL (for example export LAB_MODEL=anthropic/claude-haiku-5-5)
  --behind           Open the lab window behind your windows
  --keep             Leave the lab open after the run; ${p} stop closes it
  --seconds N        Give up on the lab agent after N seconds (default 900)

Extensions that carry over: the lab's Pi panes load /split and /agent wherever they are
installed (the project's .pi, your Pi extensions or packages), plus LAB_EXTENSIONS (paths
separated by :). Nothing else from your Pi setup, and never /lab.

Examples
  ${p} doctor
  ${p} test lab-scenarios.md 1
  ${p} test lab-scenarios.md /split --behind
  ${p} test "Open a new pane. Run ls in it. Take a screenshot. Close the pane."
  ${p} stop${shell ? `

Driving by hand (an agent can do this too; ID defaults to the latest lab)
  lab start                       → lab-1a2b3c
  lab open harness                → [lab] opened pane P2 (harness)
  lab type P2 "Reply with the word ready."
  lab keys P2 enter
  lab read P2
  lab shot
  lab close P2
  lab stop

Exit codes for test: 0 all steps passed, 1 a step failed, 2 the lab could not run,
130 interrupted (the lab is stopped; with --keep it stays open).` : `

Quitting Pi during a run stops that lab.`}

Reports: ~/.lab/reports/<time>-<id>.md, with screenshots. Each run uses model tokens.`;
}
