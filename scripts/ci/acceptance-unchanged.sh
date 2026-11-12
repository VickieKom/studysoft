#!/usr/bin/env bash
# Fails when a change set weakens an acceptance scenario together with the
# code it is supposed to check. Two rules:
#
# 1. An existing scenario (one that is on the base branch) is not edited,
#    renamed or deleted in a change set that also changes product code.
#
# 2. A new scenario stays exactly as its scenario commits left it. With
#    scenario first, the implementation branch starts from the scenario branch
#    and lands both (AGENTS.md, "Scenario first"); rule 1 cannot see that,
#    because the new scenario does not exist on the base branch yet. So the
#    commits are read in order: a commit that touches no product code is a
#    scenario commit, and every file under e2e/acceptance/ it adds or changes
#    is frozen. Once any commit touches product code, no later commit may
#    change, rename or delete a frozen file. Adding further scenarios stays
#    allowed. Merge commits are skipped: they bring in work that was already
#    checked on its own branch.
#
# Why: a scenario is the product owner's statement of expected behaviour. An
# implementation that rewrites it is grading its own work. Change the scenario
# in its own pull request first, then implement against it.
set -euo pipefail

base="${1:?usage: acceptance-unchanged.sh <base-ref>}"
scenarios="e2e/acceptance/"

# Without the base there is nothing to compare against, and passing silently
# would turn the guard off.
if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  echo "acceptance-unchanged: base ref '$base' not found; fetch it or pass BASE=<ref>"
  exit 2
fi

status=0

# --- rule 1: existing scenarios ----------------------------------------------

changed_scenarios="$(git diff --name-only --diff-filter=MDR "$base"...HEAD -- "$scenarios")"
changed_code="$(git diff --name-only "$base"...HEAD -- app/ mcp/)"
if [ -n "$changed_scenarios" ] && [ -n "$changed_code" ]; then
  echo "acceptance-unchanged: existing acceptance scenarios changed together with product code:"
  printf '%s\n' "$changed_scenarios" | sed 's/^/  /'
  echo "Change the scenario in its own pull request first, then implement against it."
  status=1
fi

# --- rule 2: new scenarios stay as their scenario commits left them -----------

touches_code() {
  git diff-tree --no-commit-id --name-only -r "$1" -- app/ mcp/ | grep -q .
}

frozen=$'\n'
code_started=false
violations=""

while IFS= read -r commit; do
  [ -n "$commit" ] || continue
  # One line per change: status, then one path (or old and new path for a rename).
  changes="$(git diff-tree --no-commit-id --name-status -r -M "$commit" -- "$scenarios")"

  if ! $code_started && touches_code "$commit"; then
    code_started=true
  fi

  while IFS=$'\t' read -r change path new_path; do
    [ -n "$change" ] || continue
    if ! $code_started; then
      # A scenario commit: freeze what it adds or changes.
      case "$change" in
        A* | M*) frozen+="$path"$'\n' ;;
        R*) frozen+="$new_path"$'\n' ;;
      esac
      continue
    fi
    case "$change" in
      M* | D* | R*)
        if [[ "$frozen" == *$'\n'"$path"$'\n'* ]]; then
          violations+="  $path (in $(git rev-parse --short "$commit"))"$'\n'
        fi
        ;;
    esac
  done <<<"$changes"
done < <(git rev-list --reverse --no-merges "$base"..HEAD)

if [ -n "$violations" ]; then
  echo "acceptance-unchanged: a new scenario changed after the implementation started:"
  printf '%s' "$violations"
  echo "Fix the scenario in the scenario pull request and rebase the implementation onto it."
  status=1
fi

exit "$status"
