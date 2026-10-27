local conform = require("conform")

local formatters_by_ft = {
	sh = { "shfmt" },
	c = { "clang_format" },
	css = { "prettier" },
	html = { "prettier" },
	java = { "google-java-format" },
	javascript = { "prettier" },
	javascriptreact = { "prettier" },
	json = { "prettier" },
	lua = { "stylua" },
	markdown = { "prettier" },
	python = { "isort", "black" },
	typescript = { "prettier" },
	typescriptreact = { "prettier" },
	yaml = { "prettier" },
}

require("conform").setup({
	formatters_by_ft = formatters_by_ft,
})

local function format_buffer_or_range()
	conform.format({
		lsp_fallback = true,
		async = false,
		timeout_ms = 2000,
	})
end

-- Formatting (canonical)
vim.keymap.set({ "n", "v" }, "<leader>mf", format_buffer_or_range, { desc = "Format file or range" })
