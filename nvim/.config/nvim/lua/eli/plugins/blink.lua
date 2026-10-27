require("luasnip.loaders.from_vscode").lazy_load()
local ls = require("luasnip")

require("blink.cmp").setup({
	keymap = {
		preset = "none",
		["<C-Space>"] = { "show", "hide" },
		["<C-y>"] = { "accept", "fallback" },
		["<C-n>"] = { "select_next", "fallback" },
		["<C-p>"] = { "select_prev", "fallback" },
	},
	appearance = { nerd_font_variant = "mono" },
	completion = { menu = { auto_show = true } },
	sources = { default = { "lsp", "path", "buffer", "snippets" } },
	snippets = {
		expand = function(snippet)
			require("luasnip").lsp_expand(snippet)
		end,
	},

	fuzzy = {
		implementation = "prefer_rust",
		prebuilt_binaries = { download = true },
	},
})


vim.keymap.set({ "i", "s" }, "<Tab>", function()
	if ls.jumpable(1) then
		ls.jump(1)
		return ""
	end
	return "<Tab>"
end, { expr = true, silent = true, desc = "Snippet jump forward" })

vim.keymap.set({ "i", "s" }, "<S-Tab>", function()
	if ls.jumpable(-1) then
		ls.jump(-1)
		return ""
	end
	return "<S-Tab>"
end, { expr = true, silent = true, desc = "Snippet jump backward" })

