# factory

Runs the unattended stages of the flow (implement, then review) on one ticket or on every ticket of a feature, each in its own Docker container, in any project on this Mac. One copy of the factory lives here. Each project keeps only what is about that project.

Words follow [GLOSSARY.md](../agents/GLOSSARY.md): **stage**, **ticket**, **runner** (the container), **factory run** (one stage on one runner), **Check**.

The two commands you normally type are `factory run <ticket>` and `factory run <feature>`. Both run implement, then review. `factory implement` and `factory review` run a single stage, for debugging, rerunning a stage, or the bench.

**Status (2026-11-20):** `factory implement` and `factory review` are proven end to end in the course project, on its ticket 02: both ended `OK` and every Check passed after each. Known gap: `factory implement` writes no log file yet. `factory run` is built and its guards are tested, but it has not yet run a real ticket end to end. What is not built yet is marked *(later)*.

## Where the factory sits in the flow

```
at the keyboard (Main, skills)             unattended (factory)                 you again
grill → spec → tickets                     implement → review, per ticket       read the branch, merge or not
.scratch/<feature>/spec.md                 run <feature>: one branch, agent/<feature>
.scratch/<feature>/issues/NN-<slug>.md     run <ticket>:  agent/<feature>-NN-<slug>
```

The factory starts where `to-tickets` stops: committed ticket files under `.scratch/`. It ends at a branch with commits and a short list of what it left for you. It never pushes, never opens a pull request and never merges.

## A typical feature, from idea to merged

Start here when you don't know where to begin. The project is already set up (see "Setting up a project" below if not).

**At the keyboard, in one conversation:**

1. `/grill-with-docs <the idea>` (or `/grilling` in a project with no glossary). Answer until it has nothing left to ask.
2. `/to-spec`. Agree the seams it asks about. It writes `.scratch/<feature>/spec.md`.
3. `/to-tickets`. Agree the breakdown and the blocking edges. It writes `.scratch/<feature>/issues/01-….md`, `02-….md`, …
4. Read the tickets, then commit them: `git add .scratch && git commit -m "<feature>: spec and tickets"`.

**Unattended, from your working branch:**

5. `factory run .scratch/<feature>`, in its own pane. For each ticket in number order (`to-tickets` numbers them blockers first) it implements, then reviews, all on one branch, `agent/<feature>`. Each ticket starts from the commits of the one before. It streams what the agent does and ends with `OK`, the branch and what was left for you on each ticket, or `FAILED` at the first ticket that failed. A failure stops the run: later tickets build on earlier ones.
6. Read the branch: `git log --oneline <your branch>..agent/<feature>` and `git diff <your branch>...agent/<feature>`. Each ticket's commits come together, implement first, then the review's fixes. Decide what it left for you.
7. Merge it yourself (`git merge agent/<feature>`), or delete the branch, fix the tickets and run again.

**One ticket instead:** `factory run .scratch/<feature>/issues/NN-<slug>.md` does the same for that ticket alone, on `agent/<feature>-NN-<slug>`, from your branch as it is. Use it for a targeted change, or to redo one ticket. What blocks it must be merged into your branch first. You read and merge that branch the same way.

**After a failure:** read what it printed and use the table below. Rerunning the same `factory run` starts again where it stopped: tickets whose implement and review both ended `OK` are skipped. It does not redo a failed stage over that stage's commits; it refuses and prints the command that resets the branch to where the stage began, so nothing is thrown away without you.

**Where am I?** Until `factory status` exists: the tickets in `.scratch/<feature>/issues/`, the branches in `git branch --list 'agent/*'`, and one record per ticket in `.sandcastle/runs/`. A record names the branch it ran on, `agent/<feature>` or `agent/<feature>-NN-<slug>`. A ticket belongs to one or the other: `factory run <ticket>` refuses a ticket whose record is on the feature branch, and the other way round, until you delete the record.

**When something goes wrong:**

| What went wrong | Do |
|---|---|
| A skill at the keyboard misbehaved (grill, spec, tickets) | `/test-skill <name> <the complaint>` (`agents/README.md`) |
| A factory run failed (no commit, a Check failing) | Read what it printed (a review also writes its log to `.sandcastle/logs/`). Reset as it says and rerun once; if it fails again, the ticket is probably too big or unclear: split or rewrite it |
| The implementer or reviewer did the wrong thing, again | Turn it into a bench case in the project, then change the prompt here (see "Testing the factory") |

## Layout

### Here, in dotfiles

```
factory/
  README.md                  # this file
  package.json, package-lock.json
                             # @ai-hero/sandcastle (pinned), zod, tsx. node_modules is gitignored
  src/
    cli.ts                   # the `factory` command
    agent.ts                 # the one place that picks the model for every stage: pi("anthropic/claude-opus-5-5")
    stages.ts                # the two stages: implement, and review (one run of the code-review skill)
    project.ts               # shared helpers: factory.json, the ticket, the run record, the logs folder
    findings.ts              # the review's structured answer
  prompts/
    implement.md             # the implementer's prompt; no project facts in it
    review.md                # the reviewer's prompt; no project facts in it
  templates/
    Dockerfile               # starting point for a project's image: Node, git, jq, Pi (pinned to the lab's)
    factory.json             # starting point for a project's settings
scripts/.local/bin/factory   # the command: runs src/cli.ts from this folder
```

`factory/` is not a stow package: nothing in it is linked into `~`. Only the `factory` command is, through the `scripts` package.

The prompts hold no project facts. Where code goes, which commands must pass and what words to use come from the project (next section). What was project-specific in the course project's prompts (`app/lib/`, `npm run …`) moves to that project's `AGENTS.md` and `factory.json`.

### In each project

```
AGENTS.md                    # the project's facts; the runner reads it like any session does
.sandcastle/
  Dockerfile                 # the project's image: its toolchain, plus Pi
  factory.json               # setup command, Checks, base branch
  .env                       # the factory's API key (gitignored)
  .env.example
  runs/                      # one record per ticket: branch, base, commits, result (gitignored)  (later: read by `factory status`)
  logs/, worktrees/          # written by the factory (gitignored)
.scratch/<feature>/          # the spec and its tickets, from to-spec and to-tickets
```

`factory.json`, for the course project:

```json
{
  "setup": "npm ci && npm run db:migrate && npm run db:seed",
  "checks": ["npm run typecheck", "npm run test", "npm run build"]
}
```

- `setup` runs once in each runner before the agent starts. One command: Sandcastle runs separate setup hooks at the same time, not in order.
- `checks` are what the prompts tell the agent must pass, and what the factory runs itself afterwards. A factory run that leaves a Check failing has failed, whatever the agent said.

The project does not need Sandcastle in its own `package.json`. The factory brings it.

### What the runner sees

- **The ticket's branch**, as a git worktree mounted into the container. The rest of your checkout is not mounted.
- **The global skills**, read-only: `~/dotfiles/agents/.agents/skills/` is mounted at `~/.agents/skills/` in the container, so Pi there loads the same skills as Pi on the Mac. That is how the review stage uses `code-review` with no copy in the project.
- **The key in `.sandcastle/.env`.** The agent can read it and the network is open, so use a separate, spend-capped key. Isolation beyond that is M5b in the plan (sbx).

## Commands

Run from the project's root.

| Command | What it does |
|---|---|
| `factory init` | Writes `.sandcastle/Dockerfile`, `factory.json` and `.env.example` from the templates, adds the gitignore lines, and lists what to edit. Refuses if `.sandcastle/Dockerfile` exists |
| `factory build` | Builds the project's image from `.sandcastle/Dockerfile`. Again after changing the Dockerfile |
| `factory doctor` | Docker running, image built, key present, `factory.json` valid, skills mount found, the working tree clean |
| `factory smoke` | One "Hello" run: proves the image, the key and that Sandcastle reads Pi's output |
| `factory run <feature>` | Implement, then review, every ticket of `.scratch/<feature>/issues/` in number order, on one branch `agent/<feature>` from the current branch. Skips tickets already done on it; stops at the first failure |
| `factory run <ticket>` | Implement, then review, one ticket on `agent/<feature>-<NN-slug>`, from the current branch. Skips a stage already done |
| `factory implement <ticket>` | One stage: implement one ticket on `agent/<feature>-<NN-slug>`, from the current branch. Then the Checks, and the record in `.sandcastle/runs/` |
| `factory review <ticket>` | One stage: review the branch the ticket's record names against the ticket, from the base the record names. Fixes what needs no person's decision, commits each fix, then the Checks. Prints what it left for you |
| `factory status <feature>` *(later)* | One line per ticket: waiting, blocked, implemented, reviewed, failed, with branch, commits, what was left for you, time |

Output streams to the terminal; open it in its own pane to watch. `factory review` also writes its full log to `.sandcastle/logs/` and prints the path; `factory implement` writes no log file yet, so run it in a terminal to see the agent's output.

What a stage must show before it counts as done, checked by the factory, not taken from the agent's summary: at least one commit (implement), a clean working tree, every Check passing.

## Setting up a project

1. The project has `AGENTS.md` and a local tracker (`agents/README.md`, "Onboarding a new project"). Its tickets come from `to-tickets`.
2. `factory init`. Edit `.sandcastle/Dockerfile` for the project's toolchain and `.sandcastle/factory.json` for its setup and Checks.
3. Put the facts the runner needs in `AGENTS.md`, not in the prompts: where behaviour goes, how tests are written, and where the coding standards are. The reviewer finds standards with step 3 of `code-review` (it searches for them, and always takes `CODING_STANDARDS.md` or `CONTRIBUTING.md` when present); a line in `AGENTS.md` naming the file makes it certain.
4. Create `.sandcastle/.env` with a separate, spend-capped key.
5. Docker Desktop running. `factory build`, `factory doctor`, `factory smoke`.
6. The first real ticket: `factory run <ticket>`, then read the branch. Running the two stages by hand (`factory implement`, read, `factory review`, read again) shows what each one did.

## One-time setup on a Mac

1. Docker Desktop.
2. `cd ~/dotfiles/factory && npm ci`.
3. `stow -R scripts` for the `factory` command.

## Testing the factory: the bench

The bench tests a stage the way the lab tests a skill: saved cases with a planted defect, Checks and a judged line or two, `--runs N`. The bench tool is the lab's (`bench`, in `pi/.pi/agent/extensions/lab/`); its cases live in the project whose code they use (`.sandcastle/bench/<stage>/<case>/`). Change a prompt here, rerun the bench there, keep the change only if nothing dropped.

## Rules

- A ticket must be committed before a factory run: the runner starts from a worktree of HEAD. `factory run <feature>` checks every ticket of the feature before it starts.
- One branch per feature run, one per single-ticket run. Each review sees only its own ticket's commits: its base is where that ticket's implement began.
- The factory never pushes, opens a pull request or merges.
- What a factory run claims is checked: commits, clean tree, Checks.
- One model choice, in `src/agent.ts`, for every stage.
- When this file changes, update the matching part of `docs/guide.html` and its footer.
