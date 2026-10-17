# syntax=docker/dockerfile:1
#
# The Watchtower image (docker-deploy skill, ADR-003). Multi-stage: build with pnpm, then copy
# only the built server, the launcher scripts and the production dependencies into a small
# runtime stage that runs as the unprivileged `node` user.
#
# Base: Node 24 LTS on Alpine 3.24, pinned to the tag and the multi-arch index digest.
# Update both together: docker buildx imagetools inspect node:<tag>
ARG NODE_IMAGE=node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f

# ---------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app

ENV ASTRO_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    pnpm_config_update_notifier=false

# pnpm at the exact version in package.json `packageManager`.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack install

# pnpm-workspace.yaml sets storeDir/cacheDir to app-relative folders for the host
# (Commandment 1). In this stage they resolve to /app/.pnpm-store and /app/.local/pnpm-cache,
# which never leave the build stage (only node_modules, dist, scripts and package.json are
# copied on). The host behaviour is unchanged, and install and prune agree on the store.
RUN pnpm install --frozen-lockfile

COPY astro.config.mjs svelte.config.js tsconfig.json ./
COPY public ./public
COPY scripts ./scripts
COPY src ./src
RUN pnpm build

RUN pnpm prune --prod

# ---------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

# git reads the workstation history. Pinned to the 2.54 series of Alpine 3.24 (`~` keeps
# security rebuilds such as -r1 installable; Alpine drops superseded revisions).
# npm, npx, yarn and corepack are removed: nothing at runtime uses them, and they would only
# add attack surface and scanner findings.
#
# zlib: the base ships 1.3.2-r0 (ALPINE-CVE-2026-85091, heap buffer overflow, High), fixed
# in 1.3.2-r1. The constraint upgrades it and fails the build if the fix is unavailable.
# TEMPORARY: remove the zlib constraint once the pinned node base digest ships zlib >= 1.3.2-r1
# (checked 2026-10-17: node:24.22.0-alpine3.24 / 24-alpine still sha256:44fce696..., zlib r0).
RUN apk add --no-cache 'git~2.54' 'zlib>=1.3.2-r1' \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

WORKDIR /app

COPY --from=build --chown=root:root /app/package.json ./package.json
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
COPY --from=build --chown=root:root /app/scripts ./scripts

# Container mode (scripts/server-env.mjs): HOST is honoured, the workstation is mounted
# read-only at /workstation and polled, because fs.watch does not see changes made on a
# Windows host through a bind mount. Trusted clients are set per deployment (compose.yaml).
ENV NODE_ENV=production \
    WATCHTOWER_CONTAINER=1 \
    HOST=0.0.0.0 \
    PORT=4321 \
    WATCHTOWER_ROOT=/workstation \
    WATCHTOWER_POLL_MS=2000

ARG VERSION=0.1.0
# No remote repository exists yet. Set SOURCE to its URL once the User creates one.
ARG SOURCE="local:F:/Projects/apps/watchtower (no remote yet)"
LABEL org.opencontainers.image.title="watchtower" \
      org.opencontainers.image.description="The Watchtower: a local live dashboard of the workstation" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="${SOURCE}" \
      org.opencontainers.image.base.name="docker.io/library/node:24.22.0-alpine3.24"

USER node
EXPOSE 4321

# Node's fetch, so no curl is needed. 127.0.0.1 rather than localhost: the server binds IPv4
# only and `localhost` may resolve to ::1 first. The Host header 127.0.0.1:<PORT> must be
# allowed, which holds for the default PORT; another PORT also needs WATCHTOWER_ALLOWED_HOSTS.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "scripts/start.mjs"]
