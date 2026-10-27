# Neovim Keymaps Reference


- Leader: `<Space>`
- Scope notes:
  - `LSP` maps are buffer-local and appear when an LSP attaches.
  - Text-file wrap maps (`j`/`k`) are buffer-local in `text` ftplugin.
  - Normal yank/paste uses the system clipboard because `clipboard` includes `unnamedplus`.

## Canonical Tree (Leader)

```text
<leader>
├── s  (search)
│   └── c   clear search highlights
├── f  (find)
│   ├── f   files
│   ├── g   live grep
│   ├── b   buffers
│   ├── h   help tags
│   └── e   file explorer toggle
├── b  (buffers)
│   ├── n   next buffer
│   └── p   previous buffer
├── w  (windows)
│   ├── h   move left
│   ├── j   move down
│   ├── k   move up
│   ├── l   move right
│   ├── v   split vertically
│   └── s   split horizontally
├── d  (diagnostics)
│   ├── d   line diagnostics float
│   ├── b   buffer diagnostics list (fzf)
│   └── w   workspace diagnostics list (fzf)
├── l  (LSP actions)
│   ├── a   code actions
│   ├── r   rename symbol
│   ├── R   restart LSP
│   └── i   organize imports
├── m  (maintenance)
│   └── f   format file/range
└── y  (yank helpers)
    └── p   copy full file path
```

## Canonical Leader Keymaps

| Key | Action | Source |
|---|---|---|
| `<leader>sc` | Clear search highlights | `lua/eli/core/keymaps.lua` |
| `<leader>ff` | Find files | `lua/eli/plugins/fzf-lua.lua` |
| `<leader>fg` | Live grep | `lua/eli/plugins/fzf-lua.lua` |
| `<leader>fb` | Find buffers | `lua/eli/plugins/fzf-lua.lua` |
| `<leader>fh` | Help tags (opens in vertical split) | `lua/eli/plugins/fzf-lua.lua` |
| `<leader>fe` | Toggle file explorer | `lua/eli/plugins/nvim-tree.lua` |
| `<leader>bn` | Next buffer | `lua/eli/core/keymaps.lua` |
| `<leader>bp` | Previous buffer | `lua/eli/core/keymaps.lua` |
| `<leader>wh` | Move to left window | `lua/eli/core/keymaps.lua` |
| `<leader>wj` | Move to bottom window | `lua/eli/core/keymaps.lua` |
| `<leader>wk` | Move to top window | `lua/eli/core/keymaps.lua` |
| `<leader>wl` | Move to right window | `lua/eli/core/keymaps.lua` |
| `<leader>wv` | Vertical split | `lua/eli/core/keymaps.lua` |
| `<leader>ws` | Horizontal split | `lua/eli/core/keymaps.lua` |
| `<leader>dd` | Show line diagnostics | `lua/eli/plugins/lspconfig.lua` |
| `<leader>db` | Buffer diagnostics list (fzf) | `lua/eli/plugins/fzf-lua.lua` |
| `<leader>dw` | Workspace diagnostics list (fzf) | `lua/eli/plugins/fzf-lua.lua` |
| `<leader>la` | LSP code actions | `lua/eli/plugins/lspconfig.lua` |
| `<leader>lr` | LSP rename | `lua/eli/plugins/lspconfig.lua` |
| `<leader>lR` | LSP restart | `lua/eli/plugins/lspconfig.lua` |
| `<leader>li` | Organize imports (if supported) | `lua/eli/plugins/lspconfig.lua` |
| `<leader>mf` | Format file/range | `lua/eli/plugins/formatting.lua` |
| `<leader>yp` | Copy current file path | `lua/eli/core/keymaps.lua` |


## Non-Leader Keymaps

### LSP navigation (buffer-local on attach)

| Key | Action |
|---|---|
| `gd` | Show definitions (fzf) |
| `gD` | Go to declaration |
| `gR` | Show references (fzf) |
| `gi` | Show implementations (fzf) |
| `gt` | Show type definitions (fzf) |
| `K` | Hover docs |
| `<C-k>` (insert) | Signature help |

### Search and movement quality-of-life

| Key | Action |
|---|---|
| `n` | Next search result (centered) |
| `N` | Previous search result (centered) |
| `<C-d>` | Half-page down (centered) |
| `<C-u>` | Half-page up (centered) |

### Editing helpers

| Key | Mode | Action |
|---|---|---|
| `J` | Normal | Join lines and keep cursor anchor |
| `J` / `K` | Visual | Move selected lines down / up |
| `<` / `>` | Visual | Reindent and keep selection |
| `<leader>p` | Visual | Paste without yanking replaced text |
| `<leader>x` | Normal/Visual | Delete without yanking |

### Clipboard behavior

Because `lua/eli/core/options.lua` enables `clipboard=unnamedplus`, standard Vim yanks already target the system clipboard.

| Key | Mode | Action |
|---|---|---|
| `y` + motion | Normal | Yank to system clipboard using a motion/text object (e.g. `yiw`, `y$`) |
| `yy` / `Y` | Normal | Yank current line to system clipboard |
| `y` | Visual | Yank selection to system clipboard |

### Register cheat sheet

| Register | Meaning | What it is useful for |
|---|---|---|
| `"` | Unnamed/default register | What normal `y`, `d`, `c`, `p` use by default |
| `+` | System clipboard | Copy/paste with other macOS apps |
| `0` | Last yank register | Recover the most recent yank after deletes/change operations |
| `1`-`9` | Delete history registers | Older deletes, with `1` being the most recent big delete |
| `a`-`z` | Named registers | Save text intentionally without it being replaced by later edits |
| `_` | Black hole register | Delete/change text without overwriting clipboard/register contents |

### How `unnamedplus` changes things here

In this config, the unnamed register is effectively wired to the system clipboard most of the time.

That means:
- normal `y`, `yy`, `Y`, and visual `y` copy to the macOS clipboard
- normal `p` / `P` paste from what you most recently copied
- normal `d`, `c`, and similar operations can also overwrite what you copied unless you send them to `"_`

### Common scenarios

#### 1. Normal yank

Examples:
- `yiw` → yank inner word
- `y$` → yank to end of line
- `yy` → yank current line

In this config, those yanks go to:
- unnamed register `"`
- system clipboard `+`
- yank register `0`

Useful checks:

```vim
:reg " + 0
```

#### 2. Visual yank

Examples:
- `viw` then `y`
- `V` then `y`

This copies the selection into the unnamed register and, because of `unnamedplus`, also to the system clipboard.

#### 3. Normal delete/change

Examples:
- `dw`
- `di"`
- `cc`

These are not pure yanks. They usually affect the unnamed register and can overwrite what you previously copied.

Useful checks after a delete:

```vim
:reg " 1 0
```

Typical meaning:
- `"` now contains the deleted text
- `1` often contains the most recent delete
- `0` still contains the most recent yank

#### 4. Delete without overwriting clipboard: `<leader>x`

Your mapping in `lua/eli/core/keymaps.lua` is:

```lua
map({ "n", "v" }, "<leader>x", '"_d', { desc = "Delete without yanking" })
```

Examples:
- `<leader>xiw` → delete inner word without touching clipboard
- visual select then `<leader>x` → delete selection without touching clipboard

This sends the deleted text to the black hole register `"_`, so your last copied text stays available for paste.

#### 5. Replace selection without overwriting clipboard: `<leader>p`

Your mapping is:

```lua
map("x", "<leader>p", '"_dP', { desc = "Paste without yanking" })
```

Typical flow:
1. yank something you want to keep
2. visually select some other text
3. press `<leader>p`

Result:
- selected text is deleted into `"_`
- your previously yanked text is pasted
- clipboard is preserved instead of being replaced by the deleted selection

#### 6. Save something explicitly in a named register

Examples:
- `"ayy` → yank current line into register `a`
- `"byiw` → yank inner word into register `b`
- `"ap` → paste from register `a`

This is useful when you want to keep one snippet around while continuing to delete, change, and yank other text.

#### 7. Recover the last real yank after deletes

If you yanked something, then deleted other text, `0` is often your friend:

```vim
"0p
```

That pastes from the yank register even if the unnamed register was later changed by deletes.

### Register inspection commands

| Command | What it shows |
|---|---|
| `:reg` | All useful registers |
| `:reg "` | Unnamed register |
| `:reg +` | System clipboard register |
| `:reg 0` | Last yank |
| `:reg 1` | Most recent delete |
| `:reg a` | Named register `a` |
| `:echo getregtype('"')` | Whether the register is characterwise, linewise, or blockwise |

Register types:
- `v` = characterwise
- `V` = linewise
- blockwise = visual block selections

### Text ftplugin (`after/ftplugin/text.lua`)

| Key | Action |
|---|---|
| `j` | Wrapped-line down (`gj`) unless count provided |
| `k` | Wrapped-line up (`gk`) unless count provided |


## Search / Help Workflow

### Using `<leader>fh` (Help Tags)
- Press `<leader>fh` to open searchable docs index
- Type to filter (e.g., `autocmd`, `checktime`, `lsp`, `diagnostic`)
- Move selection with arrow keys or `Ctrl-j` / `Ctrl-k`
- Press `Enter` to open selected topic in vertical split
- Press `Esc` / `Ctrl-c` to close picker without opening
- In help window:
  - Read normally with motion keys
  - `Ctrl-]` jumps to tag under cursor
  - `Ctrl-o` goes back (like browser back button)
  - `:q` closes help window
  - `Ctrl-w p` or `Ctrl-w w` switches to previous/next window

### Quick investigate pattern
1. `<leader>fg` → search for symbol
2. `Enter` on best match
3. `gR` for references / `gd` for definition
4. `<leader>dd` for diagnostics on cursor
5. `:q` to close help or splits when done

## Learning Path (Quick)

1. Drill windows: `<leader>w{h,j,k,l,v,s}`
2. Drill diagnostics: `<leader>d{d,b,w}`
3. Drill LSP actions: `<leader>l{a,r,R,i}`
4. Keep find keys daily: `<leader>f{f,g,b,h,e}`

## Helpful Introspection Commands

```vim
:map <leader>
:nmap <leader>w
:nmap <leader>d
:nmap <leader>l
:verbose map <leader>dd
:autocmd eli.core.checktime
:autocmd eli.core.yank
:checktime
```

### Register practice drill (3 minutes)

Use this sample text in a scratch buffer:

```text
alpha beta gamma
one two three
keep this text
```

1. **Normal yank**
   - Put cursor on `beta`
   - Press `yiw`
   - Run `:reg " + 0`
   - You should see `beta` in the unnamed register, system clipboard, and yank register `0`

2. **Visual yank**
   - Select `two` with `viw`
   - Press `y`
   - Run `:reg " + 0`
   - The selected text should now be in those yank-related registers

3. **See a normal delete overwrite the unnamed register**
   - Put cursor on `gamma`
   - Press `diw`
   - Run `:reg " 0 1`
   - `"` should now reflect the delete, while `0` still holds your last real yank

4. **Use the black hole delete with `<leader>x`**
   - Yank `keep` with `yiw`
   - Move to `three`
   - Press `<leader>xiw`
   - Run `:reg " + 0`
   - Your clipboard/yank should still contain `keep`

5. **Replace without clobbering clipboard using `<leader>p`**
   - Yank `alpha` with `yiw`
   - Visually select `one`
   - Press `<leader>p`
   - Run `:reg " + 0`
   - `alpha` should still be what you can paste

6. **Use a named register intentionally**
   - Put cursor on `keep this text`
   - Press `"ayy`
   - Move somewhere else and press `"ap`
   - You should paste from register `a`

7. **Recover the last yank explicitly**
   - After a delete, press `"0p`
   - This pastes from yank register `0`, even if `"` changed

