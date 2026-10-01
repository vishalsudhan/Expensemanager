---
name: Drizzle PostgreSQL error wrapping
description: Mapping PostgreSQL constraint failures to API responses when Drizzle wraps the driver error.
---

When handling PostgreSQL constraint failures in API routes, inspect the nested `cause` chain for the driver's error code. Drizzle may wrap a unique-constraint error so the top-level exception does not expose `code`.

**Why:** A duplicate project name initially surfaced as a 500 because the route only checked the top-level error; the PostgreSQL `23505` code was nested.

**How to apply:** Use bounded cause-chain inspection when translating database constraint errors into expected HTTP responses such as 409.