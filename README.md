# dotfiles

Personal macOS setup. Each top-level directory is a [GNU Stow](https://www.gnu.org/software/stow/) package. `stow zsh` symlinks `zsh/.zshrc` to `~/.zshrc`, `stow mise` symlinks `mise/.config/mise/config.toml` to `~/.config/mise/config.toml`, and so on. Editing the symlinked file edits the repo. That includes commands that rewrite their own config, like `mise use -g`, so check `git diff` after running them.

Most of this README covers **how tools get installed, which manager owns what, and what depends on what.** That's the part that's easy to forget and painful to break.

Other docs:
- `docs/python.md`: how uv, venvs and site-packages work
- `nvim/.config/nvim/README.md`: Neovim config layout and plugins
- `scripts/README.md`: the `box` / `dev` scripts and sbx agent sandboxes

---

## Who owns what

Every tool has exactly one owner. If you're not sure where something belongs, use this table.

| Owner | Manages | Manifest in this repo | Installs into |
|---|---|---|---|
| **Homebrew** | The base system: shell plugins, terminal, editor, stow, mise, everyday CLIs (rg, fd, fzf, jq), k8s CLIs (kubectl, helm, k9s, tilt), GUI apps, fonts | `Brewfile` | `/opt/homebrew` |
| **mise** | Language runtimes other than Python and Rust (Node, Go), standalone dev CLIs (herdr, pi, uv), and the **list** of global CLIs from language package registries (`pypi:`, `npm:`, `go:`, `cargo:` entries) | `mise/.config/mise/config.toml` (global), `mise.toml` per project | `~/.local/share/mise/installs` |
| **uv** | Everything Python: interpreters, virtual environments, project dependencies. Also the engine behind mise's `pypi:` entries. | `uv/.config/uv/.python-version` (global default), and per project `.python-version` + `pyproject.toml` + `uv.lock` | `~/.local/share/uv/` |
| **Mason** (in Neovim) | Editor tooling only: LSP servers, formatters, linters | `nvim/.config/nvim/lua/eli/plugins/mason.lua` | `~/.local/share/nvim/mason` |
| **rustup** | The Rust toolchain (rustc, cargo, clippy, rustfmt, and rust-analyzer as a component, so it always matches the compiler). `~/.cargo/bin` holds rustup's proxies, which forward to the active toolchain. Rust CLIs (cargo-expand, wr) are `cargo:` entries in the mise config, not plain `cargo install` | none: its own installer | `~/.rustup`, `~/.cargo` |
| **elan** | The Lean toolchain | none: its own installer | `~/.elan` |

## Installing something new

Go down this list and stop at the first match:

| If it's… | Install with | Then record it in |
|---|---|---|
| A GUI app or font | `brew install --cask <name>` | `Brewfile` (`cask "<name>"`) |
| Only used by Neovim (LSP server, formatter, linter) | `:MasonInstall <name>` | `ensure_installed` in `mason.lua`, plus `vim.lsp.enable` in `lspconfig.lua` for a server |
| A dependency of one project (a library, or a tool only that repo uses) | the project's own manager: `uv add`, `npm install`, `go get`, `cargo add` | that project's files |
| A specific version that one project needs (Node 24, kubectl matching a cluster) | `mise use <tool>@<version>` inside the project | the project's `mise.toml` (`mise use` writes it) |
| A language runtime you want everywhere (Node, Go) | `mise use -g <tool>` | global mise config (`mise use -g` writes it into this repo) |
| A CLI published on a language registry: PyPI, npm, Go modules, crates.io (e.g. `httpie`, `pre-commit`) | `mise use -g pypi:<pkg>` (or `npm:` / `go:` / `cargo:`) | global mise config, written automatically |
| Any other CLI where the latest version is fine (rg, jq, gh, kubectl, helm) | `brew install <name>` | `Brewfile` |
| Python itself | `uv python install <ver>`, `uv python pin` | `.python-version` (project) or `uv/.config/uv/.python-version` (global) |
| Rust or Lean toolchain | `rustup` / `elan` | the setup steps below |

Notes:
- **Never pin `python` in a `mise.toml`.** uv owns Python versions; two pins drift apart.
- **`pypi:` entries in mise are installed by uv** (`uv tool install` under the hood), each in its own venv, on uv's global default Python. mise just keeps the list, so `mise install` restores them on a new machine and `mise upgrade` updates them.
- **k8s CLIs stay in brew** because the clusters here are local, so the latest version is right. If a remote cluster lags behind, pin `kubectl` (and maybe `helm`) in that project's `mise.toml`. kubectl only supports clusters within one minor version.
- **After any install, run `git diff`.** If nothing changed, nothing recorded it, and a new machine won't get it.

## How the managers depend on each other

```
Homebrew
 └── mise ─────────────── (brew "mise")
      ├── node (global) ── Mason's npm packages run on it
      ├── go (global) ──── gopls runs `go` to load projects
      └── uv ───────────── Python interpreters, venvs, tools
                            └── global python3, which Mason builds its pypi packages with
Mason (inside Neovim)
 ├── npm packages ─── need `node` on PATH at **runtime**
 ├── pypi packages ── need `python3` on PATH at **install time**, then stay tied to that interpreter
 ├── go packages ──── need `go` at install time
 └── binaries ─────── need nothing
```

### Mason's hidden runtime dependencies

Mason downloads tools, but many of them aren't standalone binaries. Here's what each package needs:

| Package | Kind | Needs |
|---|---|---|
| pyright, prettier, eslint_d, typescript-language-server, bash-language-server, css-lsp | npm | **`node` every time it runs.** These are scripts starting `#!/usr/bin/env node`. |
| clang-format | pypi | A `python3` when installed. Mason builds a venv on top of whatever `python3` was first on PATH, and the tool breaks if that interpreter is deleted. |
| gopls | go | `go` on PATH: it runs `go` to load projects (global Go from mise) |
| ruff, stylua, shfmt, clangd, lua-language-server, docker-language-server, superhtml | native binary | nothing |

**Why global Node lives in mise.** Neovim starts its language servers using whatever is on its PATH. Node is a language runtime, and mise owns runtimes, so a global `node = "lts"` in the mise config is the one place Node comes from. Inside a project with its own `mise.toml`, the project's Node takes over, and Mason's tools run on it too. That's normally fine. If a project pins a very old Node and pyright or prettier start failing, that's the cause. Installing Node through brew as well would give you two Node installs to keep straight, for no gain.

The mise config has a comment next to `node` for this reason: removing it silently breaks those language servers.

**`lts` moves.** Each October a new Node line becomes LTS, and mise starts reading `lts` as the new version. Until you run `mise install`, every shell shows `mise WARN missing: node@NN` and global Node is inactive, which breaks the Mason tools above. Run `mise install` when you see that warning. Older versions stay installed for projects that pin them; `mise prune` removes ones no config uses.

**Python for Mason.** Mason's pypi packages are built into a venv on top of whatever `python3` was first on PATH at install time, and they break if that interpreter is later deleted. With uv's global Python installed, that's always uv's Python, and patch upgrades are safe. If a project venv or an old brew Python was first on PATH during an install, the tool will eventually fail with `bad interpreter`. Reinstall it in `:Mason` to fix that.

Mason also checks a package's supported Python range. If `python3` is too new, it looks for versioned names from a **hardcoded list that stops at `python3.12`**, and fails if it finds none. When a pypi package won't install because the global Python is too new, either find a non-Python alternative or `uv python install 3.12` (without `--default`) so Mason finds `python3.12`.

---

## Python

uv owns everything Python: interpreters, venvs, dependencies and Python CLIs. mise only installs the `uv` program. **Never pin `python` in a `mise.toml`.** How it all works (venvs, `sys.path`, site-packages, editable installs, the cache) is explained in **[docs/python.md](docs/python.md)**.

Quick reference:

```sh
uv init [--package]      # new project: pyproject.toml, .python-version, .gitignore, git repo
uv add httpx             # add a dependency → pyproject.toml + uv.lock + .venv
uv add --dev pytest      # dev-only dependency
uv run pytest            # run inside the project env (syncs first; no activation needed)
uv sync                  # make .venv match uv.lock exactly (after clone/pull)
uv lock --upgrade        # move to newer versions (or --upgrade-package pkg)
uv python pin 3.15       # change the project's Python, then uv sync
mise use -g pypi:<pkg>   # global Python CLI: recorded in the mise config, installed by uv
uvx <pkg>                # run a Python CLI once without installing
```

Commit `pyproject.toml`, `uv.lock` and `.python-version`. `.venv` is disposable.

**uv doesn't change your shell.** mise switches `node` on PATH as you `cd`, but uv's pin only applies to commands run through uv. In a project, use `uv run python`, or `source .venv/bin/activate`, to get the project's Python.

**Global Python is two separate settings. Keep them on the same version:**
- **`python` / `python3` on PATH:** set by `uv python install --default 3.14`, which links them into `~/.local/bin`. Plain `python3` and Mason's pypi tools use this. (As of uv 0.13, `--default` is marked experimental and prints a warning, but it works.)
- **uv's own default:** set by `uv/.config/uv/.python-version` (`3.14`, stowed to `~/.config/uv/`). It's what `uv tool install`, mise's `pypi:` entries and `uv run` outside a project use. Without it, uv picks the **newest** installed Python, even a brand-new release that packages don't support yet.

To move to a new version later, change both: run `uv python install --default 3.15` and edit the pin file.

---

## Shell startup files

All three are in the `zsh/` stow package.

| File | Runs for | Holds |
|---|---|---|
| `.zshenv` | every zsh, including scripts | rustup's `~/.cargo/env`, so `cargo` works even in non-interactive shells |
| `.zprofile` | login shells (every Ghostty window and tmux pane) | `brew shellenv`, `HOMEBREW_BUNDLE_FILE` (so `brew bundle` finds this Brewfile from any directory), JetBrains Toolbox and elan on PATH |
| `.zshrc` | interactive shells | `~/.local/bin` first on PATH, prompt, plugins, `mise activate` |

**Machine-local settings** go in `~/.zshrc.local`. `.zshrc` sources it last, and it lives outside the repo (`.gitignore` also ignores `*.local` and `.env*` as a safety net). Use it for settings that aren't secret. **Secrets** belong in 1Password, not in plain-text files: keep a `.env.1password` file of `op://…` references and run commands with `op run --env-file=.env.1password -- <cmd>`, so a secret is fetched only for the command that needs it. Anything exported from a shell file reaches every program started from that shell, coding agents included.

Installers like to append lines to these files (rustup, JetBrains Toolbox, pipx). Because they're symlinks into the repo, those edits show up in `git diff`. Move each new line into the right file, or drop it.

---

## Setting up a new machine

1. Install Homebrew, clone this repo to `~/dotfiles`.
2. `brew bundle --file ~/dotfiles/Brewfile`
3. `cd ~/dotfiles && stow zsh mise uv nvim tmux ghostty scripts ...` (every top-level directory except `docs/`)
4. Open a new shell (`mise activate` runs from `.zshrc`), then `mise install`. This installs global node, go, uv, herdr, pi, and any `pypi:` / `npm:` CLIs in the config.
5. `uv python install --default 3.14` (global Python, and the base for Mason's pypi tools).
6. Install rustup (https://rustup.rs), then `rustup component add rust-analyzer`, then `mise install` again so the `cargo:` CLIs (cargo-expand, and workshop-runner, which provides `wr`) build now that cargo exists. Install elan if needed.
7. Open `nvim` once. mason-tool-installer installs everything in `ensure_installed` in the background. Check with `:Mason`.

The order matters: Mason (step 7) needs node, go and python3 from steps 4 and 5 to already be there.
