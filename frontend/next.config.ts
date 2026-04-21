import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  /** Silence multi-lockfile warning; must be cwd (where you run `npm run dev`), not `import.meta.url`. */
  outputFileTracingRoot: path.resolve(process.cwd()),
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  env: {
    NEXT_PUBLIC_API_BASE:
      process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000",
  },
};

export default config;
