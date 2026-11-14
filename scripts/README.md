# dev + box

Two small Bash scripts:

- `dev`: a tmux session per Git project, with an editor and a terminal window.
- `box`: Claude Code in a [Docker Sandbox](https://docs.docker.com/ai/sandboxes/) (`sbx`), and a way to pull its work into your checkout for review.

## Layout

This is a [GNU Stow](https://www.gnu.org/software/stow/) package. The scripts live at `scripts/.local/bin/` so that stowing links them into `~/.local/bin/`. Stow ignores this top-level `README.md`, so it is not linked into `~`.

## Requirements

Bash, Git, tmux and Neovim for `dev`; Git, jq and `sbx` for `box`. The Changes panel of the Herdr app is the intended review view for `box take`, but any diff viewer of uncommitted changes works.

Store the agent's credentials with sbx, not in the sandbox: `claude login` OAuth shows up as `anthropic (oauth configured)` in `sbx secret ls`. Keep other service secrets (GitHub especially) out of global scope; sbx's proxy authenticates every sandbox's requests with them.

## Install

From the dotfiles root:

```bash
stow --no-folding scripts sbx
```

`--no-folding` makes Stow link each file individually instead of symlinking a missing `~/.local/bin` or `~/.config/sbx` into this repo, which would make other tools write into your dotfiles (sbx keeps `credentials.yaml` in `~/.config/sbx`). After adding a new script, re-stow with `stow -R --no-folding scripts`. `~/.local/bin` is on `PATH` through `zsh/.zshrc`.

## dev

Run `dev` inside a Git repository. It creates (or switches to) a tmux session named after the repository, with an `editor` window running `nvim .` and a `terminal` window. Linked worktrees map to the same session as the main checkout.

## box

| Command | Action |
|---|---|
| `box ratelimit` | Start Claude in a new sandbox `<repo>-ratelimit`, or reattach to it if it exists |
| `box take ratelimit` | Fetch the agent's commits and squash them into your checkout, uncommitted |
| `box rm ratelimit` | Delete the sandbox; offers to keep its commits as branch `sbx/ratelimit` |
| `box ls` | This repository's sandboxes and their status |

Task names are lowercase letters, numbers and `-`.

### What `box <task>` runs

A new task runs, in the current terminal:

```bash
sbx run --clone --kit ~/.config/sbx/kits/claude-prefs --cpus 4 --memory 8g --name <repo>-<task> claude <repo root>
```

- `--clone`: the agent works on a private clone inside the sandbox, starting on the branch you have checked out. Your repository is mounted read-only, so the agent can't touch your working tree or `.git`. Uncommitted changes are not copied in (box warns).
- `--kit`: the `claude-prefs` kit (below).
- `--cpus` / `--memory`: explicit, so several sandboxes can run at once. Change them at the top of `box`.

An existing task runs `sbx run --name <repo>-<task>`, which reattaches to the same clone. The kit, clone mode and sizing only apply at creation; `box rm` and start again to pick up changes.

Run it in a Herdr tab: the agent reports working/idle/done to Herdr through the sandbox's terminal.

### Taking the agent's work

The agent's commits come back through a `sandbox-<name>` Git remote that sbx adds to your repository. Only committed work comes back, so tell the agent to commit.

`box take <task>`:

1. Refuses if your checkout has uncommitted changes, so rejecting is always safe.
2. Starts the sandbox if it's stopped (the remote only answers while it runs).
3. Asks the sandbox which branch the agent is on, and fetches it.
4. Runs `git merge --squash`: the agent's work lands in your index and working tree, **uncommitted**, and nothing is recorded in history.

Then review it in Herdr's Changes panel (or `git diff --cached`):

| You want to | Do |
|---|---|
| Accept | `git commit` (the message is prefilled with the agent's commit messages) |
| Fix things first | Edit, then commit |
| Drop one file | `git restore --source=HEAD --staged --worktree <file>` |
| Reject, or ask for changes | `git reset --hard`, tell the agent, then `box take` again: you get the full result, original work plus fixes, as one diff |

After you **commit** something from the agent, tell it to run `git pull origin <branch>` before continuing. Inside the sandbox, `origin` is your repository, so this brings your commit into its history and the next `box take` shows only its new work. If you forget and committed its work unchanged, the next squash still applies cleanly; if you had edited it, expect conflicts.

`box take` squashes into the checkout you run it in, main or a linked worktree.

### Example

```bash
cd ~/code/project
git pull                     # the sandbox starts from your current branch
box ratelimit                # in a Herdr tab; give Claude the task, ask it to commit
# ...Herdr shows the agent done...
box take ratelimit           # from another tab
# review in the Changes panel
git commit                   # or: git reset --hard, ask for changes, box take again
uv run pytest                # first time the agent's code runs on your machine
git push
box rm ratelimit
```

## Sandbox configuration: the claude-prefs kit

`sbx/.config/sbx/kits/claude-prefs/claude-prefs.yaml` (stowed to `~/.config/sbx/kits/claude-prefs`) runs once when a sandbox is created and writes:

- `/etc/claude-code/managed-settings.json`: turns off claude.ai connectors, workflows, bundled skills and artifacts (a smaller context window), and sets the status line. Managed settings sit above every other settings file, so the agent can't override them, and no project can either.
- `/etc/claude-code/statusline.sh`: a short `jq` script showing context tokens in bold yellow and the percent used in grey, like `45.2k(23%)`.

Changes apply to sandboxes created afterwards. Kits are experimental in sbx; if an update breaks sandbox creation, start with `sbx kit validate ~/.config/sbx/kits/claude-prefs`.

Not the kit's job:

- **Skills**: sbx has a shared skills store, linked read-only into every sandbox's `~/.claude/skills`. Fill it with `sbx skills import` (copies from `~/.claude/skills` and similar) or `sbx skills add <repo>`.
- **MCP servers**: `sbx mcp add`.
- **Secrets**: `sbx secret`.

## Safety

- The sandbox, not the agent's permission prompts, is the safety boundary. The agent can't write your repository or anything else on the host; your machine first runs its code after you take and commit it.
- Review before running anything, especially changes to build and tool config: `pyproject.toml`/`uv.lock`, `package.json`, `Makefile`, `conftest.py`, `.pre-commit-config.yaml`, `.envrc`, `mise.toml`, `.nvim.lua`.
- The sandbox can reach the network allowlist (GitHub and others) but has no credentials of yours beyond the agent's.
- Run tests and dev servers inside the sandbox; publish a port with `sbx ports` to open an app in the host browser.

## Test before real work

```bash
bash -n ~/.local/bin/dev ~/.local/bin/box
cd /path/to/a/disposable/git/repo
box demo                     # ask Claude to commit a small change, then exit
box take demo
git reset --hard
printf "y\nn\n" | box rm demo   # delete; don't keep the branch
```
