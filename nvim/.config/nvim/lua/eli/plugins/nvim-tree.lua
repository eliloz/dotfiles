
require("nvim-tree").setup({
	view = {
		width = 35,
	},
	filters = {
		dotfiles = false,
	},
	renderer = {
		group_empty = true,
	},
  git = {
    ignore = false,
  },
})

local function toggle_tree()
	require("nvim-tree.api").tree.toggle({
    find_file = true
  })

end

-- Find / file explorer (canonical)
vim.keymap.set("n", "<leader>fe", toggle_tree, { desc = "Find: toggle file explorer" })

