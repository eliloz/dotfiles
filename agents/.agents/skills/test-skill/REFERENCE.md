# Test skill: reference

The expectations format, the commands and the flags are in `lab --help` (section "Skills" and "Expectations"). Read it there; this file holds what `--help` does not say.

## Commands

- Baseline or full batch: `lab test skill <name> --runs 5 --behind`. Prints the tally and one report path per run.
- Trial run: `lab test skill <name> --behind --wait`.
- Reports: `.agents/skills/<name>/reports/<time>-<lab>.md`. Each holds the Tester's verdicts with quotes, the lab's Check results, then "What each pane showed": Main's whole transcript. The Tester never reads the report.
- Versions for `BASELINE.md`: `pi --version`; lab commit `git -C ~/dotfiles log -1 --format=%h -- pi/.pi/agent/extensions/lab`; model from `lab doctor` ("default model", or `$LAB_MODEL`); skill commit `git log -1 --format=%h -- .agents/skills/<name>/SKILL.md`.

## Stop at the first failure

When the bar is 5/5 on one expectation, run one lab at a time and stop at its first failure: a failure costs 1 to 5 runs instead of 5. Replace `N` with the target expectation's number:

```sh
for i in 1 2 3 4 5; do
  out=$(lab test skill <name> --behind --wait 2>&1)
  echo "run $i: $(echo "$out" | grep -E '^Report:')"
  echo "$out" | grep -E '^[✓✗] [0-9]'
  echo "$out" | grep -q '^✗ N ' && { echo "STOP: expectation N failed in run $i"; break; }
done
```

Tally the other expectations across the runs that happened and compare them with the baseline. Use the full `--runs 5` instead when comparing every count (measuring a change, a rerun).

## Writing expectations

- **The Expect line carries the test.** A See line that repeats Do text proves nothing: the typed words are on Main's screen.
- **Ambiguous wording is judged both ways.** If the Tester passes and fails the same shape across runs, the line is ambiguous: reword it with the user, then rerun the before batch too. Earlier counts under the old wording do not count.
- **Before Do lines set up a conversation** (an agreed grilling outcome before `/skill:to-spec`). Word them so Main does nothing yet: `… do nothing with it yet: just reply "OK".` Check the trial transcript that it did.
- **Tools.** Default read-only. A skill that writes gets `Tools (Main): read, grep, find, ls, write, edit`. Name `bash` only when the skill needs it.
- **Checks run in the project copy** after the step settles, as `/bin/sh -c`. `Run:` lines in Before can save a file to `$TMPDIR` for a Check to compare against later (`cp spec.md "$TMPDIR/spec.orig"`, then `cmp -s`). Write Checks for BSD tools (macOS): `[[:space:]]`, not `\s`.
- **Test Checks before the lab.** Build fake folders in the scratchpad (a good result, then one wrong case per Check) and run each Check in them with `TMPDIR` set.

## Gotchas

- **The copy holds tracked files only.** A fixture file must be `git add`ed before a lab sees it ("No such file" at Before).
- **The copy leaves out `.agents/`, `BASELINE.md`, `expectations*`, `reports/`, `CLAUDE.md`, `.git`.** It keeps the root `AGENTS.md` in skill tests, installs a local tracker in `.scratch/`, and no pane has a GitHub login.
- **A timeout looks like a failure.** Main still reading files when the wait ends fails the step. Read the transcript before counting it as the skill's.
- **Never press ctrl+o in a lab's Main pane.** It expands the skill's text on screen, where the Tester can read it.
- **Reading reports:** `awk '/^### Main/{m=1} m' <report>` prints Main's transcript. Its first "typed" entry is the expanded skill text; skip it. For a skill that asks questions, `| grep -E '\?$'` lists them.
- **Baseline counts only compare on the same versions.** A new model, Pi version or lab commit means a rerun before any comparison.

## BASELINE.md template

```markdown
# <Name> baseline

The score to beat. Written by hand from lab runs; the lab never changes this file.

## Current: <what this is> (<date>)

| Date | Model (Main and Tester) | Pi | Lab | Fixture commit | Skill |
|---|---|---|---|---|---|
| <date> | `<provider/id>` | <version> | `~/dotfiles` <hash> | `<hash>` | <Matt's `<hash>`, unchanged / plus <change> (this commit)> |

Command: `lab test skill <name> --runs 5 --behind`, from the fixture. <Tools, tracker, setup.>

| # | Expectation | Passes |
|---|---|---|
| 1 | <title> | n/5 |

Reports: `reports/<time>-<lab>`, `-<time>-<lab>`, …

### Notes

- <What the transcripts showed: every failure and its cause, anything borderline.>

## Previous: <…>

## Tried, not kept: <change> (<date>)
```

For a change, the counts table has Before and After columns. The commit message repeats it.
