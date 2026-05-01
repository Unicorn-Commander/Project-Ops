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
//
// `sentryUrl` points the upload at our self-hosted Glitchtip instead of
// sentry.io. SENTRY_AUTH_TOKEN comes through the Dockerfile build ARG so
// the upload happens on `npm run build`. Without the token the plugin
// no-ops the upload step (no error, just minified frames in Glitchtip).
export default withSentryConfig(nextConfig, {
  org: "magic-unicorn",
  project: "project-ops-frontend",
  sentryUrl: process.env.SENTRY_URL || "https://glitchtip.magicunicorn.dev",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  tunnelRoute: "/monitoring",
  disableLogger: true,
  // Without these the Sentry plugin can't find Next's hidden client maps
  // and the upload step is silently a no-op.
  widenClientFileUpload: true,
  sourcemaps: {
    // No-op the upload step entirely when we have no token, so dev
    // builds don't yell at us. With token set, upload + then drop the
    // .map files from the production bundle so the original TS isn't
    // exposed to whoever loads the deployed JS.
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
});
