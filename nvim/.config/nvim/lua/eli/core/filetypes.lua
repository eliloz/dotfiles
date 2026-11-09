-- Compose files are plain `yaml` to Neovim by default. docker-language-server
-- only attaches to `yaml.docker-compose`. Highlighting still uses the yaml rules.
vim.filetype.add({
	filename = {
		["docker-compose.yml"] = "yaml.docker-compose",
		["docker-compose.yaml"] = "yaml.docker-compose",
		["compose.yml"] = "yaml.docker-compose",
		["compose.yaml"] = "yaml.docker-compose",
	},
	pattern = {
		-- Overrides like docker-compose.override.yml or compose.dev.yaml
		["docker%-compose%..+%.ya?ml"] = "yaml.docker-compose",
		["compose%..+%.ya?ml"] = "yaml.docker-compose",
	},
})
