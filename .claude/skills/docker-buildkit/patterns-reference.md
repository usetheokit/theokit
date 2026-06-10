# Docker BuildKit — Language-Specific Optimized Patterns

Production-grade Dockerfile patterns for each language with all BuildKit optimizations applied.

---

## Node.js (npm)

```dockerfile
# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .
RUN npm run build

# Production
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S app && adduser -S app -u 1001
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./

USER app
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Node.js with pnpm

```dockerfile
# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
RUN corepack enable pnpm
WORKDIR /app

COPY pnpm-lock.yaml package.json ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:20-alpine
RUN corepack enable pnpm
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

---

## Python

```dockerfile
# syntax=docker/dockerfile:1

FROM python:3.12-slim AS builder
WORKDIR /app

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --prefix=/install -r requirements.txt

COPY . .

# Production
FROM python:3.12-slim
WORKDIR /app

COPY --from=builder /install /usr/local
COPY --from=builder /app .

RUN adduser --disabled-password --no-create-home app
USER app

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Python with Poetry

```dockerfile
# syntax=docker/dockerfile:1

FROM python:3.12-slim AS builder
WORKDIR /app

RUN pip install poetry
COPY pyproject.toml poetry.lock ./

RUN --mount=type=cache,target=/root/.cache/pypoetry \
    poetry config virtualenvs.in-project true && \
    poetry install --no-root --no-interaction --only main

COPY . .

FROM python:3.12-slim
WORKDIR /app

COPY --from=builder /app/.venv ./.venv
COPY --from=builder /app .

ENV PATH="/app/.venv/bin:$PATH"
RUN adduser --disabled-password app
USER app

CMD ["uvicorn", "main:app", "--host", "0.0.0.0"]
```

---

## Go

```dockerfile
# syntax=docker/dockerfile:1

FROM golang:1.22 AS builder
WORKDIR /app

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/server ./cmd/server

# Minimal production image
FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/server /server

USER nonroot:nonroot
EXPOSE 8080
CMD ["/server"]
```

### Go Multi-Platform (Cross-Compilation)

```dockerfile
# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM golang:1.22 AS builder
ARG TARGETOS TARGETARCH
WORKDIR /app

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags="-s -w" -o /app/server ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/server /server
USER nonroot:nonroot
CMD ["/server"]
```

Build: `docker buildx build --platform linux/amd64,linux/arm64 -t myapp:latest --push .`

---

## Rust

```dockerfile
# syntax=docker/dockerfile:1

FROM rust:1.78 AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
# Create dummy src for dependency caching
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release && rm -rf src

COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release && \
    cp target/release/myapp /usr/local/bin/myapp

# Minimal production image
FROM gcr.io/distroless/cc-debian12
COPY --from=builder /usr/local/bin/myapp /myapp

USER nonroot:nonroot
CMD ["/myapp"]
```

---

## Java (Maven)

```dockerfile
# syntax=docker/dockerfile:1

FROM eclipse-temurin:21-jdk AS builder
WORKDIR /app

COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 \
    mvn dependency:go-offline -B

COPY src ./src
RUN --mount=type=cache,target=/root/.m2 \
    mvn package -DskipTests -B && \
    cp target/*.jar app.jar

# Production with JRE only
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

COPY --from=builder /app/app.jar .

RUN addgroup -g 1001 -S app && adduser -S app -u 1001
USER app

EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
```

---

## Bun

```dockerfile
# syntax=docker/dockerfile:1

FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

COPY . .
RUN bun run build

# Production
FROM oven/bun:1-alpine
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

USER bun
EXPOSE 3000
CMD ["bun", "run", "dist/index.js"]
```

---

## Nginx + Static Frontend

```dockerfile
# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm run build

FROM nginx:alpine
# Custom nginx config
COPY --link nginx.conf /etc/nginx/conf.d/default.conf
# Static assets (--link for independent layer)
COPY --link --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

---

## Debian/Ubuntu Base with System Deps

```dockerfile
# syntax=docker/dockerfile:1

FROM ubuntu:24.04

# System deps — cache apt for faster rebuilds
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
    && rm -rf /var/lib/apt/lists/*

# Application setup...
```

---

## Private Registry Auth (Secrets)

```dockerfile
# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json .npmrc.template ./

# Use secret .npmrc for private packages
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .
RUN npm run build
```

Build: `docker build --secret id=npmrc,src=$HOME/.npmrc .`

---

## .dockerignore Template

```gitignore
# Version control
.git
.gitignore
.gitattributes

# Dependencies (rebuilt in container)
node_modules
vendor
__pycache__
*.pyc
.venv
target/debug

# Build artifacts
dist
build
out
*.egg-info

# Environment & secrets
.env
.env.*
*.pem
*.key
*.p12
credentials*

# IDE & editor
.vscode
.idea
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Docker (don't send Dockerfile as context)
Dockerfile*
docker-compose*
.dockerignore

# CI/CD
.github
.gitlab-ci.yml
.circleci

# Documentation & tests (uncomment if not needed in build)
# *.md
# docs/
# tests/
# __tests__/
# *.test.*
# *.spec.*

# Logs & temporary
*.log
tmp/
temp/
coverage/
```

---

## Image Size Comparison

| Base Image | Size | Use Case |
|------------|------|----------|
| `ubuntu:24.04` | ~77MB | Full OS, system packages |
| `debian:bookworm-slim` | ~74MB | Slimmer Debian |
| `alpine:3.21` | ~5MB | Minimal, musl libc |
| `node:20` | ~1.1GB | Full Node + Debian |
| `node:20-slim` | ~200MB | Node + minimal Debian |
| `node:20-alpine` | ~130MB | Node + Alpine |
| `python:3.12` | ~1GB | Full Python + Debian |
| `python:3.12-slim` | ~150MB | Python + minimal Debian |
| `python:3.12-alpine` | ~55MB | Python + Alpine |
| `golang:1.22` | ~800MB | Full Go (build only) |
| `gcr.io/distroless/static` | ~2MB | Static binaries only |
| `gcr.io/distroless/base` | ~20MB | Glibc, libssl |
| `gcr.io/distroless/cc` | ~25MB | libstdc++ |
| `scratch` | 0MB | Empty (static binaries) |
