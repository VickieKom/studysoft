# Single entry point for every command. CI runs `make check` and nothing else,
# so a green `make check` locally means a green pipeline.

.DEFAULT_GOAL := help

# Branch the acceptance guard compares against. CI passes the pull request's
# base; locally the default is right unless you target another branch.
BASE ?= origin/main

# Tools come from package-lock.json, so local runs and CI execute the same code.
MARKDOWNLINT := node_modules/.bin/markdownlint-cli2
SQUAWK := node_modules/.bin/squawk
COMPOSE := docker compose -f deploy/compose.yaml

# Local stand. The database listens on loopback only; these credentials and the
# auth secret open nothing but a database on this machine.
DB_PORT ?= 54329
DB_ROOT := postgres://studysoft:studysoft@127.0.0.1:$(DB_PORT)
LOCAL_AUTH_SECRET := local-stand-only-auth-secret-never-used-elsewhere
LOCAL_LINK_KEY := local-stand-only-link-key-never-used-anywhere-else
BUILD_SHA ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)

# Files of the local stand live in the ignored data/ folder, one per database.
DEV_ENV := DATABASE_URL=$(DB_ROOT)/studysoft AUTH_SECRET=$(LOCAL_AUTH_SECRET) LINK_KEY=$(LOCAL_LINK_KEY) APP_URL=http://localhost:3000 FILES_DIR=$(CURDIR)/data/files BUILD_SHA=$(BUILD_SHA)
TEST_ENV := DATABASE_URL=$(DB_ROOT)/studysoft_test AUTH_SECRET=$(LOCAL_AUTH_SECRET) LINK_KEY=$(LOCAL_LINK_KEY) APP_URL=http://localhost:3000 FILES_DIR=$(CURDIR)/data/files-test BUILD_SHA=test
E2E_PORT ?= 3100
E2E_ENV := DATABASE_URL=$(DB_ROOT)/studysoft_e2e AUTH_SECRET=$(LOCAL_AUTH_SECRET) LINK_KEY=$(LOCAL_LINK_KEY) APP_URL=http://localhost:$(E2E_PORT) FILES_DIR=$(CURDIR)/data/files-e2e BUILD_SHA=$(BUILD_SHA) E2E_PORT=$(E2E_PORT)

# Pass --with-deps on a machine that lacks the browser's system libraries. CI
# does not: the runner image already has them, and apt there only adds optional
# fonts and fails the job whenever the Ubuntu mirrors are unreachable.
PLAYWRIGHT_INSTALL_FLAGS ?=

.PHONY: help check check-repo lint-docs install dev db-up db-down typecheck lint migrations test-unit test-integration e2e browsers

help: ## List available commands
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-17s %s\n", $$1, $$2}'

check: check-repo lint-docs typecheck lint migrations test-unit test-integration e2e ## Run every check that CI runs

check-repo: ## Guard scripts: self-test, tracked files, acceptance scenarios
	bash scripts/ci/test.sh
	bash scripts/ci/forbidden-files.sh
	bash scripts/ci/acceptance-unchanged.sh $(BASE)

lint-docs: install ## Lint Markdown files
	$(MARKDOWNLINT)

install: node_modules/.package-lock.json ## Install dependencies from the lockfile

# npm ci installs strictly from the lockfile and refreshes this marker, so a
# lockfile change triggers a reinstall and nothing else does.
node_modules/.package-lock.json: package-lock.json
	npm ci --ignore-scripts --no-audit --no-fund

dev: install db-up ## Start the local stand: database, migrations, seed data, app on :3000
	$(DEV_ENV) npm run db:migrate -w app
	$(DEV_ENV) npm run db:seed -w app
	$(DEV_ENV) npm run dev -w app

db-up: ## Start PostgreSQL in Docker and wait until it is ready
	$(COMPOSE) up -d --wait db

db-down: ## Stop PostgreSQL; the data volume is kept
	$(COMPOSE) down

typecheck: install ## Type-check the application, the MCP server, scenarios and configuration
	npm run typecheck -w app
	npm run typecheck -w mcp
	npx tsc -p tsconfig.json

lint: install ## Lint the application
	npm run lint -w app

migrations: install ## Lint migrations for locking and destructive changes
	$(SQUAWK) --assume-in-transaction app/src/server/db/migrations/*.sql

test-unit: install ## Unit tests
	npm run test:unit -w app
	npm run test:unit -w mcp

test-integration: install db-up ## Integration tests against a throwaway PostgreSQL database
	$(TEST_ENV) npm run test:integration -w app

browsers: install ## Install the browser for acceptance scenarios
	npx playwright install $(PLAYWRIGHT_INSTALL_FLAGS) chromium

e2e: install browsers db-up ## Acceptance scenarios against a production build
	$(E2E_ENV) npm run db:reset -w app
	$(E2E_ENV) npm run db:seed -w app
	$(E2E_ENV) npm run build -w app
	$(E2E_ENV) npx playwright test
