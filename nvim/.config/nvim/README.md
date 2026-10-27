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

## Why this structure

- Single install manifest is easier to audit.
- Setup modules are smaller and focused.
- LSP merge behavior is explicit (`*` defaults + `lsp/<server>.lua` + enable list).
- Order-dependent setup is kept in one orchestration file.

## Common updates

- Add a plugin: edit `lua/eli/plugins/install.lua`, then configure it in `lua/eli/plugins/<name>.lua`, and require it from `lua/eli/plugins/configure.lua`.
- Add server custom settings: create `lsp/<server>.lua`.
- Enable/disable LSP servers: update the list in `lua/eli/plugins/lspconfig.lua`.

