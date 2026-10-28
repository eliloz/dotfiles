# dev + wt

A small Bash CLI for Git-project tmux sessions and isolated agent worktrees.

## Layout

This is a [GNU Stow](https://www.gnu.org/software/stow/) package. The scripts live at `scripts/.local/bin/` so that stowing links them into `~/.local/bin/`. Stow ignores this top-level `README.md`, so it is not linked into `~`.

## Requirements

macOS or Linux, Bash, Git, tmux, Neovim, and Claude Code (or Pi for `--agent pi`). `dev` and `wt` are standalone executable scripts; they do not require tmuxinator.

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

`~/.local/bin` is added to `PATH` by the tracked `zsh/.zshrc`. Optionally configure a machine-specific root in `~/.zshrc.local`:

```bash
export WT_ROOT="$HOME/code/worktrees"
```

If `WT_ROOT` is unset, the default is a `worktrees` directory alongside your primary checkout's parent directory. `WT_BASE_DIR` is a legacy fallback.

## Commands

| Command | Action |
|---|---|
| `dev` | Create or switch to a project tmux session with editor and terminal windows |
| `wt config` | Print project, worktree root, and tmux session settings |
| `wt list` | Show registered Git worktrees |
| `wt new gateway` | Create a branch and worktree **without launching tmux or Claude** |
| `wt open gateway` | Open an existing worktree with Neovim and Claude side by side |
| `wt gateway` | Create if missing, then open; repeat to return to the existing task window |
| `wt gateway --agent pi` | Use Pi for a newly opened task window |
| `wt remove gateway` | Remove clean worktree directory; **keep** branch and print cleanup commands |

The `wt` commands must be run inside a Git repository (including one of its linked worktrees). `wt new`, `wt list`, `wt config`, and `wt remove` do not require an active tmux client. Opening a task requires an active tmux client.

## Example lifecycle

```bash
cd ~/code/project
git pull                    # wt branches from local main, so update it first
dev                         # creates/attaches tmux project session
wt gateway                  # creates feature/gateway from main, opens task window
# ... edit, test, commit in the gateway worktree ...
git push -u origin feature/gateway   # first push sets the upstream; then plain git push

cd ~/code/project           # main checkout, on main
git merge feature/gateway
git push

# Close the gateway tmux window (Ctrl-b &) before removal.
wt remove gateway
git push origin --delete feature/gateway   # remote first...
git branch -d feature/gateway              # ...so -d checks against main, not the old remote copy
```

Or create without opening:

```bash
wt new sdk
wt open sdk
```

Worktrees are created under `$WT_ROOT/<project>/<task>` and branches are named `feature/<task>`. Git shares history and objects between worktrees, but each worktree has its own checked-out files. `git worktree remove` deletes the task directory; the parent project directory is removed only if empty.

## Safety and behavior

- Rejects invalid task names and existing unrelated directories.
- Does not silently reuse an existing branch for a new task.
- `wt new` refuses duplicate creation; `wt <task>` reuses registered worktrees.
- Removal refuses dirty worktrees, including untracked files, and requires confirmation.
- Removal refuses while the corresponding tmux task window exists; close it first.
- Removal never deletes branches; `wt remove` prints the commands to delete the remote and local branch yourself.
- Worktrees are **not** security sandboxes; Claude/Pi still run with their normal permissions.
- This version expects conventional Git layouts with a `.git` directory in the primary checkout. Worktrees created elsewhere or moved after changing `WT_ROOT` are visible to `wt list`, but the named open/remove operations expect the configured path.
- New branches start from the **local** default branch (named by `origin/HEAD` when set, else `main`, else `master`). What the main checkout has checked out does not matter. Nothing is fetched, so `git pull` first if `main` may have moved elsewhere.
- New branches have no upstream until the first `git push -u origin feature/<task>`.
- An already-running agent process is not automatically changed if you reopen its tmux window with a different `--agent` value.

## Test before real work

```bash
bash -n ~/.local/bin/dev ~/.local/bin/wt
cd /path/to/a/disposable/git/repo
wt config
wt new demo
wt list
wt remove demo
# Optionally: git branch -d feature/demo (if safely merged)
```

These scripts require end-to-end testing with your local tmux/Neovim/Claude installation.
