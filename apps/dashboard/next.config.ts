import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  basePath: "/dashboard",
  transpilePackages: ["@nuni/shared", "@nuni/backend"],
}

export default nextConfig
