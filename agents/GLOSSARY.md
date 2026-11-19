# Testable Flow

The language for working with a coding harness at the keyboard, testing what runs there in the lab, and handing work to unattended runs. It covers the commands in dotfiles and Matt Pocock's flow.

## Language

### At the keyboard

**Main**:
The one conversation you work in.
_Avoid_: main agent, primary session

**Command**:
Something typed with a slash inside the harness that runs code and adds no turn to Main: `/split`, `/sidecar`, `/lab`.
_Avoid_: workspace helper, tool, extension (that is only how a command is installed)

**Skill**:
A prompt that Main follows when you invoke it by name. It does the work in Main's own conversation.
_Avoid_: slash command, prompt file

**Sidecar**:
A model with instructions saved in a project, running in its own pane beside Main and watching Main's prompts and replies. It never changes anything; it only shows findings.
_Avoid_: agent, supporting agent, role, starter

**Instructions**:
The text that tells a sidecar what to do.
_Avoid_: job, role, system prompt

**Finding**:
One numbered item a sidecar shows in its own pane.

**Note**:
A finding you chose to send to Main.

### In the lab

**Lab**:
An isolated second workspace holding a copy of a project, where something is tested from outside without touching your daily workspace. Reached with the `/lab` command, or as `lab` from a terminal.

**Fixture**:
The project, at a known commit, that a lab test or a bench test runs against.
_Avoid_: sample project, test repo

**Expectation**:
One titled statement of what must happen and what must never happen when a given thing is typed. Written before the change it guards, and never loosened.

**Sidecar test**:
A lab test of one sidecar against its expectations.

**Skill test**:
A lab test of one skill, loaded into Main, against its expectations.

**Scenario**:
A free-form list of steps typed into a lab, with questions answered from the screen. It has no expectations file.
_Avoid_: check, lab check

**Tester**:
The model that judges from what the lab's screens show, and nothing else.
_Avoid_: lab agent, judge

**Lab run**:
One opening of a lab, from start to report.
_Avoid_: run (on its own)

**Report**:
The record of one lab run: for each expectation or step, what was tried, what was expected, what happened, and a quote from the screen.

**Baseline**:
The recorded pass counts of every expectation for one skill or sidecar, with the date, model and fixture commit they were measured on.

### Unattended

**Stage**:
One step of the flow from idea to merged code: grill, spec, tickets, implement, review.

**Spec**:
The agreed description of a feature, produced by grilling and consumed by the tickets stage.

**Ticket**:
One vertical slice of a spec, sized for a single fresh conversation, with the tickets that block it.
_Avoid_: issue, task

**Runner**:
The disposable container in which one stage is carried out without a person present.
_Avoid_: agent, sandbox, box

**Factory run**:
One execution of one stage on a runner.
_Avoid_: run (on its own), job

**Check**:
A deterministic pass-or-fail test of code or files, with no model involved: lint, typecheck, the test suite, or a command the lab runs itself.
_Avoid_: using it for a scenario
