# Architecture

Source of Truth for boundaries, dependency direction, and module layout. Stack-agnostic.

## § 1 — Layered boundaries

Default layering, from outermost (depends inward) to innermost (depends on nothing):

```
interface (CLI, HTTP, RPC, event consumer)
      ↓
application (use cases / orchestration)
      ↓
domain (entities, value objects, business rules, interfaces)
      ↑
infrastructure (adapters: DB, external APIs, queues, filesystem)
```

- **Inner layers MUST NOT import outer layers.** Domain knows nothing about HTTP, ORMs, or message brokers.
- **Adapters implement domain interfaces.** The domain defines the contract; the adapter satisfies it.
- **Composition root is at the top** (e.g., `cmd/`, `main.*`, application entrypoint). All wiring of concretes into interfaces happens there — never deep inside business code.

## § 2 — Dependency Inversion (DIP)

When the domain needs an external capability (persistence, messaging, file I/O, time, randomness), it declares an **interface** in the domain layer. The adapter implements it.

Anti-patterns:
- Domain code importing a concrete database driver, HTTP client, or cloud SDK directly.
- Adapters importing each other across feature boundaries (cross-adapter wiring belongs at the composition root).
- Service locator / global singletons resolving dependencies at runtime instead of constructor injection.

## § 3 — Module cohesion

A module/package should answer one question: "what is this responsible for?" If the answer needs an "and", it's two modules.

Heuristics:
- Files in the same package should change for the same reason (SRP at package level).
- Cross-cutting concerns (logging, tracing, metrics) live in dedicated modules, not sprinkled into business code.
- Public API (exported names) of a package is the contract — minimize it. Everything else is internal.

## § 4 — Boundary enforcement

Code review enforces architectural boundaries. Some checks can be automated (import linters, dependency-direction tests); none are project-agnostic enough to ship here. When a project adopts this template, add a project-specific section below describing **its** layer names, prohibited import directions, and the tool used to enforce them.

## § 5 — Folder vs. package layout

Two valid styles:
- **Package by layer** — top-level dirs for `domain`, `application`, `infrastructure`, `interface`. Works when the project is small or strongly layered.
- **Package by feature** — top-level dirs for `users`, `billing`, `inventory`, each with its own internal layering. Scales better.

Pick one per project. Mixing both creates inconsistency.

## § 6 — Anti-patterns

- **God modules** named `utils`, `helpers`, `common`, `misc`, `shared` — these accumulate unrelated code. Be specific.
- **Premature abstraction** — interfaces with a single implementer and no foreseeable second one. Wait for the second case.
- **Anaemic domain** — entities reduced to data bags with all logic in services. Logic that operates on an entity's invariants belongs on the entity.
- **Leaky abstractions** — adapters returning ORM-specific or driver-specific types from interfaces meant to be portable.
