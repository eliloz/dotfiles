# Neovim Config (0.12-focused)

This config is organized into two startup phases:

1. **Install phase**: declares plugin sources in one place.
2. **Configure phase**: applies plugin setup in a stable order.

This keeps ordering-sensitive behavior (especially LSP capabilities) predictable.

## Startup flow

`init.lua` loads:

1. `eli.core`
2. `eli.plugins`

`eli.plugins` then runs:

1. `lua/eli/plugins/install.lua`
2. `lua/eli/plugins/configure.lua`

## Plugin phases

### Install phase

- File: `lua/eli/plugins/install.lua`
- Responsibility: only `vim.pack.add({...})`
- No plugin setup logic here.

### Configure phase

- File: `lua/eli/plugins/configure.lua`
- Responsibility: `require(...)` setup modules in correct order.

Important order detail:

- `eli.plugins.blink` is loaded **before** LSP defaults + LSP enable, so completion capabilities are available when servers start.

## LSP layout

### Global defaults

- File: `lua/eli/lsp/defaults.lua`
- Uses:

```lua
vim.lsp.config("*", {
  capabilities = require("blink.cmp").get_lsp_capabilities(),
  root_markers = { ".git" },
})
```

### Server-specific runtime config

- File: `lsp/lua_ls.lua`
- This is merged by Neovim's runtimepath LSP config system (compatible with `nvim-lspconfig` defaults).

### Server enable list

- File: `lua/eli/plugins/lspconfig.lua`
- Keeps a single `vim.lsp.enable({...})` list to control what starts.

### Lua development

- File: `lua/eli/plugins/lazydev.lua`
- `lazydev.nvim` teaches `lua_ls` about the Neovim API (`vim.*`) and installed plugins, so editing this config gets real completion and type checking. It also feeds blink.cmp as a completion source.

## Tool installs (Mason)

- File: `lua/eli/plugins/mason.lua`
- `mason-tool-installer` keeps one `ensure_installed` list of LSP servers, formatters, and linters. On every startup it installs anything missing in the background, so a fresh machine only needs to open Neovim once.
- Check status with `:Mason`; force a run with `:MasonToolsInstall`.
- Runtimes are not managed here. Node-based tools (pyright, prettier, ts/bash servers, eslint_d) need a global `node` (set via `mise use -g node@lts`). `gopls` needs Go and `google-java-format` needs Java; pin those per project with mise and start `nvim` from inside the project.

## Linting and formatting

### Linting (`nvim-lint`)

- File: `lua/eli/plugins/linting.lua`
- Linters are listed per filetype in `linters_by_ft`.
- Linting runs automatically on:
  - `BufReadPost` → once when a file is opened
  - `BufWritePost` → after every save
  - `InsertLeave` → when you leave insert mode
- It deliberately does **not** run on `BufEnter`, so switching between open buffers stays fast even with slower linters.
- Results show up as normal diagnostics: signs in the sign column, `<leader>dd` for details on the current line, `<leader>db` / `<leader>dw` for lists.
- Run on demand: `:lua require("lint").try_lint()`.

### Formatting (`conform.nvim`)

- File: `lua/eli/plugins/formatting.lua`
- Formatters are listed per filetype in `formatters_by_ft`; files without one fall back to the LSP formatter.
- Formatting is manual: `<leader>mf` formats the file (or the Visual selection). There is no format-on-save.

## Git (`gitsigns.nvim`)

- File: `lua/eli/plugins/gitsigns.lua`
- Shows added/changed/deleted lines in the sign column for files in a git repo.
- Keymaps are buffer-local (set in `on_attach`), so they only exist in git-tracked files: `]h` / `[h` to move between changes, `<leader>g…` to preview, stage, reset, blame, and diff, and `ih` as a hunk text object.
- See `KEYMAPS.md` → "Git Workflow" for a step-by-step guide and practice drill.

## Why this structure

- Single install manifest is easier to audit.
- Setup modules are smaller and focused.
- LSP merge behavior is explicit (`*` defaults + `lsp/<server>.lua` + enable list).
- Order-dependent setup is kept in one orchestration file.

## Common updates

- Add a plugin: edit `lua/eli/plugins/install.lua`, then configure it in `lua/eli/plugins/<name>.lua`, and require it from `lua/eli/plugins/configure.lua`.
- Add server custom settings: create `lsp/<server>.lua`.
- Enable/disable LSP servers: update the list in `lua/eli/plugins/lspconfig.lua`.
- Add an LSP server, formatter, or linter binary: add its Mason package name to `ensure_installed` in `lua/eli/plugins/mason.lua`.
- Add a linter or formatter for a filetype: update `linters_by_ft` in `lua/eli/plugins/linting.lua` or `formatters_by_ft` in `lua/eli/plugins/formatting.lua`.

