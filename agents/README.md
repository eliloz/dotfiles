# agents

How I work with coding agents on this Mac: the skills I use in every project, how they are tested, and sidecars. One copy of each skill's text lives here. Each project keeps its own tests. The programs (the lab, the bench, the factory, `/sidecar`, `/split`) are in their own repo, `~/code/agent-tools`.

Words follow [GLOSSARY.md](GLOSSARY.md), in this folder: **Main**, **skill**, **sidecar**, **lab**, **expectation**, **baseline**, **Check**, **Tester**.

## The pieces

| Piece | What it is | Where it lives |
|---|---|---|
| The flow's skills | Prompts Main follows: grill → spec → tickets → implement → review, then retro | `agents/.agents/skills/` (here) |
| `test-skill` | A skill that tests another skill: it picks the lab runs for you | `agents/.agents/skills/test-skill/` |
| The lab | An isolated second workspace where a skill or sidecar is tested from outside. `lab` in a terminal, `/lab` in Pi | `~/code/agent-tools/lab/` |
| `/sidecar` | Opens a sidecar: a model in its own pane that watches Main and shows findings | `~/code/agent-tools/extensions/sidecar/` |
| `/split` | Branches Main into a new pane, for a tangent | `~/code/agent-tools/extensions/split/` |
| The factory and the bench | The unattended stages (implement, review) in Docker, and what tests them | `~/code/agent-tools/factory/`, `lab/` |

## What it needs

- **macOS, the Herdr app and Pi.** The lab opens its own copy of Herdr ("Herdr Lab": separate window, core and socket), so your daily Herdr is never touched. Without Herdr there is no lab. `/sidecar` and `/split` also open Herdr panes.
- The skills themselves work in Pi and in Claude Code. Only testing them needs the lab.
- **`lab doctor`** checks all of it (Herdr, `hc`, the Herdr Lab copy, Pi, the model logins, `/split`, `/sidecar`). Every line must show ✓. Run it from inside a git project.
- Installing Herdr, Pi, the stow packages and the tools: the main `README.md`, "Setting up a new machine".

## Layout

### Here, in dotfiles

```
agents/
  README.md, GLOSSARY.md         # this file and the words it uses (.stow-local-ignore keeps both out of ~)
  .agents/skills/<name>/         # the skill text: SKILL.md and its support files. Pi reads ~/.agents/skills/
  .claude/skills/<name>/         # one relative link per file into .agents/skills/<name>/. Claude Code reads ~/.claude/skills/
```

`stow agents` links both trees into `~`. The repo's `.stowrc` passes `--no-folding`, so stow links file by file: **after adding or removing a file, run `cd ~/dotfiles && stow -R agents`.**

The skills here:

| Skill | Role |
|---|---|
| `grill-with-docs` | How a flow starts: one line that calls `grilling` and `domain-modeling` |
| `domain-modeling` | Writes the project's glossary and decisions while grilling |
| `grilling` | Grill stage. Carries one proven sentence ("Never recommend no…", 1/5 to 5/5) |
| `to-spec` | Spec stage. Carries one proven sentence ("…then stop and wait for their answer…", 4/5 to 5/5) |
| `to-tickets` | Tickets stage |
| `implement` | Implement stage. Calls `tdd` and `code-review` |
| `code-review` | Review stage |
| `tdd` | Called by `implement`. Calls `codebase-design` for its vocabulary |
| `codebase-design` | Called by `tdd` |
| `retro` | After a session: what went wrong. Calls `writing-for-agents` |
| `writing-for-agents` | Called by `retro` |
| `setup-matt-pocock-skills` | Sets a project up for the others (tracker, labels, glossary pointer). Name kept: three skills call it by name |
| `test-skill` | Mine. Tests the others |

All but `test-skill` are Matt Pocock's, from the course project at b84ff53. His licence (MIT) and what came from where: [THIRD-PARTY.md](THIRD-PARTY.md). The first commit adds them unchanged and each proven sentence is its own commit after that, so `git log -p agents/.agents/skills/<name>` shows every way mine differ from his. Matt's other skills stay in the course project. Left out on purpose: `implement-spec` (it needs Claude Code's sub-agents, and the factory is meant to replace it) and `pr` (this flow opens no pull requests).

Skill groupings that feel off, to revisit when forking a skill: `~/code/ai/software-factories/COUPLING-WATCHLIST.md`.

A skill that names one project's code, stack or domain does not belong here. It is a project skill.

### In each project

```
AGENTS.md                        # the project's facts: tracker, commands, glossary pointer. Skills read these
.agents/skills/<name>/           # project skills only, such as database-migrations
.claude/skills -> ../.agents/skills
.agents/skill-tests/<name>/      # the tests of one skill, global or project
  expectations.md                # yours; never loosened
  BASELINE.md                    # pass counts per expectation, and what produced them
  reports/                       # one report per lab run (gitignored)
sidecars/<name>/                 # a sidecar: sidecar.md, expectations.md, reports/
```

A test lives in the project where the problem happened, because its Do lines use that project's domain. The expectation must fail there, then pass there.

## Onboarding a new project

1. `cd` into it and run `lab doctor`. It must be a git repository.
2. Nothing to install for the skills: every session on this Mac already has them.
3. Run `/setup-matt-pocock-skills`. It writes the tracker and glossary sections of `AGENTS.md` that `to-spec`, `to-tickets` and `code-review` follow. Choose the local tracker unless the project needs GitHub issues.
4. Put the project's other facts in `AGENTS.md` (commands, conventions). A skill says how to do a job; the project's facts go here, not into a skill.
5. Add `.agents/skill-tests/*/reports/` and `sidecars/*/reports/` to `.gitignore`.
6. Work: `/skill:grill-with-docs <idea>` (or `/skill:grilling` when the project has no glossary), then `/skill:to-spec`, then `/skill:to-tickets`, in one conversation. Tangents go to `/split`.
7. Write no tests up front. The first test in a project comes from the first time a skill misbehaves there (next section).

## Skills

### Testing a skill: `test-skill`

One command, three forms. `/test-skill …` in Claude Code, `/skill:test-skill …` in Pi.

| You type | What happens |
|---|---|
| `/test-skill <name>` | It looks at the skill and its tests and takes the matching path: no expectations yet → drafts them with you; the skill changed → measures the change; Pi, the lab or the model changed → reruns the baseline; nothing changed → says so and stops |
| `/test-skill <name> <complaint>` | Turns the complaint into an expectation, shows it fails, then tries one change to the skill |
| `/test-skill all` | The same check for every skill with tests in this project |

It announces every batch of lab runs (how many, and why) and waits for your yes. Expectations enter the file only when you approve them.

### When a skill misbehaves

1. `/test-skill <name> <the complaint, in one sentence>`.
2. Approve the expectation it drafts. It goes in `.agents/skill-tests/<name>/expectations.md`.
3. It shows the expectation fails. If no run fails, there is nothing to fix yet.
4. It proposes one change to the skill and runs the lab. The change is kept only if that expectation reaches 5/5 and no other one dropped.
5. Kept: the skill is committed here in dotfiles, the expectation and `BASELINE.md` in the project, with the same before/after counts in both messages. Not kept: the skill is reverted and the attempt recorded in `BASELINE.md`.

### Adding a skill

- **A project skill:** write `.agents/skills/<name>/SKILL.md` in the project (the `writing-for-agents` skill has the style). Then `/test-skill <name>` to give it expectations and a baseline.
- **A global skill:** add its folder under `agents/.agents/skills/`, add the links under `agents/.claude/skills/<name>/`, run `stow -R agents`. Test it from a project that uses it.

### Changing a global skill

- Edit it here. Measure it in the project where the complaint came from.
- Other projects that test the same skill see a stale baseline the next time `test-skill` runs there. Nothing reruns them by itself.
- **Never keep two copies with the same name.** A project copy shadows the global one in that project, and the lab tests the project copy. Use that only to try a change, then move the result here and delete the copy.

### Taking a new version of Matt's skills

1. On a branch in dotfiles, put his new `SKILL.md` in place.
2. In each project with tests for that skill: `/test-skill <name>`. It sees the change and measures it against the baseline.
3. Keep his, keep mine, or merge, with numbers for each.

### How a skill test finds the skill

`lab test skill <name>`, run from a project's root:

1. **Tests** from `.agents/skill-tests/<name>/`. Missing: the lab stops and says so.
2. **Skill text** from the project's `.agents/skills/<name>/` if it exists, else from `~/.agents/skills/<name>/` (that is, here).
3. **The report names which copy it tested**: its real path and the commit of the repository holding it.

`BASELINE.md` records the skill's path and a content hash of its `SKILL.md`, besides the commit. `test-skill` compares the hash, so a baseline stays current when a skill moves between repositories unchanged.

## Sidecars

Sidecars are not part of the flow, and none runs routinely. A sidecar belongs to one project: `sidecars/<name>/sidecar.md`, whose `## Instructions` section is what the model gets.

| To | Do |
|---|---|
| Create one | In Pi: `/lab new <Name> [what it does]`. Main writes the expectations with you first, then the instructions, then runs the lab until they pass (three tries at most) |
| Use one | `/sidecar <Name>` opens it beside Main. It shows numbered findings in its own pane. `/sidecar send main #N` sends one to Main as a note. `/sidecar stop <Name>` closes it. `/sidecar --help` for the rest |
| Test one | `lab test <Name> --runs 5 --behind`. `lab report <Name>` shows the latest report. `lab sidecars` lists those with expectations |
| Change one | Add the expectation first and see it fail. Then change only `## Instructions`, never the expectations, and rerun |

After changing the `/sidecar` code or the lab's sidecar-test code, run the Critic's test in `~/code/sandbox/rentaplace`.

### Widgets

Not built. In the mega course a widget is a pane that gathers a status with a script, has a small model judge it, and shows a short list (to-dos, issues). There is no `/widget` command here and the lab has no widget test. Building one would mean:

1. A `/widget` command beside `/sidecar` in `~/code/agent-tools/extensions/`, with a widget saved in the project as `widgets/<name>/` (instructions and expectations), like a sidecar.
2. A third kind of lab test beside the sidecar test and the skill test, so its expectations can be run.
3. A **Widget** entry in `GLOSSARY.md` first.

Build it when a real need shows up, not before.

## The lab, the bench, `/split`

They are programs, in `~/code/agent-tools`. What a lab run does, how it uses Herdr, the lab's commands and how I normally use them: `~/code/agent-tools/lab/README.md`. `/split` and `/sidecar`: `~/code/agent-tools/README.md`, "The Pi commands". Here the lab is mostly reached through `test-skill` (above).

The short form, from a project's root: `lab doctor`, then `lab test skill <name> --runs 5 --behind`, then `lab report skill <name>`. A file must be committed, or at least `git add`ed, before a lab sees it. Every run spends model tokens; `LAB_MODEL` sets a cheaper default model.

## Rules

- Expectations are written before the change and never loosened.
- One change at a time, measured over 5 runs before it is kept.
- The Tester never sees the text of what it tests.
- Commit locally; push when I choose.
- When this file changes, update the matching part of `~/code/agent-tools/docs/guide.html` and its footer.

The unattended part (implement and review runs in Docker, and their bench) is the factory: `~/code/agent-tools/factory/README.md`.
