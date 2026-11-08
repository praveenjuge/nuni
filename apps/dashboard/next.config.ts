import type { NextConfig } from "next"

const nextConfig = {
  // DASHBOARD_PATH in @nuni/shared. Next loads this file without a bundler,
  // so it can't import it; lib/config.ts fails to compile if they differ.
  basePath: "/dashboard",
  transpilePackages: ["@nuni/shared", "@nuni/backend"],
  experimental: {
    agentUpgrade: "latest",
  },
} as const satisfies NextConfig

export default nextConfig
