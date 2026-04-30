import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClientProviders } from "@/components/client-providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
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
      <body className={`${inter.variable} font-sans antialiased`}>
        <ClientProviders>
          {children}
        </ClientProviders>
      </body>
    </html>
  );
}
