# Single entry point for every command. CI runs `make check` and nothing else,
# so a green `make check` locally means a green pipeline.

.DEFAULT_GOAL := help

# Branch the acceptance guard compares against. CI passes the pull request's
# base; locally the default is right unless you target another branch.
BASE ?= origin/main

# Pinned so local runs and CI lint with the same rules.
MARKDOWNLINT := npx --yes markdownlint-cli2@0.24.0

.PHONY: help check check-repo lint-docs

help: ## List available commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

check: check-repo lint-docs ## Run every check that CI runs

check-repo: ## Guard scripts: self-test, tracked files, acceptance scenarios
	bash scripts/ci/test.sh
	bash scripts/ci/forbidden-files.sh
	bash scripts/ci/acceptance-unchanged.sh $(BASE)

lint-docs: ## Lint Markdown files
	$(MARKDOWNLINT)
