local function on_attach(bufnr)
	local gitsigns = require("gitsigns")
	local function buffer_map(mode, lhs, rhs, desc)
		vim.keymap.set(mode, lhs, rhs, { buffer = bufnr, desc = desc })
	end
	local function visual_range()
		return { vim.fn.line("."), vim.fn.line("v") }
	end

	-- Hunk navigation
	buffer_map("n", "]h", function()
		gitsigns.nav_hunk("next")
	end, "Git: next hunk")
	buffer_map("n", "[h", function()
		gitsigns.nav_hunk("prev")
	end, "Git: previous hunk")

	-- Git actions (canonical)
	buffer_map("n", "<leader>gp", gitsigns.preview_hunk, "Git: preview hunk")
	buffer_map("n", "<leader>gs", gitsigns.stage_hunk, "Git: stage/unstage hunk")
	buffer_map("v", "<leader>gs", function()
		gitsigns.stage_hunk(visual_range())
	end, "Git: stage/unstage selected lines")
	buffer_map("n", "<leader>gr", gitsigns.reset_hunk, "Git: reset hunk")
	buffer_map("v", "<leader>gr", function()
		gitsigns.reset_hunk(visual_range())
	end, "Git: reset selected lines")
	buffer_map("n", "<leader>gS", gitsigns.stage_buffer, "Git: stage buffer")
	buffer_map("n", "<leader>gb", function()
		gitsigns.blame_line({ full = true })
	end, "Git: blame line")
	buffer_map("n", "<leader>gd", gitsigns.diffthis, "Git: diff against index")

	-- Text object: `ih` selects the hunk under the cursor (e.g. `vih`, `dih`)
	buffer_map({ "o", "x" }, "ih", gitsigns.select_hunk, "Git: select hunk")
end

require("gitsigns").setup({
	on_attach = on_attach,
})
