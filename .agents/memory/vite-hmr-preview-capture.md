---
name: Vite HMR in preview captures
description: Interpreting HMR WebSocket warnings from static screenshots of a running proxied Vite app.
---

An app-preview screenshot can show a failed Vite HMR WebSocket handshake to the proxy or container port even when the page renders and its API requests succeed. Treat that warning separately from application runtime failures.

**Why:** Project list and detail screenshots rendered with live data after the Vite workflow restarted, while the screenshot browser still reported HMR WebSocket handshake failures.

**How to apply:** Check the running workflow, page rendering, API responses, and non-HMR console errors before changing HMR or proxy configuration solely to silence a screenshot-capture warning.