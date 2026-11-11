#!/usr/bin/env bash
# Self-test for the CI guard scripts. Builds throwaway git repositories and
# checks that each guard passes and fails where it should.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0
counter=0

# expect <pass|fail> <label> <directory> <command...>
expect() {
  local want="$1" label="$2" dir="$3" got
  shift 3
  if (cd "$dir" && "$@") >/dev/null 2>&1; then got=pass; else got=fail; fi
  if [ "$got" = "$want" ]; then
    echo "ok   $label"
  else
    echo "FAIL $label (wanted $want, got $got)"
    failures=$((failures + 1))
  fi
}

new_repo() {
  counter=$((counter + 1))
  repo="$tmp/repo-$counter"
  mkdir -p "$repo"
  git -C "$repo" init -q -b main
  git -C "$repo" config user.email "test@example.invalid"
  git -C "$repo" config user.name "test"
  git -C "$repo" config commit.gpgsign false
}

write() {
  mkdir -p "$(dirname "$repo/$1")"
  printf '%s\n' "$2" >"$repo/$1"
}

commit() {
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "$1"
}

# --- forbidden-files ---------------------------------------------------------

# forbidden_case <pass|fail> <label> <path> [max-bytes]
forbidden_case() {
  new_repo
  write "app/src/page.tsx" "export {}"
  write "deploy/seed/students.json" "[]"
  write ".env.example" "A="
  write "$3" "content longer than ten bytes"
  commit "case"
  expect "$1" "forbidden-files: $2" "$repo" env MAX_FILE_BYTES="${4:-1048576}" bash "$here/forbidden-files.sh"
}

forbidden_case pass "ordinary source, seed data and .env.example" "README.md"
forbidden_case fail "textbook PDF" "docs/unit-3.PDF"
forbidden_case fail "audio track" "app/public/track-01.mp3"
forbidden_case fail "archive" "backup.tar.gz"
forbidden_case fail "env file" "app/.env.local"
forbidden_case fail "test data outside deploy/seed" "e2e/fixtures/homework.json"
forbidden_case pass "test data inside deploy/seed" "deploy/seed/fixtures/homework.json"
forbidden_case fail "oversized file" "app/src/big.ts" 10
forbidden_case pass "oversized lockfile is exempt" "package-lock.json" 10

# --- acceptance-unchanged ----------------------------------------------------

# acceptance_case <pass|fail> <label> <function that edits the branch>
acceptance_case() {
  new_repo
  write "e2e/acceptance/login.spec.ts" "original scenario"
  write "app/src/login.ts" "original code"
  commit "base"
  git -C "$repo" checkout -q -b change
  "$3"
  commit "change"
  expect "$1" "acceptance-unchanged: $2" "$repo" bash "$here/acceptance-unchanged.sh" main
}

new_scenario_with_code() {
  write "e2e/acceptance/homework.spec.ts" "new scenario"
  write "app/src/homework.ts" "new code"
}
edited_scenario_with_code() {
  write "e2e/acceptance/login.spec.ts" "weakened scenario"
  write "app/src/login.ts" "new code"
}
edited_scenario_alone() {
  write "e2e/acceptance/login.spec.ts" "clarified scenario"
}
deleted_scenario_with_code() {
  rm "$repo/e2e/acceptance/login.spec.ts"
  write "app/src/login.ts" "new code"
}
code_alone() {
  write "app/src/login.ts" "new code"
}

acceptance_case pass "new scenario together with code" new_scenario_with_code
acceptance_case fail "existing scenario edited together with code" edited_scenario_with_code
acceptance_case pass "existing scenario edited on its own" edited_scenario_alone
acceptance_case fail "existing scenario deleted together with code" deleted_scenario_with_code
acceptance_case pass "code change without touching scenarios" code_alone

new_repo
write "app/src/login.ts" "code"
commit "base"
expect fail "acceptance-unchanged: unknown base ref is an error, not a pass" "$repo" bash "$here/acceptance-unchanged.sh" origin/missing

if [ "$failures" -gt 0 ]; then
  echo "$failures guard self-test(s) failed"
  exit 1
fi
