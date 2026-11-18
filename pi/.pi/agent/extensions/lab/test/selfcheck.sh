#!/bin/sh
# Lab self-check: test sidecars whose right result is known in advance, each in its own lab.
#   selfcheck.sh [PROJECT] [lab test options, e.g. --model p/id]
# PROJECT defaults to ~/code/sandbox/rentaplace and must hold sidecars/{repeater,decoy,plain,sixer}.
# Every run opens a Herdr Lab window behind yours, uses model tokens, and is stopped afterwards.
# Exit: 0 when every sidecar gave the expected result.
case "$1" in ''|-*) project="$HOME/code/sandbox/rentaplace" ;; *) project="$1"; shift ;; esac
cd "$project" || exit 2
bad=0; summary=""
run() { # NAME WANT WHAT
  name=$1 want=$2 what=$3; shift 3
  echo "== $name: $what"
  lab test "$name" --wait --behind "$@"; got=$?
  if [ "$got" -eq "$want" ]; then mark="ok  "; else mark="FAIL"; bad=1; fi
  summary="$summary
$mark $name: expected exit $want, got $got ($what)"
}
run repeater 0 "/sidecar watches, sends a note, and the note reaches Main's model" "$@"
run decoy    1 "the Tester fails a finding about the wrong thing (1 = the test failed, as it must)" "$@"
run plain    0 "a sidecar's own reply format wins over /sidecar's default" "$@"
run sixer    0 "the Tester can read a reply whose start scrolled off" "$@"
echo "$summary"
echo
lab leftovers
exit $bad
