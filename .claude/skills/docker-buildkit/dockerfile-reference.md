# Dockerfile BuildKit Reference — Mounts, COPY, HERE-docs, ARGs

## Syntax Directive

Always use at the top of Dockerfile:

```dockerfile
# syntax=docker/dockerfile:1
```

Pulls latest stable Dockerfile frontend. Enables all BuildKit features.

Other directives:
```dockerfile
# escape=`             # Windows-friendly escape char
# check=skip=all       # skip all lint checks
# check=error=true     # treat warnings as errors
```

---

## RUN --mount Options

### type=cache — Persistent Build Cache

```dockerfile
RUN --mount=type=cache,target=<path>[,options] <command>
```

| Option | Default | Description |
|--------|---------|-------------|
| `target` | required | Mount path in container |
| `id` | `target` value | Cache identifier (share across stages) |
| `sharing` | `shared` | `shared` (concurrent), `private` (copy per writer), `locked` (sequential) |
| `readonly` | `false` | Read-only access |
| `from` | — | Stage or context to use as cache source |
| `source` | — | Path in `from` to mount |
| `mode` | `0755` | Permission mode |
| `uid` | `0` | Owner UID |
| `gid` | `0` | Owner GID |

**Language-specific cache targets:**

| Language | Cache target |
|----------|-------------|
| Node.js (npm) | `/root/.npm` |
| Node.js (yarn) | `/usr/local/share/.cache/yarn` |
| Node.js (pnpm) | `/root/.local/share/pnpm/store` |
| Python (pip) | `/root/.cache/pip` |
| Go (build) | `/root/.cache/go-build` |
| Go (modules) | `/go/pkg/mod` |
| Rust (cargo) | `/usr/local/cargo/registry` |
| Rust (build) | `/app/target` |
| Java (Maven) | `/root/.m2` |
| Java (Gradle) | `/root/.gradle` |
| Ruby (bundler) | `/usr/local/bundle` |
| PHP (Composer) | `/root/.composer/cache` |
| apt | `/var/cache/apt`, `/var/lib/apt` |
| apk | `/var/cache/apk` |

### type=bind — Read-only Filesystem Access

```dockerfile
RUN --mount=type=bind,source=<src>,target=<dst>[,from=<stage>] <command>
```

Mounts files from build context or another stage. Default: read-only. Read-write available but changes discarded after RUN.

```dockerfile
# Bind from build context
RUN --mount=type=bind,source=package.json,target=/tmp/package.json \
    cat /tmp/package.json

# Bind from another stage
RUN --mount=type=bind,from=builder,source=/app/config,target=/config \
    cp /config/app.yaml /etc/app.yaml
```

### type=secret — Secure Credentials

```dockerfile
RUN --mount=type=secret,id=<id>[,target=<path>|,env=<VAR>][,required=true] <command>
```

| Option | Default | Description |
|--------|---------|-------------|
| `id` | required | Secret identifier |
| `target` | `/run/secrets/<id>` | Mount path (file mode) |
| `env` | — | Environment variable name (env mode) |
| `required` | `false` | Fail if secret not provided |
| `mode` | `0400` | File permission |
| `uid` | `0` | Owner UID |
| `gid` | `0` | Owner GID |

```dockerfile
# As file (default)
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci

# As environment variable
RUN --mount=type=secret,id=db_password,env=DATABASE_PASSWORD \
    python manage.py migrate

# Required (fail if missing)
RUN --mount=type=secret,id=api_key,required=true,env=API_KEY \
    ./deploy.sh
```

Build: `docker build --secret id=npmrc,src=$HOME/.npmrc .`

### type=ssh — SSH Agent Forwarding

```dockerfile
RUN --mount=type=ssh[,id=<id>][,required=true] <command>
```

```dockerfile
RUN --mount=type=ssh \
    git clone git@github.com:org/private-repo.git

# Multiple SSH keys
RUN --mount=type=ssh,id=deploy_key \
    git clone git@github.com:org/another-repo.git
```

Build:
```bash
docker build --ssh default .
docker build --ssh deploy_key=$HOME/.ssh/deploy_key .
```

### type=tmpfs — Temporary Filesystem

```dockerfile
RUN --mount=type=tmpfs,target=/tmp[,size=<bytes>] <command>
```

In-memory filesystem, automatically cleaned. Useful for build-time temp files.

---

## COPY Enhancements

### COPY --link

Creates independent layer — cache NOT invalidated by prior layer changes.

```dockerfile
FROM nginx:alpine
COPY --link dist/ /usr/share/nginx/html/
COPY --link --from=builder /app/output /app/
```

**When to use:** Always for COPY in final stages. Dramatically improves cache reuse.

### COPY --from

Copy from named stages, stage index, or external images:

```dockerfile
COPY --from=builder /app/dist ./dist
COPY --from=0 /app/output ./output
COPY --from=nginx:alpine /etc/nginx/nginx.conf /etc/nginx/
```

### COPY --parents

Preserve directory structure:

```dockerfile
COPY --parents ./src/*/config.json /app/
# Result: /app/src/moduleA/config.json, /app/src/moduleB/config.json
```

### COPY --exclude

Filter files during copy:

```dockerfile
COPY --exclude=*.test.ts --exclude=__tests__ ./src /app/src
```

---

## HERE-Documents

Multi-line commands with heredoc syntax:

```dockerfile
# Shell heredoc
RUN <<EOF
apt-get update
apt-get install -y curl git
rm -rf /var/lib/apt/lists/*
EOF

# Multiple heredocs
RUN <<INSTALL && <<CONFIG
apt-get update && apt-get install -y nginx
INSTALL
cat > /etc/nginx/conf.d/default.conf <<'NGINX'
server { listen 80; }
NGINX
CONFIG

# Non-shell (create file)
COPY <<EOF /app/config.json
{
  "port": 3000,
  "env": "production"
}
EOF
```

---

## Platform ARGs (Auto-Provided by BuildKit)

| ARG | Example Value | Description |
|-----|--------------|-------------|
| `BUILDPLATFORM` | `linux/amd64` | Builder's platform |
| `BUILDOS` | `linux` | Builder's OS |
| `BUILDARCH` | `amd64` | Builder's architecture |
| `BUILDVARIANT` | — | Builder's variant |
| `TARGETPLATFORM` | `linux/arm64` | Target platform |
| `TARGETOS` | `linux` | Target OS |
| `TARGETARCH` | `arm64` | Target architecture |
| `TARGETVARIANT` | `v8` | Target variant (e.g., ARM) |

Usage in cross-compilation:

```dockerfile
FROM --platform=$BUILDPLATFORM golang:1.22 AS builder
ARG TARGETOS TARGETARCH
RUN GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -o /app/server
```

---

## Build Context

### Types

```bash
# Local directory
docker build .

# Git repository
docker build https://github.com/user/repo.git#branch:subdir

# Remote tarball
docker build https://example.com/project.tar.gz

# Stdin
docker build - < Dockerfile
cat Dockerfile | docker build -

# Named contexts
docker build --build-context mylibs=./libs .
docker build --build-context alpine=docker-image://alpine:edge .
```

### Using Named Contexts in Dockerfile

```dockerfile
# Mount from named context
RUN --mount=from=mylibs,target=/libs ls /libs

# COPY from named context
COPY --from=mylibs /src /app/libs
```

---

## Best Practices Summary

1. **Always** use `# syntax=docker/dockerfile:1`
2. **COPY --link** in final stages for better cache
3. **Cache mounts** for package managers (npm, pip, go, cargo, apt)
4. **Multi-stage** to separate build from runtime
5. **Secrets via --mount=type=secret**, never ARG/ENV/COPY
6. **Pin base images** with digest for reproducibility
7. **Non-root USER** in production stage
8. **HERE-docs** for readability in complex RUN
9. **--no-install-recommends** and clean caches in same RUN layer
10. **COPY manifests before source** for dependency caching
