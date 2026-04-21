import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  /** Minimal Node server bundle for Docker / Railway (FastAPI on 127.0.0.1:8000, proxied via rewrites). */
  output: "standalone",
  /** Silence multi-lockfile warning; must be cwd (where you run `npm run dev`), not `import.meta.url`. */
  outputFileTracingRoot: path.resolve(process.cwd()),
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  env: {
    /** Docker/Railway unified image: leave empty for same-origin ``/api``. Local dev default: direct FastAPI. */
    NEXT_PUBLIC_API_BASE:
      process.env.NEXT_PUBLIC_API_BASE !== undefined
        ? process.env.NEXT_PUBLIC_API_BASE
        : "http://127.0.0.1:8000",
  },

  /**
   * Single public process (node server.js) listens on PORT; FastAPI stays on 127.0.0.1:8000.
   * Avoids a separate nginx layer (common source of Railway 502).
   */
  async rewrites() {
    return [
      { source: "/healthz", destination: "http://127.0.0.1:8000/healthz" },
      { source: "/readyz", destination: "http://127.0.0.1:8000/readyz" },
      { source: "/api/:path*", destination: "http://127.0.0.1:8000/api/:path*" },
    ];
  },
};

export default config;
