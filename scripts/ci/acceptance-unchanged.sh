#!/usr/bin/env bash
# Fails when a change set edits, renames or deletes an existing acceptance
# scenario together with product code. Adding new scenarios is always allowed.
#
# Why: a scenario is the product owner's statement of expected behaviour. An
# implementation that rewrites it is grading its own work. Change the scenario
# in its own pull request first, then implement against it.
set -euo pipefail

base="${1:?usage: acceptance-unchanged.sh <base-ref>}"

# Without the base there is nothing to compare against, and passing silently
# would turn the guard off.
if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
  echo "acceptance-unchanged: base ref '$base' not found; fetch it or pass BASE=<ref>"
  exit 2
fi

changed_scenarios="$(git diff --name-only --diff-filter=MDR "$base"...HEAD -- e2e/acceptance/)"
if [ -z "$changed_scenarios" ]; then
  exit 0
fi

changed_code="$(git diff --name-only "$base"...HEAD -- app/ mcp/)"
if [ -z "$changed_code" ]; then
  exit 0
fi

echo "acceptance-unchanged: existing acceptance scenarios changed together with product code:"
printf '%s\n' "$changed_scenarios" | sed 's/^/  /'
echo "Change the scenario in its own pull request first, then implement against it."
exit 1
