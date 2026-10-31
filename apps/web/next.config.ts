import type { NextConfig } from "next";

// The browser only ever talks to this origin; /api/* is proxied to the FastAPI backend so the
// HttpOnly session cookie stays same-origin (no CORS credentials in the browser).
const apiTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    // Request bodies are buffered up to this size before the /api rewrite forwards them
    // (Next's default is 10 MB). 26mb fits the 25 MiB per-file upload limit plus multipart overhead.
    proxyClientMaxBodySize: "26mb",
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
