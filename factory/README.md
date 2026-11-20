# factory

Runs the unattended stages of the flow (implement, then review) on tickets, each in its own Docker container, in any project on this Mac. One copy of the factory lives here. Each project keeps only what is about that project.

Words follow [GLOSSARY.md](../agents/GLOSSARY.md): **stage**, **ticket**, **runner** (the container), **factory run** (one stage on one runner), **Check**.

**Status: target, not built.** Today the factory exists only in the course project's `.sandcastle/`, with an `--approach b|c` flag on review. This README is what it becomes. What is not built yet is marked *(later)*.

## Where the factory sits in the flow

```
at the keyboard (Main, skills)             unattended (factory)                 you again
grill → spec → tickets                     implement → review                   read the branch, merge or not
.scratch/<feature>/spec.md                 one branch per ticket:
.scratch/<feature>/issues/NN-<slug>.md     agent/<feature>-NN-<slug>
```

The factory starts where `to-tickets` stops: committed ticket files under `.scratch/`. It ends at a branch with commits and a short list of what it left for you. It never pushes, never opens a pull request and never merges.

## A typical feature, from idea to merged

Start here when you don't know where to begin. The project is already set up (see "Setting up a project" below if not).

**At the keyboard, in one conversation:**

1. `/grill-with-docs <the idea>` (or `/grilling` in a project with no glossary). Answer until it has nothing left to ask.
2. `/to-spec`. Agree the seams it asks about. It writes `.scratch/<feature>/spec.md`.
3. `/to-tickets`. Agree the breakdown and the blocking edges. It writes `.scratch/<feature>/issues/01-….md`, `02-….md`, …
4. Read the tickets, then commit them: `git add .scratch && git commit -m "<feature>: spec and tickets"`.

**Unattended, one ticket at a time, from your working branch:**

5. Pick a ticket whose "Blocked by" tickets are all merged. Start with `01`.
6. `factory implement .scratch/<feature>/issues/01-<slug>.md`, in its own pane. It streams what the agent does; a run takes a few minutes. It ends with `OK` and the branch name, or `FAILED` and why.
7. `factory review .scratch/<feature>/issues/01-<slug>.md`. It reviews that branch, commits its fixes and prints what it left for you to decide.
8. Read the branch: `git log --oneline <your branch>..agent/<feature>-01-<slug>` and `git diff <your branch>...agent/<feature>-01-<slug>`. Decide what it left for you.
9. Merge it yourself (`git merge agent/<feature>-01-<slug>`), or delete the branch and fix the ticket.
10. Back to step 5 with the next ticket. A ticket starts from your branch as it is, so merge what blocks it first.

*(later)* `factory run <feature>` does steps 5–7 for every ticket and stops where it needs you; step 8 stays yours.

**Where am I?** Until `factory status` exists: the tickets in `.scratch/<feature>/issues/`, the branches in `git branch --list 'agent/*'`, and one record per ticket in `.sandcastle/runs/`.

**When something goes wrong:**

| What went wrong | Do |
|---|---|
| A skill at the keyboard misbehaved (grill, spec, tickets) | `/test-skill <name> <the complaint>` (`agents/README.md`) |
| A factory run failed (no commit, a Check failing) | Read its log in `.sandcastle/logs/`. Rerun once; if it fails again, the ticket is probably too big or unclear: split or rewrite it |
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
    implement.ts             # the implement stage
    review.ts                # the review stage: one run of the code-review skill (approach C)
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
| `factory implement <ticket>` | Implement one ticket on `agent/<feature>-<NN-slug>`, from the current branch. Then the Checks, and the record in `.sandcastle/runs/` |
| `factory review <ticket>` | Review that ticket's branch against the ticket, from the base the record names. Fixes what needs no person's decision, commits each fix, then the Checks. Prints what it left for you |
| `factory run <feature>` *(later)* | Implement and review every ticket of a feature in order, skipping blocked ones until what blocks them is done. Stops at the first failure or when nothing is left |
| `factory status <feature>` *(later)* | One line per ticket: waiting, blocked, implemented, reviewed, failed, with branch, commits, what was left for you, time |

Output streams to the terminal; open it in its own pane to watch. Full logs are in `.sandcastle/logs/`.

What a stage must show before it counts as done, checked by the factory, not taken from the agent's summary: at least one commit (implement), a clean working tree, every Check passing.

## Setting up a project

1. The project has `AGENTS.md` and a local tracker (`agents/README.md`, "Onboarding a new project"). Its tickets come from `to-tickets`.
2. `factory init`. Edit `.sandcastle/Dockerfile` for the project's toolchain and `.sandcastle/factory.json` for its setup and Checks.
3. Put the facts the implementer needs in `AGENTS.md` (where behaviour goes, how tests are written), not in the prompts.
4. Create `.sandcastle/.env` with a separate, spend-capped key.
5. Docker Desktop running. `factory build`, `factory doctor`, `factory smoke`.
6. The first real ticket: `factory implement <ticket>`, read the branch, `factory review <ticket>`, read it again.

## One-time setup on a Mac

1. Docker Desktop.
2. `cd ~/dotfiles/factory && npm ci`.
3. `stow -R scripts` for the `factory` command.

## Testing the factory: the bench

The bench tests a stage the way the lab tests a skill: saved cases with a planted defect, Checks and a judged line or two, `--runs N`. The bench tool is the lab's (`bench`, in `pi/.pi/agent/extensions/lab/`); its cases live in the project whose code they use (`.sandcastle/bench/<stage>/<case>/`). Change a prompt here, rerun the bench there, keep the change only if nothing dropped.

The course project's bench also keeps review approach B (two reviewers, one per axis, then a fix run) as an experiment, for a test on a larger change. B is never part of this factory. If it wins, it replaces the review stage here.

## Rules

- A ticket must be committed before a factory run: the runner starts from a worktree of HEAD.
- The factory never pushes, opens a pull request or merges.
- What a factory run claims is checked: commits, clean tree, Checks.
- One model choice, in `src/agent.ts`, for every stage.
