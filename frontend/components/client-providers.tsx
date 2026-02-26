"use client";

import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/components/auth-provider";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {children}
      <Toaster />
    </AuthProvider>
  );
}
