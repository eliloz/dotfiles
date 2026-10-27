local map = vim.keymap.set

local function copy_current_file_path()
	local path = vim.fn.expand("%:p")
	vim.fn.setreg("+", path)
	print("file:", path)
end

-- Search
map("n", "<leader>sc", ":nohlsearch<CR>", { desc = "Search: clear highlights" })


map("n", "n", "nzzzv", { desc = "Next search result (centered)" })
map("n", "N", "Nzzzv", { desc = "Previous search result (centered)" })
map("n", "<C-d>", "<C-d>zz", { desc = "Half page down (centered)" })
map("n", "<C-u>", "<C-u>zz", { desc = "Half page up (centered)" })

-- Editing
map("x", "<leader>p", '"_dP', { desc = "Paste without yanking" })
map({ "n", "v" }, "<leader>x", '"_d', { desc = "Delete without yanking" })
map("v", "J", ":m '>+1<CR>gv=gv", { desc = "Move selection down" })
map("v", "K", ":m '<-2<CR>gv=gv", { desc = "Move selection up" })
map("v", "<", "<gv", { desc = "Indent left and reselect" })
map("v", ">", ">gv", { desc = "Indent right and reselect" })
map("n", "J", "mzJ`z", { desc = "Join lines and keep cursor position" })
map("i", "<C-k>", "<cmd>lua vim.lsp.buf.signature_help()<CR>", { desc = "Show signature help" })

-- Buffers
map("n", "<leader>bn", ":bnext<CR>", { desc = "Buffer: next" })
map("n", "<leader>bp", ":bprevious<CR>", { desc = "Buffer: previous" })

-- Windows (canonical)
map("n", "<leader>wh", "<C-w>h", { desc = "Window: move left" })
map("n", "<leader>wj", "<C-w>j", { desc = "Window: move down" })
map("n", "<leader>wk", "<C-w>k", { desc = "Window: move up" })
map("n", "<leader>wl", "<C-w>l", { desc = "Window: move right" })
map("n", "<leader>wv", ":vsplit<CR>", { desc = "Window: split vertically" })
map("n", "<leader>ws", ":split<CR>", { desc = "Window: split horizontally" })


-- Copy helpers (canonical)
map("n", "<leader>yp", copy_current_file_path, { desc = "Yank: copy full file path" })

