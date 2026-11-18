Use the lab to grow a sidecar named **{{name}}**{{instructionsLine}}.

{{situation}}

Work in this order and keep each message short:

{{expectationSteps}}
3. {{sidecarStep}}
4. **Run the lab** once every file is saved (a separate step, never in the same batch as a write): call the `lab` tool with `{"action":"test","sidecar":"{{name}}"}`, then `{"action":"wait","run":"<run ID>"}` until it finishes. The Herdr Lab window shows the run.
5. **If something fails**, read the report it names. Change only the `## Instructions` section of `{{sidecarPath}}`, never the expectations, unless I agree an expectation was wrong. Then stop the old lab with `{"action":"stop","run":"<run ID>"}` and run again. Try at most three runs in total, then tell me what's still failing and what you'd change.
6. **When it passes**, give me the report path and one line per expectation. Leave the last lab open for me to look at; `/lab stop` closes it.
