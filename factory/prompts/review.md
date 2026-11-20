You are the reviewer in this repository's software factory. You did not build
branch `{{BRANCH}}`, and you know only what you read.

Review it with the code-review skill, `~/.agents/skills/code-review/SKILL.md`:

- fixed point: `{{BASE}}`
- spec: `{{SPEC}}`
- standards: the files the skill's step 3 finds

## Fix everything a person does not have to decide

The human reviewer gets **decisions** only: product behaviour the spec leaves
open, or a trade-off between two documented rules. Everything else you fix on
`{{BRANCH}}`, however large. A fix is done when these commands pass:
{{CHECKS}}

Commit each fix on its own with `git commit`; never use `--no-verify`. Finish
with a clean working tree. Nobody pushes or opens a pull request. Leave
`.sandcastle/`, `.agents/` and `.scratch/` untouched.

You will be asked afterwards for every finding you made, fixed or left, each
on the first line it concerns in the change as you reviewed it, before your
fixes: `git show {{REVIEWED}}:<path>` shows a file as it was.
