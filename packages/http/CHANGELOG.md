# Changelog

## [Unreleased]

## [0.1.0-alpha.0] - 2026-06-08

### Added

- `@Controller(prefix?, opts?)` class decorator with optional host sub-domain matching
- 8 HTTP-verb method decorators: `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`, `@All`
- 9 parameter decorators: `@Req`, `@Res`, `@Body`, `@Param`, `@Query`, `@Headers`, `@Session`, `@Ip`, `@HostParam`
- 3 response-shape decorators: `@HttpCode`, `@Header`, `@Redirect`
- `@UseGuards(...guards)` and `@UseInterceptors(...interceptors)` class/method decorators
- Bridge engine: `walkControllerMetadata()` produces structured `WalkResult[]` from decorator metadata
- `registerControllers([...])` low-level API with dedup + warn on duplicates
- `resolveDtoSchema()` for Pattern D2 (Zod `static schema` convention on DTO classes)
- `HttpDecoratorsConfigError` with actionable messages for missing `@Controller` and `emitDecoratorMetadata`
- `joinPath()` with leading/trailing slash normalization
- Metadata facade: 8 symbol keys + typed `setMeta`/`getMeta` wrappers over `reflect-metadata`
- 6 Pattern contract tests (D1-D6) verifying locked design decisions
- `theokit generate controller <name>` CLI verb extension
