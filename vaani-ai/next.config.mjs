/** @type {import('next').NextConfig} */

// Security headers (hardening doc §4.3). Applied to every response.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss:; font-src 'self' data:;",
  },
];

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Bundle optimization (scalability doc §5.2) — tree-shake heavy icon/chart libs.
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "@radix-ui/react-dialog"],
  },
  // ISR cache handler → Redis so multi-node deployments share one cache
  // (scalability doc §5.1). Resolves relative to the project root.
  ...(process.env.REDIS_CACHE_HANDLER === "true"
    ? { cacheHandler: "./cache-handler.mjs" }
    : {}),
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  webpack: (config, { isServer }) => {
    // Bundle analysis (scalability doc §5.2): ANALYZE=true npm run build
    if (process.env.ANALYZE === "true") {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { BundleAnalyzerPlugin } = require("webpack-bundle-analyzer");
      config.plugins.push(new BundleAnalyzerPlugin({ analyzerMode: "static" }));
    }
    return config;
  },
};

export default nextConfig;
