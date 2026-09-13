#!/usr/bin/env bash
#
#   bash automation/run.sh              work the queue (stages, then the menu pass)
#   bash automation/run.sh --test       run the tests and report, nothing else
#   bash automation/run.sh --items N    the next N pending items
#
# Comments in a pasted command line get handed to lf.py as arguments by zsh,
# which does not strip them when typed interactively. That cost an evening.

set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GAME="$ROOT/little-fighters-js"
cd "$ROOT"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\n\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m%s\033[0m\n' "$*"; exit 1; }

# A module that does not parse takes down every test file that imports it, so
# every item run against it looks like it broke something and gets reverted.
# That is exactly how one missing pair of parentheses in sky.js cost five
# items and about six dollars. Never start a run on a tree that cannot parse.
parse_check() {
  local bad=0
  for f in "$GAME"/renderer/src/*.js; do
    if ! node --input-type=module --check < "$f" >/dev/null 2>&1; then
      [ "$bad" = 0 ] && printf '\n\033[31mThese modules do not parse:\033[0m\n'
      bad=1
      printf '  %s\n' "${f#"$GAME"/}"
      node --input-type=module --check < "$f" 2>&1 | grep -E 'Error|\^' | head -3 | sed 's/^/      /'
    fi
  done
  return $bad
}

run_tests() {
  local out pass fail
  out="$(npm --prefix "$GAME" test --silent 2>&1)"
  pass="$(printf '%s\n' "$out" | grep -E '^# pass ' | awk '{print $3}' | tail -1)"
  fail="$(printf '%s\n' "$out" | grep -E '^# fail ' | awk '{print $3}' | tail -1)"
  printf '  %s passing, %s failing\n' "${pass:-?}" "${fail:-?}"
  [ "${fail:-1}" = "0" ] && return 0
  printf '%s\n' "$out" | grep -E '^not ok ' | sed 's/^/    /' | head -30
  return 1
}

case "${1:-}" in
  --test)
    bold "Parse check"; parse_check && echo "  every module parses"
    bold "Tests"; run_tests || true; exit 0 ;;
  --items)
    bold "Parse check"
    parse_check || die "Fix the above before building — every item would be reverted."
    echo "  every module parses"
    bold "Next ${2:-3} pending items"
    python3 automation/lf.py build --auto --max "${2:-3}" --repair 2 \
      || die "the build command failed to start"
    bold "Tests after"; run_tests || true
    python3 automation/lf.py usage; exit 0 ;;
esac

bold "Parse check"
parse_check || die "Fix the above before building — every item would be reverted for it."
echo "  every module parses"

bold "Before"
run_tests || warn "Red going in. The gate judges each item only on what IT breaks."

bold "Working the queue"
echo "Stages 27-33, then the menu pass 39-45. A minute or two each."
python3 automation/lf.py build --auto --max 8 --repair 2 \
  || die "the build command failed to start"

bold "After — compare this list with the one above"
run_tests || warn "Anything NEW here is worth reading. Anything repeated was already broken."

bold "Spend"
python3 automation/lf.py usage

bold "Look at it"
echo "  npm --prefix \"$GAME\" start"
