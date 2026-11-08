# dev + box

A small Bash CLI for Git-project tmux sessions and sandboxed agent tasks.

## Layout

This is a [GNU Stow](https://www.gnu.org/software/stow/) package. The scripts live at `scripts/.local/bin/` so that stowing links them into `~/.local/bin/`. Stow ignores this top-level `README.md`, so it is not linked into `~`.

## Requirements

macOS or Linux, Bash, Git, tmux, Neovim with [diffview.nvim](https://github.com/sindrets/diffview.nvim) (installed by the tracked nvim config), jq, and [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) (`sbx`). `dev` and `box` are standalone executable scripts; they do not require tmuxinator.

Store the agent's credentials with sbx, not in the sandbox: `claude login` OAuth shows up as `anthropic (oauth configured)` in `sbx secret ls`. Keep other service secrets (GitHub especially) out of global scope; sbx's proxy authenticates every sandbox's requests with them.

## Install

From the dotfiles root:

```bash
stow --no-folding scripts
```

`--no-folding` makes Stow link each script individually instead of symlinking a missing `~/.local` or `~/.local/bin` into this repo, which would make other tools (Claude Code, pipx) write into your dotfiles. Preview with `stow -nv --no-folding scripts`.

After adding a new script to `scripts/.local/bin/`, re-stow to link it:

```bash
stow -R --no-folding scripts
```

`~/.local/bin` is added to `PATH` by the tracked `zsh/.zshrc`.

`box` also needs the sandbox configuration from the `sbx` package:

```bash
stow --no-folding sbx
```

## Sandbox configuration

Claude sandboxes are created with `sbx env create`, which reads these files. The `sbx` package keeps them in dotfiles:

| File | Controls |
|---|---|
| `sbx/.sbxenv.yaml` → `~/.sbxenv.yaml` | How every sandbox is created: clone mode, CPUs, memory, environment variables, kits |
| `sbx/.config/sbx/kits/claude-prefs/claude-prefs.yaml` | What changes inside it: your Claude settings (the JSON block) and the notification preferences |
| `sbxenv.yaml` at a project's root (optional, committed there) | That project only; merged over your defaults, and its values win |

Changes apply to sandboxes created afterwards. To pick them up, `box remove` the task and create it again.

The kit installs your settings as Claude Code *managed settings* (`/etc/claude-code/managed-settings.json` in the sandbox). sbx owns the sandbox's `~/.claude/settings.json`, and managed settings take priority over every other settings file, so the agent can't override them. A setting you want to change for one project belongs in that project's `.claude/settings.json` instead.

When the project has no `sbxenv.yaml`, `box` approves the plan itself. Otherwise sbx shows the plan and asks, because a project file can run commands on your machine.

Only `box` and `sbx env create` / `sbx env run` (run from the project root, with no path) read these files. A plain `sbx create claude` or `sbx run claude` skips them all. `box --agent <other>` also uses a plain `sbx create --clone`, since the kit is Claude-only.

Kits and `sbx env` are experimental in sbx. If an update breaks sandbox creation, start with `sbx kit validate ~/.config/sbx/kits/claude-prefs`.

## How box works

Each task gets its own sandbox (`sbx env create`, in clone mode): a private clone of the repository inside the sandbox, on branch `feature/<task>` started from the local default branch. Your repository is mounted into it read-only. The agent edits, runs tests and commits freely in there, with no permission prompts.

Its commits come back by `git fetch` from a `sandbox-<name>` remote that sbx adds to your repository while the sandbox runs. Fetched branches are also mirrored into `refs/sandboxes/<name>/*`, which survive the sandbox stopping or being removed. Nothing the agent does reaches your checkout until you `box merge`.

## Commands

| Command | Action |
|---|---|
| `dev` | Create or switch to a project tmux session with editor and terminal windows |
| `box ratelimit` | Create the sandbox if missing, then open its agent window `box:ratelimit` |
| `box new ratelimit` | Create the sandbox **without opening a window** |
| `box open ratelimit` | Open (or restart) the agent window |
| `box ratelimit --agent codex` | Use another sbx agent for a new sandbox |
| `box review ratelimit` | Fetch, then open a diffview of the agent's commits above the agent |
| `Ctrl-a R` | Same as `box review` for the current `box:<task>` window |
| `box merge ratelimit` | Merge the reviewed commits into the default branch (`--squash` to squash) |
| `box list` | Show this project's sandboxes and their unmerged commit counts |
| `box config` | Print project, session and sandbox settings |
| `box remove ratelimit` | Close the agent window, fetch, then delete the sandbox |

Run `box` inside the project (main checkout or any worktree). Opening and reviewing need an active tmux client. Task names are lowercase letters, numbers, `_` and `-`.

## Example lifecycle

```bash
cd ~/code/project
git pull                    # box branches from local main, so update it first
dev                         # creates/attaches tmux project session
box ratelimit               # sandbox + window box:ratelimit with Claude
# Give the agent its task; ask it for small commits.
# About 5s after Claude finishes or needs input, it rings the terminal bell: if you're in another
# window, its status-bar entry turns red with a ! (e.g. 2:box:ratelimit!) until you visit it.

box review ratelimit        # or Ctrl-a R in the agent window
# diffview opens full width above the agent: Tab/S-Tab between files, ]c/[c between changes.
# Ctrl-a m zooms either pane. :qa closes the diff; reply to the agent and review again as needed.

box merge ratelimit         # from anywhere in the project; main checkout must be on main and clean
uv run pytest               # first time the agent's code runs on the host
git push

box remove ratelimit        # closes the agent window too; run it from another window
```

## Safety and behavior

- The sandbox, not the agent's permission prompts, is the safety boundary. The agent cannot write your repository or anything else on the host; the host only runs its code after `box merge`.
- Review before running anything on the host, especially changes to build and tool config: `pyproject.toml`/`uv.lock`, `package.json`, `Makefile`, `conftest.py`, `.pre-commit-config.yaml`, `.envrc`, `mise.toml`, `.nvim.lua`.
- `box review` records the commit it showed you; `box merge` merges exactly that commit. Commits the agent made afterwards are reported and left for the next review.
- After a merge, the next `box review` shows only the agent's newer commits.
- `box remove` fetches the agent's last commits before deleting anything. If commits remain unmerged, it lists them and asks whether to keep them as a normal `feature/<task>` branch or discard them. Either way it deletes the `refs/sandboxes/<name>/*` copies sbx made of the clone's branches.
- `box remove` asks once, then closes the task's tmux window (stopping the agent) before its final fetch. Run it from another window; from a pane inside `box:<task>` it refuses.
- Run tests and dev servers inside the sandbox; publish a port with `sbx ports` to open an app in the host browser.
- Each sandbox starts from the local default branch as it was at creation. Nothing is fetched, so `git pull` first. Inside, `origin` is your repository, so the agent can `git fetch origin` to pick up newer commits.
- Reopening a closed window restarts the agent; the clone and its commits persist until `box remove`.

## Test before real work

```bash
bash -n ~/.local/bin/dev ~/.local/bin/box
cd /path/to/a/disposable/git/repo
box config
box new demo
box list
echo y | box remove demo
```
