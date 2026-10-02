import base from './vite.config.ts';

// Local-only override: forwards /api to the API server, which the Replit router
// normally handles. Without this, `vite dev`/`vite preview` fall back to serving
// index.html for /api/*, and the app crashes on a non-array response.
//
// Run with:
//   PORT=19111 BASE_PATH=/ vite --config vite.local.config.ts
//   PORT=19112 BASE_PATH=/ vite preview --config vite.local.config.ts
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8080';

const proxy = {
  '/api': {
    target: API_TARGET,
    changeOrigin: true,
  },
};

export default {
  ...base,
  server: {
    ...base.server,
    proxy,
  },
  preview: {
    ...base.preview,
    proxy,
  },
};
