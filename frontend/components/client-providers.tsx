"use client";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/components/auth-provider";
import { WorkspaceProvider } from "@/components/workspace-provider";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  // Nesting: Theme → Auth → Workspace → Toaster. WorkspaceProvider sits below
  // AuthProvider (it reacts to the auth store) and above the app + Toaster.
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      themes={["light", "dark", "vibrant", "system"]}
    >
      <AuthProvider>
        <WorkspaceProvider>
          {children}
          <Toaster />
        </WorkspaceProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
