# agents

How I work with coding agents on this Mac: the skills I use in every project, the lab that tests them, and sidecars. One copy of each skill's text lives here. Each project keeps its own tests.

Words follow [GLOSSARY.md](GLOSSARY.md), in this folder: **Main**, **skill**, **sidecar**, **lab**, **expectation**, **baseline**, **Check**, **Tester**.

## The pieces

| Piece | What it is | Where it lives |
|---|---|---|
| The flow's skills | Prompts Main follows: grill → spec → tickets → implement → review, then retro | `agents/.agents/skills/` (here) |
| `test-skill` | A skill that tests another skill: it picks the lab runs for you | `agents/.agents/skills/test-skill/` |
| The lab | An isolated second workspace where a skill or sidecar is tested from outside. `lab` in a terminal, `/lab` in Pi | `pi/.pi/agent/extensions/lab/`, `scripts/.local/bin/lab` |
| `/sidecar` | Opens a sidecar: a model in its own pane that watches Main and shows findings | `pi/.pi/agent/extensions/sidecar/` |
| `/split` | Branches Main into a new pane, for a tangent (see "`/split`" below) | `pi/.pi/agent/extensions/split/` |

## What it needs

- **macOS, the Herdr app and Pi.** The lab opens its own copy of Herdr ("Herdr Lab": separate window, core and socket), so your daily Herdr is never touched. Without Herdr there is no lab. `/sidecar` and `/split` also open Herdr panes.
- The skills themselves work in Pi and in Claude Code. Only testing them needs the lab.
- **`lab doctor`** checks all of it (Herdr, `hc`, the Herdr Lab copy, Pi, the model logins, `/split`, `/sidecar`). Every line must show ✓. Run it from inside a git project.
- Installing Herdr, Pi and the stow packages: the main `README.md`, "Setting up a new machine".

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

1. A `/widget` command beside `/sidecar` in `pi/.pi/agent/extensions/`, with a widget saved in the project as `widgets/<name>/` (instructions and expectations), like a sidecar.
2. A third kind of lab test beside the sidecar test and the skill test, so its expectations can be run.
3. A **Widget** entry in `GLOSSARY.md` first.

Build it when a real need shows up, not before.

## `/split`

A Pi command. `/split ["name"]` branches Main into a new Herdr pane to its right. You pick the message to branch at, or the whole conversation. The branch's agent waits for your next message. Main is never changed.

- **When:** a tangent, most often during grilling: a side question worth following without derailing the round Main is on.
- `/split "Calendar idea"` names the branch. `/split --help` prints the guide and adds nothing to the conversation.
- The branch is told that Main is still running and may be changing the same files.
- It needs a Herdr pane (`hc` and `herdr-app` on PATH). If the pane cannot be opened, the branch is still saved and the error shows the `pi --session` command that opens it.

## The lab

What one lab run does: opens the Herdr Lab window, copies the project's tracked files (no `.git`, no secrets, no `.agents/`, no `AGENTS.md` except in a skill test, no expectations or baselines), starts guest Main in the copy with only the thing under test, and starts a Tester that types each Do line and judges from the screen alone. Then it writes a report and closes everything.

### How a lab run uses Herdr

- **A second Herdr, never yours.** The lab runs "Herdr Lab": a copy of Herdr.app with its own bundle id (`dev.herdr.lab`), its own core (`HC_SESSION`), socket and app home. Everything the lab sends goes to that socket, so your daily Herdr, its windows and its panes are never addressed. The copy is cached in `~/.lab/app`.
- **Its own Pi profile.** A scratch profile that links only `auth.json`, your model logins. Lab panes load `/split`, `/sidecar` and whatever `LAB_EXTENSIONS` names, nothing else of yours.
- **The panes.** A skill test has two: guest Main, and the Tester to its right. A sidecar test has three: guest Main, the sidecar that Main opens with `/sidecar`, and the Tester below.
- **How the Tester drives them.** The Tester is a headless Pi (`pi -p --no-extensions`, only the `lab_*` tools) started in an empty folder, so it cannot read the project or the text under test. It types with `hc send`, presses keys with `hc keys`, reads a pane's screen with `hc read` and takes a picture of the window with `herdr-app shot`.
- **The quote rule.** Every Expect or Never verdict must quote the screen word for word. A quote that was not on a screen the Tester was shown is rejected. See, Absent and Check lines are checked by the lab itself and override the Tester.
- **Teardown.** After the report the lab removes its window, core, terminals and `~/.lab/<id>`, and lists anything left. A test started with `/lab` in Pi leaves its lab open until `/lab stop`; so does `--keep`. `lab stop all` closes every lab and `lab leftovers` shows anything still running or on disk.

### How I normally use it

- **Through `test-skill`.** The commands below are for doing a step by hand.
- **From the project's root**, always. A file must be committed, or at least `git add`ed, before a lab sees it.
- **`--behind`**, so the lab window opens behind my windows.
- **Five runs, never one.** One pass says little. When the bar is 5/5 on one expectation, run one lab at a time and stop at the first failure (the loop is in `test-skill`'s `REFERENCE.md`).
- **Read Main's transcript in the report, not only the tally.** A 5/5 can hide a weakness, and a failure can be a timeout.
- **Never press ctrl+o in a lab's Main pane.** It expands the skill's text on screen, where the Tester can read it.
- Every run spends model tokens. `LAB_MODEL` sets a cheaper default model.

| Command | What it does |
|---|---|
| `lab doctor` | Is the lab ready? |
| `lab test skill <name> --runs 5 --behind` | Five runs of one skill against its expectations, with a tally |
| `lab test skill <name> --behind --wait` | One trial run |
| `lab report skill <name>` | The latest report |
| `lab test <Sidecar> --runs 5 --behind` | The same for a sidecar |
| `lab test "<steps>"` or `lab test FILE` | A scenario: free-form steps, no expectations file |
| `lab stop [ID\|all]`, `lab list`, `lab leftovers` | Close labs; see what is running or left on disk |
| `lab selftest --behind` | The lab's own check. A failure means the lab is broken, not a skill |
| `lab --help` | Everything, including the expectations format |

After changing the lab's code: `cd ~/dotfiles/pi/.pi/agent/extensions/lab && node --test test/*.test.mjs`, then `lab selftest --behind`. After adding or renaming a file under `pi/`: `cd ~/dotfiles && stow -R pi`.

## Rules

- Expectations are written before the change and never loosened.
- One change at a time, measured over 5 runs before it is kept.
- The Tester never sees the text of what it tests.
- Commit locally; push when I choose.
- When this file changes, update the matching part of `docs/guide.html` and its footer.

The unattended part (implement and review runs in Docker, and their bench) is the factory: [../factory/README.md](../factory/README.md).
