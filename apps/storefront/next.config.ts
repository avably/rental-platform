import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  transpilePackages: ["@avably/core", "@avably/db", "@avably/security", "@avably/ui"],
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
};

export default withNextIntl(nextConfig);
