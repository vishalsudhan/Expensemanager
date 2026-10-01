---
name: Vite HMR in preview captures
description: Interpreting HMR WebSocket warnings from static screenshots of a running proxied Vite app.
---

An app-preview screenshot can show a failed Vite HMR WebSocket handshake to the proxy or container port even when the page renders and its API requests succeed. Treat that warning separately from application runtime failures.

A service worker that caches every same-origin GET can also serve stale Vite modules after a workflow restart because development modules use stable URLs. Exclude Vite's development module paths from service-worker caching and bump the cache version to evict existing stale entries.

**Why:** Project list and detail screenshots rendered with live data after the Vite workflow restarted, while the screenshot browser still reported HMR WebSocket handshake failures. In the expense manager, a service worker also kept old `/src/` modules visible until its cache was invalidated.

**How to apply:** Check the running workflow, page rendering, API responses, and non-HMR console errors before changing HMR or proxy configuration solely to silence a screenshot-capture warning. For Vite dev previews, ensure the service worker bypasses `/src/`, `/@vite/`, `/@id/`, `/@fs/`, `/@react-refresh`, and `/node_modules/.vite/`.