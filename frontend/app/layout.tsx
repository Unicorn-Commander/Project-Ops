import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ClientProviders } from "@/components/client-providers";
import { fetchBrandCss } from "@/lib/brand-tokens";
import { ANALYTICS_ENABLED, SITE_URL, UMAMI_SCRIPT_URL, UMAMI_WEBSITE_ID } from "@/lib/site";

// Brand fonts (docs/branding/PROJECT-OPS-BRAND.md): DM Sans for display +
// body, JetBrains Mono for code / identifiers / P-XXXXX project numbers.
// Exposed as CSS vars and wired into globals.css + the `font-sans`/`font-mono`
// utilities below.
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  // Canonical + metadataBase come from NEXT_PUBLIC_SITE_URL per environment.
  // Prod is served on two spellings (projectops / project-ops), so the
  // canonical pins one; metadataBase stops Next resolving relative OG images
  // against http://localhost:3000. Unset = neither is emitted.
  ...(SITE_URL
    ? { metadataBase: new URL(SITE_URL), alternates: { canonical: `${SITE_URL}/` } }
    : {}),
  title: {
    default: "Project-Ops · Magic Unicorn",
    template: "%s · Project-Ops",
  },
  description:
    "Turn conversations into completed work. Project-Ops connects meetings, projects, people, AI agents, clients, documents, and billing in one operational system.",
  icons: {
    icon: [{ url: "/projectops-mascot.png", type: "image/png" }],
    apple: [{ url: "/projectops-mascot.png" }],
  },
  openGraph: {
    title: "Project-Ops · Magic Unicorn",
    description:
      "Turn conversations into completed work across meetings, projects, people, AI agents, clients, documents, and billing.",
    siteName: "Project-Ops",
    ...(SITE_URL ? { url: `${SITE_URL}/` } : {}),
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Brand-driven theme: pull this app's color tokens from Brand-Ops (the brand
  // source of truth) and override the globals.css defaults at runtime. Returns
  // null when Brand-Ops is unset/unreachable/malformed — in which case we inject
  // nothing and the hardcoded globals.css values stand as the fallback. The
  // <style> is placed in <head> AFTER the imported globals.css so its :root
  // rules win on source order and override the defaults.
  const brandCss = await fetchBrandCss();

  return (
    <html lang="en" suppressHydrationWarning>
      {brandCss ? (
        <head>
          <style
            id="brand-ops-theme"
            // Server-rendered from Brand-Ops tokens; values are validated as
            // safe CSS color literals in fetchBrandCss() before they reach here.
            dangerouslySetInnerHTML={{ __html: brandCss }}
          />
        </head>
      ) : null}
      <body
        className={`${dmSans.variable} ${jetBrainsMono.variable} font-sans antialiased`}
      >
        <ClientProviders>
          {children}
        </ClientProviders>
        {/* Umami (self-hosted, cookieless) product analytics, per environment.
            Mounted in <body>, not the <head> above: that <head> only renders
            when Brand-Ops returns tokens, so a tag there would silently drop
            analytics whenever Brand-Ops is unset or unreachable. */}
        {ANALYTICS_ENABLED ? (
          <Script
            defer
            src={UMAMI_SCRIPT_URL}
            data-website-id={UMAMI_WEBSITE_ID}
            // Page URLs only: query strings and fragments can carry tokens.
            data-exclude-search="true"
            data-exclude-hash="true"
            strategy="afterInteractive"
          />
        ) : null}
      </body>
    </html>
  );
}
