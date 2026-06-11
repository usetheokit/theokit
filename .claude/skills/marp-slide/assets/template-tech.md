---
marp: true
theme: uncover
paginate: true
---

<style>
/* Tech Theme — Theo Brand Dark Mode */
section {
  background-color: #0d1117;
  color: #c9d1d9;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 24px;
  padding: 50px 60px;
}

h1 {
  color: #a855f7;
  font-size: 38px;
  font-weight: 700;
  margin-bottom: 24px;
}

h1::before {
  content: "# ";
  color: #484f58;
}

h2 {
  color: #c4b5fd;
  font-size: 30px;
  font-weight: 600;
  margin-bottom: 20px;
}

h2::before {
  content: "## ";
  color: #484f58;
}

h3 {
  color: #d2a8ff;
  font-size: 26px;
  font-weight: 600;
}

ul, ol {
  margin-left: 10px;
  line-height: 1.9;
}

li {
  margin-bottom: 6px;
}

li::marker {
  color: #a855f7;
}

code {
  background-color: #161b22;
  color: #c4b5fd;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 22px;
  border: 1px solid #30363d;
}

pre {
  background-color: #161b22;
  color: #c9d1d9;
  padding: 20px;
  border-radius: 8px;
  border: 1px solid #30363d;
  font-size: 20px;
}

pre code {
  border: none;
  padding: 0;
  font-size: 20px;
}

blockquote {
  border-left: 3px solid #a855f7;
  padding-left: 16px;
  color: #8b949e;
  font-style: normal;
  font-size: 22px;
}

table {
  width: 100%;
  border-collapse: collapse;
  border-spacing: 0;
  font-size: 21px;
  table-layout: fixed;
}

th, td {
  text-align: left;
  vertical-align: top;
  padding: 10px 14px;
  box-sizing: border-box;
}

th {
  background-color: #161b22;
  color: #a855f7;
  font-weight: 600;
  border-bottom: 2px solid #30363d;
}

td {
  border-bottom: 1px solid #21262d;
}

a {
  color: #a855f7;
}

strong {
  color: #fbbf24;
}

em {
  color: #d2a8ff;
}

section.lead {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  background-color: #0d1117;
}

section.lead h1 {
  font-size: 48px;
  color: #a855f7;
}

section.lead h1::before {
  content: "";
}

section.lead h2 {
  color: #c4b5fd;
  font-weight: 400;
}

section.lead h2::before {
  content: "";
}

footer {
  color: #484f58;
  font-size: 14px;
  font-family: 'JetBrains Mono', monospace;
}

/* Accent box for diagrams and highlighted content */
.accent-box {
  background-color: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 16px;
  margin: 12px 0;
}
</style>

<!-- _class: lead -->

# Project Name

## `v1.0.0` — Technical Overview

---

# Architecture

- **API Layer** — REST endpoints with validation
- **Service Layer** — business logic, isolated from I/O
- **Repository Layer** — database abstraction via interfaces
- Event-driven communication between bounded contexts

---

# Code Example

```python
@app.post("/api/v1/users")
async def create_user(req: CreateUserRequest) -> UserResponse:
    user = user_service.create(req.to_domain())
    return UserResponse.from_domain(user)
```

- Clean separation of concerns
- Domain types at the boundary

---

# Performance

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| p50 latency | 120ms | 18ms | **85%** |
| p99 latency | 890ms | 95ms | **89%** |
| Throughput | 2.1k rps | 14k rps | **6.7x** |

---

<!-- _class: lead -->

# Questions?

`github.com/org/project`
