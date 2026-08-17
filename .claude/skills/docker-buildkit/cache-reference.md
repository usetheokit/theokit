# Docker BuildKit Cache Reference — Backends, GC, CI/CD Strategies

## Cache Backends

### Inline Cache

Embeds cache metadata into the image itself. Simplest option.

```bash
# Export
docker buildx build \
  --cache-to type=inline \
  --push -t myapp:latest .

# Import
docker buildx build \
  --cache-from type=inline,ref=myapp:latest \
  -t myapp:latest .
```

**Limitations:** Only caches exported layers (no intermediate). Available with default `docker` driver.

### Registry Cache

Stores cache as separate image in registry. More flexible than inline.

```bash
# Export (mode=max caches ALL layers including intermediate)
docker buildx build \
  --cache-to type=registry,ref=registry.io/myapp:cache,mode=max \
  --cache-from type=registry,ref=registry.io/myapp:cache \
  --push -t myapp:latest .

# Options
--cache-to type=registry,ref=<image>,mode=max,compression=zstd,oci-mediatypes=true
```

| Option | Values | Description |
|--------|--------|-------------|
| `ref` | image reference | Cache image location |
| `mode` | `min` (default), `max` | min=exported layers only, max=all layers |
| `compression` | `gzip`, `zstd`, `estargz` | Compression algorithm |
| `oci-mediatypes` | `true`/`false` | Use OCI media types |
| `image-manifest` | `true` (default since v0.21) | Single manifest (for ECR compat) |

### Local Cache

Writes cache to local filesystem directory.

```bash
docker buildx build \
  --cache-to type=local,dest=/tmp/buildcache,mode=max \
  --cache-from type=local,src=/tmp/buildcache \
  -t myapp:latest .
```

Good for: local development, CI with persistent storage.

### GitHub Actions Cache (gha)

Uses GitHub Actions cache service. Beta.

```bash
docker buildx build \
  --cache-to type=gha,mode=max,scope=$GITHUB_REF_NAME \
  --cache-from type=gha,scope=$GITHUB_REF_NAME \
  --cache-from type=gha,scope=main \
  -t myapp:latest .
```

Requires: `ACTIONS_CACHE_URL` and `ACTIONS_RUNTIME_TOKEN` environment variables (automatically available in GitHub Actions).

### S3 Cache

Uploads to AWS S3 bucket. Requires `docker-container` or `remote` driver.

```bash
docker buildx build \
  --cache-to type=s3,region=us-east-1,bucket=my-cache,name=myapp \
  --cache-from type=s3,region=us-east-1,bucket=my-cache,name=myapp \
  -t myapp:latest .
```

### Azure Blob Storage Cache

Uploads to Azure Blob Storage. Requires `docker-container` or `remote` driver.

```bash
docker buildx build \
  --cache-to type=azblob,account_url=https://myaccount.blob.core.windows.net,name=myapp \
  --cache-from type=azblob,account_url=https://myaccount.blob.core.windows.net,name=myapp \
  -t myapp:latest .
```

---

## Cache Mode Comparison

| Mode | What's cached | Size | Cache hits | Use case |
|------|--------------|------|-----------|----------|
| `min` | Only exported layers | Smaller | Fewer | Production images |
| `max` | All layers including intermediate | Larger | More | CI/CD, multi-stage builds |

**Recommendation:** Use `mode=max` in CI/CD for maximum cache hits.

---

## CI/CD Cache Strategies

### GitHub Actions

```yaml
# .github/workflows/build.yml
name: Build
on: push

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and Push
        uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### Multi-Branch Cache Strategy

```bash
# Feature branch: read from branch cache + main fallback
docker buildx build \
  --cache-from type=registry,ref=reg.io/cache:$BRANCH \
  --cache-from type=registry,ref=reg.io/cache:main \
  --cache-to type=registry,ref=reg.io/cache:$BRANCH \
  --push -t myapp:$BRANCH .

# Main branch: build and update main cache
docker buildx build \
  --cache-from type=registry,ref=reg.io/cache:main \
  --cache-to type=registry,ref=reg.io/cache:main,mode=max \
  --push -t myapp:latest .
```

### GitLab CI

```yaml
build:
  image: docker:latest
  services:
    - docker:dind
  variables:
    DOCKER_BUILDKIT: 1
  script:
    - docker buildx create --use
    - docker buildx build
        --cache-from type=registry,ref=$CI_REGISTRY_IMAGE:cache
        --cache-to type=registry,ref=$CI_REGISTRY_IMAGE:cache,mode=max
        --push -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
```

---

## Garbage Collection Configuration

### Docker Daemon (daemon.json)

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

### BuildKit Daemon (buildkitd.toml)

```toml
[worker.oci]
  # Minimum cache protected from GC
  gc = true
  gckeepStorage = "10GB"        # reservedSpace equivalent

# Custom GC policies (evaluated in order)
[[worker.oci.gcpolicy]]
  # Remove ephemeral cache (contexts, git checkouts, cache mounts) >48h
  filters = ["type==source.local", "type==source.git.checkout", "type==exec.cachemount"]
  keepDuration = "48h"
  keepBytes = 1073741824  # 1GB

[[worker.oci.gcpolicy]]
  # Remove old cache >60 days
  keepDuration = "1440h"
  keepBytes = 10737418240  # 10GB

[[worker.oci.gcpolicy]]
  # Remove unshared layers when over limit
  all = false
  keepBytes = 21474836480  # 20GB

[[worker.oci.gcpolicy]]
  # Remove anything when over limit
  all = true
  keepBytes = 21474836480  # 20GB
```

### BuildKit GC Thresholds

| Parameter | Default | Description |
|-----------|---------|-------------|
| `reservedSpace` | 10% disk or 10GB (lower) | Minimum protected cache |
| `maxUsedSpace` | 60% disk or 100GB (lower) | Trigger cleanup above this |
| `minFreeSpace` | 20GB | Required free disk space |

### Manual Cache Management

```bash
# Prune build cache (interactive)
docker builder prune

# Prune all build cache (no confirmation)
docker builder prune --all --force

# Prune with filter
docker builder prune --filter until=24h

# View cache usage
docker buildx du

# System-wide cleanup
docker system prune --all --volumes
```

---

## Cache Debugging

```bash
# Show cache usage per builder
docker buildx du --verbose

# Build with progress output showing cache hits
docker buildx build --progress=plain .

# Force no cache
docker build --no-cache .

# No cache for specific stage only
docker build --no-cache-filter=builder .

# Pull fresh base images
docker build --pull .

# Maximum rebuild (fresh base + no cache)
docker build --pull --no-cache .
```
