vim.opt_local.wrap = true
vim.opt_local.linebreak = true
vim.opt_local.breakindent = true

vim.keymap.set("n", "j", function()
	return vim.v.count == 0 and "gj" or "j"
end, { expr = true, silent = true, buffer = 0, desc = "Down (wrap-aware)" })
vim.keymap.set("n", "k", function()
	return vim.v.count == 0 and "gk" or "k"
end, { expr = true, silent = true, buffer = 0, desc = "Up (wrap-aware)" })

vim.opt_local.textwidth = 80
vim.opt_local.colorcolumn = "80"

vim.opt_local.spell = true
vim.opt_local.spelllang = "en_us"

vim.opt_local.formatoptions:append("t")
vim.opt_local.formatoptions:append("c")
