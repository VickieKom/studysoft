#!/usr/bin/env bash
# Fails when a change set weakens an acceptance scenario together with the
# code it is supposed to check.
#
# "Scenario files" are everything under e2e/acceptance/ plus
# playwright.config.ts, which decides what runs: a scenario dropped from the
# configuration is as gone as a deleted one.
#
# Rule 1 — the reviewed scenario. With scenario first (AGENTS.md), the
# implementation lands together with a scenario that was reviewed in its own
# draft pull request. Its branch, feature/<issue>-acceptance-*, is what the
# product owner reviewed. Every scenario file that branch changed must have
# exactly the same content here; any other change to scenario files may only
# add new files under e2e/acceptance/. Content is compared, not commits, so
# rebasing the implementation onto main or onto a fixed scenario keeps
# passing. The scenario branch is found from this branch's name
# (feature/<issue>-…) or given as SCENARIO_REF.
#
# Rule 2 — existing scenarios. Without a reviewed scenario branch, a scenario
# file that is on the base branch is not edited, renamed or deleted in a
# change set that also changes product code.
#
# Rule 3 — commit order, a backstop when no scenario branch exists. A commit
# that touches no product code freezes the files under e2e/acceptance/ it adds
# or changes; once any commit touches product code, no later commit may
# change, rename or delete a frozen file. Merge commits are skipped.
#
# Why: a scenario is the product owner's statement of expected behaviour. An
# implementation that rewrites it is grading its own work. Fix the scenario in
# its own pull request, then rebase the implementation onto it.
set -euo pipefail

base="${1:?usage: acceptance-unchanged.sh <base-ref>}"
scenario_dir="e2e/acceptance/"
config="playwright.config.ts"

# Without the base there is nothing to compare against, and passing silently
# would turn the guard off.
if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  echo "acceptance-unchanged: base ref '$base' not found; fetch it or pass BASE=<ref>"
  exit 2
fi

status=0
fail() {
  printf '%s\n' "$@"
  status=1
}

# Blob of a path at a commit, or "absent".
blob() {
  git rev-parse --quiet --verify "$1:$2" 2>/dev/null || echo absent
}

# --- find the reviewed scenario ----------------------------------------------

branch="${HEAD_BRANCH:-${GITHUB_HEAD_REF:-$(git symbolic-ref --quiet --short HEAD || true)}}"
scenario_ref="${SCENARIO_REF:-}"

if [ -z "$scenario_ref" ] && [[ "$branch" =~ ^(feature|bugfix|hotfix)/([0-9]+)- ]] && [[ "$branch" != *-acceptance-* ]]; then
  issue="${BASH_REMATCH[2]}"
  candidates="$(git for-each-ref --format='%(refname)' "refs/remotes/origin/feature/$issue-acceptance-*")"
  if [ -z "$candidates" ]; then
    candidates="$(git for-each-ref --format='%(refname)' "refs/heads/feature/$issue-acceptance-*")"
  fi
  if [ "$(printf '%s' "$candidates" | grep -c .)" -gt 1 ]; then
    echo "acceptance-unchanged: several scenario branches for #$issue; pass SCENARIO_REF=<ref>:"
    printf '%s\n' "$candidates" | sed 's/^/  /'
    exit 2
  fi
  scenario_ref="$candidates"
fi

if [ -n "$scenario_ref" ] && ! git rev-parse --verify --quiet "$scenario_ref^{commit}" >/dev/null; then
  echo "acceptance-unchanged: scenario ref '$scenario_ref' not found"
  exit 2
fi

# --- rule 1: the reviewed scenario, by content -------------------------------

reviewed=$'\n'
if [ -n "$scenario_ref" ]; then
  scenario_base="$(git merge-base "$base" "$scenario_ref")"
  mismatched=""
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    reviewed+="$path"$'\n'
    if [ "$(blob "$scenario_ref" "$path")" != "$(blob HEAD "$path")" ]; then
      mismatched+="  $path"$'\n'
    fi
  done < <(git diff --name-only "$scenario_base" "$scenario_ref" -- "$scenario_dir" "$config")

  if [ -n "$mismatched" ]; then
    fail "acceptance-unchanged: scenario files differ from the reviewed scenario (${scenario_ref#refs/remotes/}):" \
      "${mismatched%$'\n'}" \
      "Fix the scenario in its own pull request and rebase the implementation onto it."
  fi

  unreviewed=""
  while IFS=$'\t' read -r change path new_path; do
    [ -n "$change" ] || continue
    target="${new_path:-$path}"
    [[ "$reviewed" == *$'\n'"$path"$'\n'* || "$reviewed" == *$'\n'"$target"$'\n'* ]] && continue
    if [[ "$change" == A* && "$path" == "$scenario_dir"* ]]; then
      continue
    fi
    unreviewed+="  $change $path${new_path:+ -> $new_path}"$'\n'
  done < <(git diff --name-status -M "$base"...HEAD -- "$scenario_dir" "$config")

  if [ -n "$unreviewed" ]; then
    fail "acceptance-unchanged: scenario files changed outside the reviewed scenario:" \
      "${unreviewed%$'\n'}" \
      "Only new scenario files may be added next to the implementation."
  fi
fi

# --- rule 2: existing scenario files, without a reviewed scenario ------------

if [ -z "$scenario_ref" ]; then
  changed_scenarios="$(git diff --name-only --diff-filter=MDR "$base"...HEAD -- "$scenario_dir" "$config")"
  changed_code="$(git diff --name-only "$base"...HEAD -- app/ mcp/)"
  if [ -n "$changed_scenarios" ] && [ -n "$changed_code" ]; then
    fail "acceptance-unchanged: existing scenario files changed together with product code:" \
      "$(printf '%s\n' "$changed_scenarios" | sed 's/^/  /')" \
      "Change the scenario in its own pull request first, then implement against it."
  fi
fi

# --- rule 3: commit order -----------------------------------------------------

touches_code() {
  git diff-tree --no-commit-id --name-only -r "$1" -- app/ mcp/ | grep -q .
}

frozen=$'\n'
code_started=false
violations=""

while IFS= read -r commit; do
  [ -n "$commit" ] || continue
  changes="$(git diff-tree --no-commit-id --name-status -r -M "$commit" -- "$scenario_dir")"

  if ! $code_started && touches_code "$commit"; then
    code_started=true
  fi

  while IFS=$'\t' read -r change path new_path; do
    [ -n "$change" ] || continue
    if ! $code_started; then
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
  fail "acceptance-unchanged: a new scenario changed after the implementation started:" \
    "${violations%$'\n'}" \
    "Fix the scenario in the scenario pull request and rebase the implementation onto it."
fi

exit "$status"
