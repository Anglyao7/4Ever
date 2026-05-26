# Frontend

React + Vite frontend for the aggregation platform.

## Run

```bash
npm install
npm run dev
```

The Vite dev server proxies `/api` and `/health` to `http://127.0.0.1:7778`.

The app entrypoint is `src/main.ts`, with module panels implemented as React `.tsx` files under `src/`.
