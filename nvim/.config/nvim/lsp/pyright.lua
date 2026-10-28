return {
	-- Use the project's uv-managed .venv when there is one, so imports resolve without activating it
	before_init = function(_, config)
		local python = vim.fs.joinpath(config.root_dir or vim.fn.getcwd(), ".venv", "bin", "python")
		if vim.uv.fs_stat(python) then
			config.settings.python = config.settings.python or {}
			config.settings.python.pythonPath = python
		end
	end,
}
