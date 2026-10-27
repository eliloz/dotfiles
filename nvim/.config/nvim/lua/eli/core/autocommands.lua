local checktime_group = vim.api.nvim_create_augroup("eli.core.checktime", { clear = true })

vim.api.nvim_create_autocmd({ "BufEnter", "FocusGained", "TermClose", "TermLeave" }, {
	group = checktime_group,
	desc = "Check for file changes made outside Neovim",
	callback = function()
		if vim.bo.buftype ~= "" then
			return
		end
		vim.cmd("checktime")
	end,
})

local yank_group = vim.api.nvim_create_augroup("eli.core.yank", { clear = true })

vim.api.nvim_create_autocmd("TextYankPost", {
	group = yank_group,
	desc = "Briefly highlight yanked text",
	callback = function()
		vim.highlight.on_yank()
	end,
})

