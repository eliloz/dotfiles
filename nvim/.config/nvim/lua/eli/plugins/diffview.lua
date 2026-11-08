local actions = require("diffview.actions")

-- In diffview buffers, <leader>fe toggles the file panel instead of nvim-tree.
-- These maps are buffer-local, so the global nvim-tree mapping is untouched elsewhere.
local toggle_files = { "n", "<leader>fe", actions.toggle_files, { desc = "Diffview: toggle file panel" } }

require("diffview").setup({
	keymaps = {
		view = { toggle_files },
		file_panel = { toggle_files },
	},
})
