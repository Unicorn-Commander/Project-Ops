"use client";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/components/auth-provider";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      themes={["light", "dark", "vibrant", "system"]}
      // Vibrant is a dark-tone theme that also wants Tailwind's `dark:`
      // utilities to fire (so existing `dark:bg-zinc-100` style overrides
      // still work). next-themes only sets one class via attribute="class",
      // so we use the `value` map to render `vibrant dark` together.
      value={{
        light: "light",
        dark: "dark",
        vibrant: "vibrant dark",
        system: "system",
      }}
    >
      <AuthProvider>
        {children}
        <Toaster />
      </AuthProvider>
    </ThemeProvider>
  );
}
