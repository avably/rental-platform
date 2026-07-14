import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@rental/core", "@rental/db", "@rental/ui"],
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
