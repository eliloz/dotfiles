
local lint = require("lint")

local linters_by_ft = {
	javascript = { "eslint_d" },
	typescript = { "eslint_d" },
	javascriptreact = { "eslint_d" },
	typescriptreact = { "eslint_d" },
	python = { "pylint" },
}

lint.linters_by_ft = linters_by_ft

local lint_augroup = vim.api.nvim_create_augroup("eli.lint", { clear = true })

vim.api.nvim_create_autocmd({ "BufEnter", "BufWritePost", "InsertLeave" }, {
	group = lint_augroup,
	desc = "Run configured linters for current buffer",
	callback = function()
		lint.try_lint()
	end,
})
