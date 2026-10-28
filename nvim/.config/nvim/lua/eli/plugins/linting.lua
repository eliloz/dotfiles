
local lint = require("lint")

local linters_by_ft = {
	javascript = { "eslint_d" },
	typescript = { "eslint_d" },
	javascriptreact = { "eslint_d" },
	typescriptreact = { "eslint_d" },
	python = { "ruff" },
}

lint.linters_by_ft = linters_by_ft

local lint_augroup = vim.api.nvim_create_augroup("eli.lint", { clear = true })

-- BufReadPost (not BufEnter) lints once on open instead of on every buffer switch
vim.api.nvim_create_autocmd({ "BufReadPost", "BufWritePost", "InsertLeave" }, {
	group = lint_augroup,
	desc = "Run configured linters for current buffer",
	callback = function()
		lint.try_lint()
	end,
})
