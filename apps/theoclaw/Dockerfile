# TheoClaw's image (B-374, OC-33). Build from the repository root:
#
#   docker build -f apps/theoclaw/Dockerfile -t theoclaw .
#
# BuildKit reads apps/theoclaw/Dockerfile.dockerignore in place of the root .dockerignore, which
# leaves out the nested node_modules, the builds and every environment file of the checkout.

FROM node:22-bookworm-slim AS builder
WORKDIR /repo
# Root may write Node's global bin, and scripts/live-model-build.mjs spawns a bare `pnpm`.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
COPY . /repo
RUN pnpm install --frozen-lockfile --filter 'theoclaw...' \
  && node scripts/live-model-build.mjs theoclaw

# The whole built workspace moves. The package manager's deploy command refuses this workspace
# (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE), and the node_modules links are relative, so they
# resolve under /app as they did under /repo.
FROM node:22-bookworm-slim
COPY --from=builder /repo /app
# Every write goes under /data, which the person mounts and owns: the environment wins over the
# configuration file, so a file onboarded on the host cannot point the workspace at a host path.
ENV THEOCLAW_HOST=0.0.0.0 \
  THEOCLAW_PUBLIC_BIND=yes \
  THEOCLAW_STATE_DIR=/data/state \
  THEOCLAW_CONFIG=/data/theoclaw.env \
  THEOKIT_HOME=/data/theokit \
  THEOCLAW_WORKSPACE=/data/work
USER node
VOLUME /data
EXPOSE 8787
CMD ["sh", "-c", "mkdir -p /data/work && cd /data/work && exec node /app/apps/theoclaw/dist/main.js"]
