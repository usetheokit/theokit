---
name: docker-buildkit
description: >
  Docker BuildKit optimization expert. Use when writing Dockerfiles, optimizing build performance,
  configuring cache backends, multi-stage builds, multi-platform builds, secret management,
  cache mounts, .dockerignore, buildx drivers, garbage collection, CI/CD cache strategies,
  or reducing Docker image size. Covers BuildKit, buildx, Dockerfile best practices,
  layer optimization, and production-grade container builds.
when_to_use: >
  User mentions Dockerfile, Docker build, BuildKit, buildx, docker build, multi-stage build,
  cache mount, RUN --mount, docker buildx, multi-platform build, .dockerignore, image size
  optimization, Docker layer caching, CI/CD Docker cache, container security, distroless,
  build secrets, COPY --link, docker-container driver, build cache, bun build docker,
  node docker, python docker, go docker, rust docker
allowed-tools: Read Grep Glob Bash(docker *) Bash(docker-compose *) Bash(hadolint *)
---

# Docker BuildKit — Optimized Build Reference

You are an expert in Docker BuildKit and container image optimization. Use this reference to
write production-grade Dockerfiles, configure caching, optimize build performance, and secure
the image supply chain.

Always use BuildKit syntax (`# syntax=docker/dockerfile:1`). Prefer multi-stage builds.
Optimize layer ordering (least-changing first). Never store secrets in layers.

For detailed reference, consult:
- [dockerfile-reference.md](dockerfile-reference.md) — RUN --mount, COPY --link, HERE-docs, ARGs
- [cache-reference.md](cache-reference.md) — Cache backends, GC, CI/CD strategies
- [patterns-reference.md](patterns-reference.md) — Language-specific optimized Dockerfiles

---

## Quick Reference

```dockerfile
# syntax=docker/dockerfile:1

# === BUILD STAGE ===
FROM node:20-alpine AS builder
WORKDIR /app

# 1. Copy dependency manifests first (cache-friendly)
COPY package.json package-lock.json ./

# 2. Install with cache mount (not stored in image)
RUN --mount=type=cache,target=/root/.npm \
    npm ci --production

# 3. Copy source and build
COPY . .
RUN npm run build

# === PRODUCTION STAGE ===
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

## BuildKit Core Concepts

BuildKit is Docker's modern build engine (default since Docker Desktop & Engine).

| Feature | Description |
|---------|-------------|
| **Parallel execution** | Independent stages build concurrently |
| **LLB graph** | Content-addressable dependency graph (not sequential) |
| **Smart caching** | Checksum-based, skips unchanged files |
| **Unused stage skip** | Only builds stages needed for target |
| **Incremental context** | Transfers only changed files between builds |
| **Mount types** | cache, bind, secret, ssh, tmpfs |

Enable: `export DOCKER_BUILDKIT=1` or in `daemon.json`: `{ "features": { "buildkit": true } }`

---

## The 8 Optimization Techniques

### 1. Layer Ordering Strategy

Cache invalidation cascades — when a layer changes, ALL subsequent layers rebuild.

```dockerfile
# BAD — any source change reinstalls deps
COPY . .
RUN npm install

# GOOD — deps only reinstall when manifests change
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
```

**Rule:** Place least-changing instructions at the top.

### 2. Cache Mounts (RUN --mount=type=cache)

Mount a persistent cache directory during build. Not stored in final image. Reused across builds.

```dockerfile
# Node.js
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Python
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

# Go
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go build -o /app ./...

# Rust
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release

# apt
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get update && apt-get install -y curl
```

Sharing modes: `sharing=shared` (default, concurrent), `private` (new per writer), `locked` (sequential).

### 3. Multi-Stage Builds

Separate build from runtime. Only final stage goes to production.

```dockerfile
FROM golang:1.22 AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /app/server

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/server /server
CMD ["/server"]
```

Benefits: smaller image, reduced attack surface, faster deploys.

Target specific stage: `docker build --target builder -t myapp:debug .`

### 4. Secret Management

NEVER store secrets in layers, ARGs, or ENV.

```dockerfile
# SECURE — secret only available during this RUN
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci

# As environment variable
RUN --mount=type=secret,id=api_key,env=API_KEY \
    curl -H "Authorization: $API_KEY" https://api.example.com

# SSH agent forwarding
RUN --mount=type=ssh \
    git clone git@github.com:org/private-repo.git
```

Build commands:
```bash
docker build --secret id=npmrc,src=$HOME/.npmrc .
docker build --secret id=api_key,src=./secret.txt .
docker build --ssh default .
```

### 5. CI/CD Cache Export/Import

```bash
# Inline cache (embedded in image metadata)
docker buildx build \
  --cache-to type=inline \
  --push -t myapp:latest .

# Registry cache (separate image)
docker buildx build \
  --cache-to type=registry,ref=registry.io/myapp:cache,mode=max \
  --cache-from type=registry,ref=registry.io/myapp:cache \
  --push -t myapp:latest .

# Local cache (CI filesystem)
docker buildx build \
  --cache-to type=local,dest=/tmp/buildcache \
  --cache-from type=local,src=/tmp/buildcache \
  -t myapp:latest .

# GitHub Actions cache
docker buildx build \
  --cache-to type=gha,mode=max \
  --cache-from type=gha \
  -t myapp:latest .

# Multi-branch strategy
docker buildx build \
  --cache-from type=registry,ref=registry.io/cache:$BRANCH \
  --cache-from type=registry,ref=registry.io/cache:main \
  --cache-to type=registry,ref=registry.io/cache:$BRANCH \
  -t myapp:latest .
```

Cache modes: `mode=min` (only exported layers, smaller), `mode=max` (all layers, more hits).

### 6. Multi-Platform Builds

```bash
# Build for multiple architectures
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t myapp:multiarch \
  --push .
```

Three strategies:
1. **QEMU emulation** — easy but slow for compilation
2. **Multiple native nodes** — fast, real hardware
3. **Cross-compilation** — best for compiled languages

```dockerfile
# Cross-compilation pattern (Go)
FROM --platform=$BUILDPLATFORM golang:1.22 AS builder
ARG TARGETOS TARGETARCH
WORKDIR /app
COPY . .
RUN GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -o /app/server

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/server /server
```

Platform ARGs (auto-provided): `BUILDPLATFORM`, `BUILDOS`, `BUILDARCH`, `TARGETPLATFORM`, `TARGETOS`, `TARGETARCH`, `TARGETVARIANT`.

### 7. .dockerignore

Reduces build context size → faster builds.

```gitignore
# VCS
.git
.gitignore

# Dependencies (rebuilt in container)
node_modules
vendor
__pycache__
target

# Build artifacts
dist
build
*.egg-info

# Environment & secrets
.env
.env.*
*.pem
*.key

# IDE & OS
.vscode
.idea
*.swp
.DS_Store
Thumbs.db

# Docker
Dockerfile*
docker-compose*
.dockerignore

# Docs & tests (if not needed)
*.md
docs/
tests/
__tests__/
```

### 8. Layer Reduction & Cleanup

```dockerfile
# BAD — 3 layers, apt cache retained
RUN apt-get update
RUN apt-get install -y curl git
RUN rm -rf /var/lib/apt/lists/*

# GOOD — 1 layer, cache cleaned
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl \
      git \
    && rm -rf /var/lib/apt/lists/*
```

---

## COPY --link (BuildKit)

Copies as independent layers — prior layer changes don't invalidate cache.

```dockerfile
FROM nginx:alpine
COPY --link --from=builder /app/dist /usr/share/nginx/html
```

---

## Buildx Drivers

| Driver | Multi-arch | Cache export | Tarball | Config |
|--------|-----------|-------------|---------|--------|
| `docker` (default) | No | Limited | No | No |
| `docker-container` | Yes | Yes | Yes | Yes |
| `kubernetes` | Yes | Yes | Yes | Yes |
| `remote` | Yes | Yes | Yes | External |

```bash
# Create builder with docker-container driver
docker buildx create --name mybuilder --driver docker-container --use
docker buildx inspect --bootstrap

# Multi-node builder
docker buildx create --name multi --platform linux/amd64 --node amd64-node
docker buildx create --name multi --append --platform linux/arm64 --node arm64-node
```

---

## Garbage Collection

Default daemon.json:
```json
{
  "builder": {
    "gc": {
      "enabled": true,
      "defaultKeepStorage": "20GB"
    }
  }
}
```

BuildKit GC policies (ordered):
1. Remove ephemeral cache (contexts, git, cache mounts) unused >48h
2. Remove cache unused >60 days
3. Remove unshared blobs over size limit
4. Remove any cache over size limit

Manual cleanup: `docker builder prune`, `docker builder prune --all`

---

## Cache Invalidation Rules

| Instruction | Invalidation trigger |
|-------------|---------------------|
| `FROM` | Base image digest change |
| `COPY` / `ADD` | File content checksum (NOT mtime) |
| `RUN` | Command string change |
| `RUN --mount=type=bind` | Mounted file content change |
| `ARG` | Argument value change |
| `ENV` | Value change |

**Key insight:** File modification time (mtime) is NOT checked. Only content checksums matter.

Force cache bust: `--no-cache`, `--no-cache-filter=stage`, or `docker builder prune`

---

## Base Image Selection

| Need | Recommended |
|------|-------------|
| Minimal size | `alpine` (<6MB), `distroless` |
| Node.js | `node:20-alpine` or `node:20-slim` |
| Python | `python:3.12-slim` |
| Go | `golang:1.22` build → `distroless/static` run |
| Rust | `rust:1.78` build → `distroless/cc` or `scratch` run |
| Java | `eclipse-temurin:21-jre-alpine` |
| Security | Pin digest: `FROM alpine:3.21@sha256:abc123...` |

---

## Security Checklist

- [ ] Use `# syntax=docker/dockerfile:1` (latest stable)
- [ ] Multi-stage builds (no build tools in production)
- [ ] `--mount=type=secret` for credentials (never ARG/ENV)
- [ ] Non-root user: `USER nonroot` or `USER 1000:1000`
- [ ] Pin base image digests for supply chain security
- [ ] `--no-install-recommends` for apt
- [ ] Remove package caches in same layer
- [ ] Scan with `docker scout`, `trivy`, or `snyk`
- [ ] Regular rebuilds: `docker build --pull --no-cache`
- [ ] `.dockerignore` excludes `.env`, secrets, `.git`
