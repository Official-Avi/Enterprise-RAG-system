# RackFlow AI — web console

Next.js (App Router) + TypeScript + Tailwind CSS. All pages are client-rendered and call the API
through a same-origin rewrite (`/api/*` → `API_PROXY_TARGET`, default `http://127.0.0.1:8000`),
so the HttpOnly session cookie never crosses origins. State-changing requests send the
`X-RackFlow-CSRF` header.

```bash
npm ci
npm run dev        # http://localhost:3000 (API must be running on 127.0.0.1:8000)
npm run lint && npx tsc --noEmit && npm run build
```

`API_PROXY_TARGET` is read when the app is **built** (Next.js resolves rewrites at build time);
the Dockerfile sets it to `http://api:8000` for Docker Compose.

Security notes: model answers, document text and filenames are rendered as plain text only
(no `dangerouslySetInnerHTML`, no Markdown links/images); navigation hiding is cosmetic — the
API enforces every permission.
