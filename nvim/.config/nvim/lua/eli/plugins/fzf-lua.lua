
local fzf = require("fzf-lua")

fzf.setup({
  ui_select = true
})

-- Find
vim.keymap.set("n", "<leader>ff", fzf.files, { desc = "Find: files" })
vim.keymap.set("n", "<leader>fg", fzf.live_grep, { desc = "Find: live grep" })
vim.keymap.set("n", "<leader>fb", fzf.buffers, { desc = "Find: buffers" })
vim.keymap.set("n", "<leader>fh", fzf.help_tags, { desc = "Find: help tags" })

-- Diagnostics (canonical)
vim.keymap.set("n", "<leader>db", fzf.diagnostics_document, { desc = "Diagnostics: current buffer list" })
vim.keymap.set("n", "<leader>dw", fzf.diagnostics_workspace, { desc = "Diagnostics: workspace list" })

