# The application image: the production build of app/ plus what applies
# migrations. Built from the repository root:
#   docker build -f deploy/Dockerfile --build-arg BUILD_SHA=<sha> .
#
# Debian, not Alpine: CI builds and tests on glibc, and the native parts of
# the toolchain are installed from the same lockfile entries here.
FROM node:22-bookworm-slim AS build
WORKDIR /srv

COPY package.json package-lock.json ./
COPY app/package.json app/
COPY mcp/package.json mcp/
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY app app
# The build type-checks the tests too, and they import the synthetic data.
COPY deploy/seed deploy/seed
RUN npm run build -w app

FROM node:22-bookworm-slim
ENV NODE_ENV=production NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /srv

# shortcut: the image keeps development dependencies, because migrations and
# the account script run through tsx; split them out when the size matters (#4)
# Synthetic data stays behind: this image may run with real students.
COPY --from=build /srv/package.json /srv/package.json
COPY --from=build /srv/node_modules /srv/node_modules
COPY --from=build /srv/app /srv/app

# The file adapter's directory. Created here so that a volume mounted over it
# starts out writable by the unprivileged user.
RUN mkdir -p /data/files && chown node:node /data/files
ENV FILES_DIR=/data/files

# Required by the application: it refuses to start without a build identifier.
ARG BUILD_SHA
ENV BUILD_SHA=${BUILD_SHA}

USER node
WORKDIR /srv/app
EXPOSE 3000
# node directly, not npm: the server receives the stop signal itself.
CMD ["node", "../node_modules/next/dist/bin/next", "start", "--port", "3000"]
