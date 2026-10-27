require("mason").setup({})

require("mason-tool-installer").setup({
	ensure_installed = {
		-- LSP servers
		"lua-language-server",
		"rust-analyzer",
		"typescript-language-server",
		"pyright",
		"clangd",
		"bash-language-server",
		"gopls",
		-- Formatters
		"shfmt",
		"clang-format",
		"prettier",
		"google-java-format",
		"stylua",
		"isort",
		"black",
		-- Linters
		"eslint_d",
		"pylint",
	},
})
