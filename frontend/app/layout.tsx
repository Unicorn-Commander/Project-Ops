import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClientProviders } from "@/components/client-providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Project Ops · Magic Unicorn",
  description:
    "Project management, client portal, and operations workspace by Magic Unicorn. Part of the Unicorn Commander suite.",
  icons: {
    icon: [{ url: "/projectops-mascot.png", type: "image/png" }],
    apple: [{ url: "/projectops-mascot.png" }],
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
