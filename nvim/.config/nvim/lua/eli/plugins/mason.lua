require("mason").setup({})

require("mason-tool-installer").setup({
	ensure_installed = {
		-- LSP servers (rust-analyzer comes from rustup instead)
		"lua-language-server",
		"typescript-language-server",
		"pyright",
		"clangd",
		"bash-language-server",
		"gopls",
		"docker-language-server",
		"css-lsp",
		"superhtml",
		-- Formatters
		"shfmt",
		"clang-format",
		"prettier",
		"stylua",
		-- Linters
		"eslint_d",
		"ruff",
	},
})
