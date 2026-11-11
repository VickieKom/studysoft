# Single entry point for every command. CI runs `make check` and nothing else,
# so a green `make check` locally means a green pipeline.

.DEFAULT_GOAL := help

# Pinned so local runs and CI lint with the same rules.
MARKDOWNLINT := npx --yes markdownlint-cli2@0.24.0

.PHONY: help check check-repo lint-docs

help: ## List available commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

check: check-repo lint-docs ## Run every check that CI runs

check-repo: ## Guard scripts: self-test, then scan tracked files
	bash scripts/ci/test.sh
	bash scripts/ci/forbidden-files.sh

lint-docs: ## Lint Markdown files
	$(MARKDOWNLINT)
