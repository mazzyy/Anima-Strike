#!/usr/bin/env bash
#
# Run the build the right way, with the checks in the right order.
#
#   bash automation/run.sh              the environment pass, items 26-33
#   bash automation/run.sh --test       run the tests and report, nothing else
#   bash automation/run.sh --repair     item 34 only: clear the failing tests
#   bash automation/run.sh --items 3    the next N pending items, whatever they are
#
# This exists because pasted command lines with trailing "# explanations" get
# handed to lf.py as arguments by zsh, which does not strip comments when you
# type them interactively. Two silent failures cost a whole evening that way.

set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GAME="$ROOT/little-fighters-js"
cd "$ROOT"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\n\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m%s\033[0m\n' "$*"; exit 1; }

# Prints the pass/fail line. Returns 0 only when the suite is fully green.
run_tests() {
  local out pass fail
  out="$(npm --prefix "$GAME" test --silent 2>&1)"
  pass="$(printf '%s\n' "$out" | grep -E '^# pass ' | awk '{print $3}' | tail -1)"
  fail="$(printf '%s\n' "$out" | grep -E '^# fail ' | awk '{print $3}' | tail -1)"
  printf '  %s passing, %s failing\n' "${pass:-?}" "${fail:-?}"
  [ "${fail:-1}" = "0" ] && return 0

  printf '\n  red:\n'
  printf '%s\n' "$out" | grep -E '^not ok ' | sed 's/^/    /' | head -30
  return 1
}

# Fails loudly if the roadmap did not move, so a build that never reached the
# API cannot look like a build that ran and found nothing to do.
spend() { python3 automation/lf.py usage; }

case "${1:-}" in
  --test)
    bold "Tests"; run_tests || true; exit 0 ;;

  --repair)
    bold "Tests before"
    run_tests && { echo "  already green — nothing to repair"; exit 0; }
    bold "Item 34 — clearing the failing tests"
    python3 automation/lf.py build --item 34 \
      || die "the build command itself failed before reaching Azure"
    bold "Tests after"
    run_tests || warn "Still red. Re-run to let it have another go, or read the failures above."
    spend; exit 0 ;;

  --items)
    COUNT="${2:-3}"
    bold "Next $COUNT pending items"
    python3 automation/lf.py build --auto --max "$COUNT" \
      || die "the build command itself failed before reaching Azure"
    bold "Tests after"; run_tests || true; spend; exit 0 ;;
esac

# ---- default: the environment pass ----------------------------------------
#
# These do not need a green baseline. The gate is differential now, so each
# item is judged only on tests IT breaks, and every currently-failing test is
# in combat, AI or camera code that these items do not touch.

bold "Before — where the suite stands"
run_tests || warn "Red going in. That is expected and safe: these items are judged only on what they break."

bold "Environment pass — items 26 to 33"
echo "Eight items. Expect roughly a minute or two each, and \$10-15 total."
python3 automation/lf.py build --auto --max 8 \
  || die "the build command itself failed before reaching Azure"

bold "After — did anything break?"
run_tests || warn "Compare this list with the one above. Anything NEW is worth reading."

bold "Spend"
spend

bold "Look at it"
echo "  npm --prefix \"$GAME\" start"
