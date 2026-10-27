require("eli.plugins.fzf-lua")
require("eli.plugins.nvim-tree")
require("eli.plugins.treesitter")
require("eli.plugins.mason")
require("eli.plugins.lazydev")

-- Blink must run before LSP defaults/enable so capabilities are available.
require("eli.plugins.blink")
require("eli.lsp.defaults")

require("eli.plugins.lspconfig")
require("eli.plugins.which-key")
require("eli.plugins.formatting")
require("eli.plugins.linting")
require("eli.plugins.autopairs")
require("eli.plugins.lualine")
require("eli.plugins.gitsigns")

