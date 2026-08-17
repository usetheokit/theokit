# SOLID — Default Engineering Principles (FALLBACK)

This is fallback content. If `.claude/rules/architecture.md` (or similar) exists in the project, it wins.

## Single Responsibility Principle (SRP)

Each module, class, or function has ONE reason to change. If you need "and" to describe what something does, it probably does too much.

**Plan implications:** A task that touches >5 files in unrelated areas violates SRP. Split into multiple tasks.

## Open/Closed Principle (OCP)

Software entities should be open for extension, closed for modification. New behavior should be addable without changing existing code (where reasonable).

**Plan implications:** ADRs that propose changing a public API across many consumers should justify why extension via new API is not viable.

## Liskov Substitution Principle (LSP)

Subtypes must be substitutable for their base types without breaking correctness.

**Plan implications:** Tasks that introduce new implementations of a trait/interface MUST include tests proving substitution holds.

## Interface Segregation Principle (ISP)

Clients should not depend on interfaces they don't use. Prefer many small focused interfaces over one large general interface.

**Plan implications:** New traits/interfaces with > ~5 methods are smell. Justify or split.

## Dependency Inversion Principle (DIP)

Depend on abstractions, not on concrete implementations. High-level modules should not depend on low-level modules.

**Plan implications:** ADRs introducing direct dependencies between layers (e.g., a domain crate importing an infra crate) MUST justify the violation or refactor.

## How `/plan-confidence` checks SOLID compliance

Soft check (not enforced as hard cap):
- Tasks editing > 5 files in disparate areas → flag SRP concern
- ADRs without alternatives considered → likely OCP/DIP gap

Plans MAY explicitly cite SOLID principles in ADR Rationale to demonstrate consideration.
