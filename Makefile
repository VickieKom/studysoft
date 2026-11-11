# Single entry point for every command. CI runs `make check` and nothing else,
# so a green `make check` locally means a green pipeline.

.DEFAULT_GOAL := help

# Branch the acceptance guard compares against. CI passes the pull request's
# base; locally the default is right unless you target another branch.
BASE ?= origin/main

# Tools come from package-lock.json, so local runs and CI execute the same code.
MARKDOWNLINT := node_modules/.bin/markdownlint-cli2

.PHONY: help check check-repo lint-docs

help: ## List available commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

check: check-repo lint-docs ## Run every check that CI runs

check-repo: ## Guard scripts: self-test, tracked files, acceptance scenarios
	bash scripts/ci/test.sh
	bash scripts/ci/forbidden-files.sh
	bash scripts/ci/acceptance-unchanged.sh $(BASE)

lint-docs: node_modules/.package-lock.json ## Lint Markdown files
	$(MARKDOWNLINT)

# npm ci installs strictly from the lockfile and refreshes this marker, so a
# lockfile change triggers a reinstall and nothing else does.
node_modules/.package-lock.json: package-lock.json
	npm ci --ignore-scripts --no-audit --no-fund
