---
name: test-skill
description: Lab testing of a project's skills against their expectations and baselines. Use when adding, changing or testing a skill in .agents/skills/, when a skill misbehaves, or after pulling skill updates.
---

# Test skill

Measure one skill of this project in the lab, against its **expectations**, and keep its **baseline** true. Arguments: `<name>`, `<name> <complaint>`, or `all`.

The words are the lab's: **expectation** (a titled block of Do, Expect, Never, See, Absent and Check lines in `.agents/skills/<name>/expectations.md`), **Check** (a shell command the lab runs in the copy; exit 0 passes), **baseline** (`BASELINE.md`: pass counts per expectation over 5 runs, with what produced them), **bar** (what a change must reach to be kept). Formats, commands and gotchas: [REFERENCE.md](REFERENCE.md). Read it before the first lab run.

## Rules

- **The expectations are the user's.** Draft lines for them; a line enters the file only when they approve it. A line is never loosened. A line found ambiguous is reworded with their approval, and then the before batch is rerun under the new wording.
- **Every batch is announced.** Before any lab run, state how many runs and why, and wait for a yes. One yes covers the runs you named.
- **Counts come with transcripts.** After each batch, read Main's section of the reports, not only the tally: a 5/5 can hide a weakness, and a failure can be the lab's (a timeout) rather than the skill's.
- **One change at a time** to a `SKILL.md`, measured before it is kept.
- **Commit locally, never push.** A kept change commits the skill and `BASELINE.md` together, with a before/after table in the message. A change not kept is reverted and still recorded in `BASELINE.md` under "Tried, not kept".

## 1. Find the state

Run from the project root. `lab doctor` must show every line ✓. For `all`, do this step for every `.agents/skills/*/expectations.md`, show the list, and take one yes for the whole set.

Read `.agents/skills/<name>/` and decide, first match wins:

| Found | Path |
|---|---|
| No `SKILL.md` | Stop: say which skills exist |
| No `expectations.md` | **New** (step 2) |
| A complaint was given | **Improve** (step 5) |
| `SKILL.md` differs from the skill commit in `BASELINE.md` (committed or not) | **Measure a change** (step 3) |
| Model, Pi version or lab commit differs from `BASELINE.md`'s "Current" row | **Rerun** (step 4) |
| Nothing differs | **Current**: say so and stop, unless the user asks for a check |

Tell the user the path, the reason (the exact difference found), and the runs it will cost. Wait for a yes.

## 2. New

1. Read `SKILL.md`, the project's glossary and tracker docs. Draft 3 to 6 expectations from the skill's own rules plus what the user wants from it. Use a feature from this project's domain in the Do lines. If the skill writes files: a `Tools (Main):` line and Check lines that prove what is on disk, including "nothing written yet" before any approval step.
2. Show the draft and ask what they want changed. Done when the user approves the file as written.
3. Test every Check against fake folders in the scratchpad: one good layout, and one wrong case per Check. Done when each Check passes the good one and fails its own wrong case.
4. Commit the expectations and every fixture file they need (the lab copies tracked files only).
5. One trial run. Read it: the Before lines did what you meant, every Check ran.
6. `--runs 5`. Write `BASELINE.md` from the template and commit it.

## 3. Measure a change

1. `--runs 5`, the full five: comparing needs every count.
2. Compare each expectation with the baseline. The bar: no expectation dropped, and the one the change aimed at (if any) improved.
3. Read the transcripts of every run that differs from the baseline, and say why it differs.
4. Recommend keep or revert, with the table. On the user's yes, commit or revert, and record either way.

## 4. Rerun

1. `--runs 5`, skill untouched.
2. Write a new "Current" section in `BASELINE.md` with today's versions; rename the old one "Previous". Say which counts moved, and read the transcripts of any that dropped.
3. Commit `BASELINE.md`.

## 5. Improve

1. Turn the complaint into one Expect or Never line (or a new expectation). Get the user's approval.
2. Show it fails or is flaky: the latest baseline's transcripts, if they already show it, or `--runs 5`. Done when at least one run fails on that line. If none does, report that and stop: there is nothing to fix yet.
3. Propose one change to `SKILL.md`, in one or two sentences, and get a yes.
4. Run the stop-at-first-failure loop (REFERENCE.md). The bar: the target expectation 5/5, every other expectation no lower than its baseline.
5. Kept: commit skill, expectation and `BASELINE.md` together. Not kept: revert the skill, record the attempt with the run that failed and why, and say what the failure suggests trying next.
