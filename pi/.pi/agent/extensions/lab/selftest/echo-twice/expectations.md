# echo-twice expectations (the lab's self-test: lab selftest)

## Echoes the word twice
Do (Main): /skill:echo-twice lake
See (Main): "lake"
Expect (Main): shows the word lake on two separate lines
Check: grep -q "local Markdown files under" AGENTS.md && grep -q "Local Markdown" docs/agents/issue-tracker.md
Check: ! gh auth status
