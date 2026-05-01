import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

// withSentryConfig wires up the Sentry webpack plugin (source-map upload
// when SENTRY_AUTH_TOKEN is set; silent otherwise) and the /monitoring
// tunnel that proxies browser POSTs through the same origin so ad-blockers
// don't kill error reports. Both are inert without env config.
export default withSentryConfig(nextConfig, {
  org: "magic-unicorn",
  project: "project-ops-frontend",
  silent: !process.env.CI,
  tunnelRoute: "/monitoring",
  disableLogger: true,
});
