import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  basePath: "/dashboard",
  transpilePackages: ["@nuni/shared", "@nuni/backend"],
  experimental: {
    agentUpgrade: "latest",
  },
}

export default nextConfig
