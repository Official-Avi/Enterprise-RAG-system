import type { NextConfig } from "next";

// next.config is evaluated by `next build` and `next start`. The standalone server (the Docker
// image) embeds the values from build time, so in Docker both env vars below are build args.
const isProduction = process.env.NODE_ENV === "production";
const isDev = process.env.NODE_ENV === "development";

// The browser only ever talks to this origin; /api/* is proxied to the FastAPI backend so the
// HttpOnly session cookie stays same-origin (no CORS credentials in the browser).
const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000";

/**
 * How long the /api rewrite waits for the API to answer, in milliseconds (Next's default is 30s).
 * A slow upload or answer gets its real response instead of the proxy's plain 500.
 *
 * It must exceed the API's MODEL_TIMEOUT_SECONDS (x1000), so a slow model call fails inside the
 * API with a proper error before the proxy gives up; keep the API's WEB_PROXY_TIMEOUT_SECONDS
 * equal to this value / 1000 (the API refuses to start in production otherwise).
 */
function readProxyTimeoutMs(): number {
  const raw = process.env.API_PROXY_TIMEOUT_MS?.trim() || "120000";
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`API_PROXY_TIMEOUT_MS must be a positive whole number of milliseconds, got "${raw}"`);
  }
  // When the model timeout is visible here too (local runs, CI), refuse an ordering that turns a
  // slow answer into the proxy's bare 500.
  const modelTimeout = Number(process.env.MODEL_TIMEOUT_SECONDS?.trim() || NaN);
  if (Number.isFinite(modelTimeout) && value <= modelTimeout * 1000) {
    throw new Error(
      `API_PROXY_TIMEOUT_MS (${value}) must exceed MODEL_TIMEOUT_SECONDS x 1000 (${modelTimeout * 1000})`,
    );
  }
  return value;
}

const proxyTimeoutMs = readProxyTimeoutMs();

// Content-Security-Policy. The policy is static, not nonce-based: the landing page and most routes
// are prerendered (static by design), and a nonce needs every page rendered per request. App
// Router pages carry inline bootstrap/flight <script>s and SSR'd style="" attributes, so scripts
// and styles need 'unsafe-inline'; the policy still blocks every other origin, plugins, <base>
// hijacking, off-site form posts and framing. Dev adds 'unsafe-eval' (React's dev-only error
// stacks); production never uses eval.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // 'self' also covers the same-origin ws:// used by dev hot reload.
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Production is served over HTTPS only (the API refuses COOKIE_SECURE=false there). Browsers
  // ignore this header on plain-HTTP responses. No includeSubDomains/preload: those would bind
  // sibling hosts of whatever domain an operator deploys on.
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  // scripts/dev/start-web.ps1 builds the local prod server into .next-prod so it never collides with a
  // running dev server's .next. Unset (Docker, CI) it is the usual .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // Stops `next dev` writing a generated AGENTS.md into this folder.
  agentRules: false,
  // The dev-only "N" button sits over the sidebar footer. Build errors still show their overlay.
  devIndicators: false,
  experimental: {
    // Request bodies are buffered up to this size before the /api rewrite forwards them
    // (Next's default is 10 MB). 26mb fits the 25 MiB per-file upload limit plus multipart overhead.
    // A larger body arrives cut short, so uploaders split batches (requestGroups in lib/workspace;
    // PROXY_BODY_LIMIT_BYTES in lib/api mirrors this value).
    proxyClientMaxBodySize: "26mb",
    // API_PROXY_TIMEOUT_MS, default 120000; see readProxyTimeoutMs above.
    proxyTimeout: proxyTimeoutMs,
  },
  async redirects() {
    // The console chat moved to the /ask workspace.
    return [{ source: "/chat", destination: "/ask", permanent: true }];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiTarget}/api/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
