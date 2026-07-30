import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite is built into Node 22+ — nothing to externalize for native addons.
  serverExternalPackages: [],
};

export default nextConfig;
