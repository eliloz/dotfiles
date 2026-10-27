vim.diagnostic.config({
  signs = {
    text = {
      [vim.diagnostic.severity.ERROR] = " ",
      [vim.diagnostic.severity.WARN] = " ",
      [vim.diagnostic.severity.INFO] = "󰋼 ",
      [vim.diagnostic.severity.HINT] = "󰌵 ",
    },
  },
})

local augroup = vim.api.nvim_create_augroup("eli.lsp.attach", { clear = true })

local function lsp_on_attach(ev)
	local client = vim.lsp.get_client_by_id(ev.data.client_id)
	if not client then
		return
	end

	local bufnr = ev.buf
	local opts = { noremap = true, silent = true, buffer = bufnr }
	local fzf = require("fzf-lua")
	local function buffer_map(mode, lhs, rhs, desc)
		vim.keymap.set(mode, lhs, rhs, vim.tbl_extend("force", opts, { desc = desc }))
	end
	local function organize_imports()
		vim.lsp.buf.code_action({
			context = { only = { "source.organizeImports" }, diagnostics = {} },
			apply = true,
			bufnr = bufnr,
		})
	end

	-- LSP navigation
	buffer_map("n", "gR", fzf.lsp_references, "Show LSP references")
	buffer_map("n", "gD", vim.lsp.buf.declaration, "Go to declaration")
	buffer_map("n", "gd", fzf.lsp_definitions, "Show LSP definitions")
	buffer_map("n", "gi", fzf.lsp_implementations, "Show LSP implementations")
	buffer_map("n", "gt", fzf.lsp_typedefs, "Show LSP type definitions")
	buffer_map("n", "K", vim.lsp.buf.hover, "Show hover documentation")

	-- LSP actions (canonical)
	buffer_map({ "n", "v" }, "<leader>la", vim.lsp.buf.code_action, "LSP: code actions")
	buffer_map("n", "<leader>lr", vim.lsp.buf.rename, "LSP: rename symbol")
	buffer_map("n", "<leader>lR", function()
		vim.cmd("LspRestart")
	end, "LSP: restart client")


	if client:supports_method("textDocument/codeAction", bufnr) then
		buffer_map("n", "<leader>li", organize_imports, "LSP: organize imports")
	end
end

vim.api.nvim_create_autocmd("LspAttach", {
	group = augroup,
	desc = "Set buffer-local LSP keymaps when a client attaches",
	callback = lsp_on_attach,
})

-- Diagnostics (canonical)
vim.keymap.set("n", "<leader>dd", vim.diagnostic.open_float, { desc = "Diagnostics: show line details" })


vim.lsp.enable({
	"lua_ls",
	"rust_analyzer",
	"ts_ls",
	"pyright",
	"clangd",
	"bashls",
	"gopls",
})

