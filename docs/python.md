# Python with uv: how it works

How uv, interpreters, virtual environments and site-packages fit together. This explains the model. For which tool owns what on this machine, see the [top-level README](../README.md#python).

Examples use `~/code/ai/agent-from-scratch`, a uv-managed package.

## What uv is

uv does the jobs that pyenv, venv, pip, pip-tools, pipx and poetry used to split between them:

| Job | Old tool | uv |
|---|---|---|
| Install Python interpreters | pyenv, mise, brew | `uv python install` |
| Pin a project's Python version | `.python-version` / `mise.toml` | `uv python pin` → `.python-version` |
| Create a virtual environment | `python -m venv` | automatic (`.venv`) |
| Add or install dependencies | pip, poetry | `uv add`, `uv sync` |
| Lock exact versions | pip-tools, poetry.lock | `uv.lock` |
| Run in the env | `source .venv/bin/activate` | `uv run <cmd>` |
| Install a global Python CLI | pipx | `uv tool install` (in this setup, listed as `pypi:` entries in mise, which run `uv tool install` for you) |
| Run a CLI once without installing it | pipx run | `uvx <tool>` |

mise installs the `uv` program and does nothing else with Python.

## What happens in a new project

```sh
mkdir myproj && cd myproj
uv init                  # or: uv init --package  (src/ layout, installable)
uv add httpx
uv run python -c "import httpx"
```

1. **`uv init`** writes:
   - `pyproject.toml`: the project's name, `requires-python`, and dependency list.
   - `.python-version`: the exact minor version for this project, such as `3.14`. Same role as a `mise.toml` pin, but read by uv.
   - a starter `main.py` (or `src/<pkg>/` with `--package`), `README.md`, `.gitignore`, and a git repo.
2. **`uv add httpx`**:
   - adds `httpx` to `pyproject.toml`.
   - **resolves** the full dependency tree and writes exact versions and hashes to **`uv.lock`** (commit this; it makes installs reproducible).
   - finds a Python matching `.python-version`. It prefers ones uv has installed, and **downloads one automatically** if none fits.
   - creates **`.venv/`** if missing, on top of that interpreter.
   - installs the locked packages into `.venv`, cloning them from the cache. With `--package`, it also installs your own code in editable mode.
3. **`uv run …`** checks that `uv.lock` and `.venv` are up to date with `pyproject.toml` (fixing them if not), then runs the command with `.venv/bin` first on PATH.

## Does uv track Python versions like mise does?

Mostly, but it applies them differently.

| | mise (Node, etc.) | uv (Python) |
|---|---|---|
| Per-project pin | `mise.toml` | `.python-version` (plus `requires-python` in `pyproject.toml` as the allowed range) |
| Global default | `mise use -g node@lts` | `uv python pin --global 3.14` (writes `~/.config/uv/.python-version`) |
| Where installs live | `~/.local/share/mise/installs/` | `~/.local/share/uv/python/` |
| List installed | `mise ls` | `uv python list --only-installed` |
| Upgrade | `mise upgrade` | `uv python upgrade` (patch releases) |
| **How the pin takes effect** | mise **changes your shell's PATH** when you `cd`, so plain `node` is the right version | uv **doesn't touch your shell**. The pin applies when you go through uv (`uv run`, `uv sync`, `uv add`) |

The last row is the important one. In a uv project, typing plain `python3` gives you Apple's `/usr/bin/python3` (3.9), not the project's Python, and plain `python` doesn't exist at all. Use `uv run python`, or activate the venv (`source .venv/bin/activate`) if you want a shell where `python` means the project's.

**Patch upgrades don't break venvs.** uv installs `cpython-3.14.10-...` and adds a symlink `cpython-3.14-...` pointing at it. Venvs reference the symlink, the one without the patch number (see `home` in `.venv/pyvenv.cfg`). When `uv python upgrade` moves to 3.14.11, the symlink moves and every existing venv picks it up.

## How virtual environments work

A virtual environment is just a folder. Here's `agent-from-scratch/.venv`:

```
.venv/
├── pyvenv.cfg              ← home = ~/.local/share/uv/python/cpython-3.14-.../bin
│                             include-system-site-packages = false
├── bin/
│   ├── python → ~/.local/share/uv/python/cpython-3.14-.../bin/python3.14   (symlink)
│   ├── activate            ← changes PATH and sets $VIRTUAL_ENV, nothing more
│   └── pytest, ipython ... ← entry-point scripts for installed packages
└── lib/python3.14/site-packages/   ← the project's installed packages
```

There's no copy of Python inside it. `bin/python` is a **symlink to the shared interpreter** uv installed, and `.venv/lib/python3.14/` contains only `site-packages`, not a standard library. Here's how a symlink becomes an isolated environment.

`pyvenv.cfg` **doesn't list any import paths**. What matters is mainly *where the file is*:

1. You run `.venv/bin/python`. Before running any code, Python checks for a `pyvenv.cfg` in the executable's folder or the one above, and finds `.venv/pyvenv.cfg`.
2. Finding it sets two variables:
   - `sys.prefix` = **the folder containing `pyvenv.cfg`** → `.venv` ("this is my environment")
   - `sys.base_prefix` = the real install, from the **`home`** line → `~/.local/share/uv/python/cpython-3.14.10-…` ("this is where my standard library lives")

   Without a venv, both point at the interpreter's own folder. Making them differ is all a venv is.
3. Python fills in `sys.path` (the folders `import` searches) using the standard layout, **taking each half from a different place**:

   | Part | Comes from | In agent-from-scratch |
   |---|---|---|
   | Standard library (`os`, `json`, …) | `<base_prefix>/lib/python3.14/` | the shared uv interpreter |
   | Third-party packages | `<prefix>/lib/python3.14/site-packages/` | `.venv/lib/python3.14/site-packages/` |

4. `include-system-site-packages = false` is the one setting in the file that affects imports. It keeps the **interpreter's** site-packages (`<base_prefix>/lib/python3.14/site-packages`) out of `sys.path`. If it were `true`, that folder would be searched as well.
5. The `site` module reads every `.pth` file in the venv's site-packages and adds each line in it to `sys.path` (see [Your own code](#your-own-code-editable-installs)).

The other lines in `pyvenv.cfg` (`implementation`, `uv`, `version_info`, `prompt`) are informational. `prompt` is the `(agent-from-scratch)` label shown when the venv is activated.

Real `sys.path` inside agent-from-scratch (`uv run python -c "import sys; print(sys.path)"`):

```
…/uv/python/cpython-3.14.10-…/lib/python3.14              ← stdlib (base_prefix)
…/uv/python/cpython-3.14.10-…/lib/python3.14/lib-dynload  ← stdlib C extensions (base_prefix)
…/agent-from-scratch/.venv/lib/python3.14/site-packages   ← packages (prefix)
…/agent-from-scratch/src                                  ← your code, added by a .pth file
```

**Activating** (`source .venv/bin/activate`) puts `.venv/bin` first on PATH so `python` resolves to the venv's symlink, and sets `$VIRTUAL_ENV`. That's all it does. `uv run` does the same thing for a single command.

## Your own code: editable installs

agent-from-scratch is a **package**: `pyproject.toml` names a build backend (`uv_build`) and a module (`agent_lab`, in `src/agent_lab/`). uv installs your own project into `.venv` in **editable** mode. Your code is **not copied** into site-packages. Instead, uv writes a one-line pointer file:

```
.venv/lib/python3.14/site-packages/agent_from_scratch.pth
  → ~/code/ai/agent-from-scratch/src
```

plus an `agent_from_scratch-0.1.0.dist-info/` folder of metadata so uv and pip know it's installed. At startup, the `.pth` line is added to `sys.path`, so:

```
import agent_lab  →  …/agent-from-scratch/src/agent_lab/__init__.py       (your live source)
import pydantic   →  …/.venv/lib/python3.14/site-packages/pydantic/...     (installed copy)
```

`import agent_lab` works from tests, notebooks and examples anywhere in the project, and edits take effect immediately with no reinstall.

## Where installs go (and where they never go)

Packages **always** go into the project's `.venv`, and **never** into the uv interpreter. Every project on 3.14 shares that one interpreter, so anything installed there would leak into all of them. uv enforces this: the interpreter is marked `EXTERNALLY-MANAGED`, and `pip install` into it is refused.

## What site-packages is, and where packages go

`site-packages` is the folder where **third-party packages are installed**: anything that isn't part of Python's standard library. When you `import httpx`, Python walks `sys.path`, and one of its entries is a site-packages folder containing `httpx/`.

Every Python install has one, and each venv has its own:

| Location | What's in it | Who writes to it |
|---|---|---|
| `<project>/.venv/lib/python3.X/site-packages/` | That project's dependencies, plus a `.pth` file pointing at your own source code if the project is a package | `uv sync` / `uv add` |
| `~/.local/share/uv/python/cpython-3.X-.../lib/python3.X/site-packages/` | The interpreter's own (just `pip`) | Nobody. uv marks it `EXTERNALLY-MANAGED`, so `pip install` into it is refused. |
| `~/.local/share/uv/tools/<tool>/lib/.../site-packages/` | One `uv tool install` CLI and its deps, in a private venv | `uv tool install` |
| `~/.local/share/nvim/mason/packages/<pkg>/venv/...` | Mason's pypi tools, each in a private venv | Mason |
| `~/Library/Python/3.X/lib/python/site-packages/` | "user site" from `pip install --user` | Don't use this |

**The uv cache: why venvs are cheap.** uv downloads and unpacks each package version once into `~/.cache/uv` (check with `uv cache dir`). Installing into a venv then **clones** the files from the cache into `site-packages`. On macOS that's an APFS copy-on-write clone: instant, and it takes no extra disk space until a file changes. So deleting `.venv` and running `uv sync` again is fast and safe. `.venv` is disposable; `pyproject.toml` + `uv.lock` + `.python-version` are what matter. `uv cache prune` cleans up old entries.

## Python CLIs (global tools)

`uv tool install <pkg>` creates a private venv under `~/.local/share/uv/tools/<pkg>/` and links its commands into `~/.local/bin`, which is why that directory is on PATH. Each tool is isolated, so tools never fight over dependency versions. `uv tool list` shows them and `uv tool upgrade --all` updates them. For one-off use, `uvx <pkg>` runs it from the cache without installing.

In this setup, global Python CLIs are listed in the mise config as `"pypi:<pkg>" = "latest"` instead of installed by hand. mise runs `uv tool install` for each one (into `~/.local/share/mise/installs/pypi-<pkg>/`), so they get the same isolated venvs, plus a record in the repo. They use uv's global default Python, set in `~/.config/uv/.python-version`.
