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
		-- Linters
		"eslint_d",
		-- Python tools live outside Mason so they don't depend on whichever python3 is on PATH:
		--   uv tool install --managed-python pylint black isort
	},
})
