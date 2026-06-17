import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ClientProviders } from "@/components/client-providers";

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
  title: {
    default: "Project Ops · Magic Unicorn",
    template: "%s · Project Ops",
  },
  description:
    "CRM, project management, kanban, billing, and a built-in AI agent — for teams who'd rather ship than chase status updates. Part of the Unicorn Commander suite.",
  icons: {
    icon: [{ url: "/projectops-mascot.png", type: "image/png" }],
    apple: [{ url: "/projectops-mascot.png" }],
  },
  openGraph: {
    title: "Project Ops · Magic Unicorn",
    description:
      "CRM, project management, kanban, billing, and a built-in AI agent. Part of the Unicorn Commander suite.",
    siteName: "Project Ops",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${dmSans.variable} ${jetBrainsMono.variable} font-sans antialiased`}
      >
        <ClientProviders>
          {children}
        </ClientProviders>
      </body>
    </html>
  );
}
