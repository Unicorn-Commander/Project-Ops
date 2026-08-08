import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ClientProviders } from "@/components/client-providers";
import { fetchBrandCss } from "@/lib/brand-tokens";

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
  // projectops.unicorncommander.ai and project-ops.unicorncommander.ai both
  // serve this app (the hyphenated spelling is an alias so deep links matching
  // the rest of the portfolio's naming do not 404). Without a canonical those
  // are two indexable copies of the same page, so pin the unhyphenated host.
  // metadataBase is also required or Next resolves relative OG images against
  // http://localhost:3000.
  metadataBase: new URL("https://projectops.unicorncommander.ai"),
  alternates: { canonical: "https://projectops.unicorncommander.ai/" },
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
    url: "https://projectops.unicorncommander.ai/",
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
        {/* Umami (self-hosted, cookieless) product analytics. Mounted here in
            <body> rather than in the <head> above on purpose: that <head> only
            renders when Brand-Ops returns tokens, so nesting the tag inside it
            would silently drop analytics whenever Brand-Ops is unset or
            unreachable (which is its current state in production). */}
        <Script
          defer
          src="https://analytics.unicorncommander.ai/script.js"
          data-website-id="bae68258-d1d3-456f-a850-119798ff1c47"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
