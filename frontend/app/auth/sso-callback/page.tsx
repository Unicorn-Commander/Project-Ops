"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import api from "@/lib/api";
import { logger } from "@/lib/logger";

function SsoCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setUser = useAuthStore((state) => state.setUser);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get("token");

    if (!token) {
      setError("No authentication token returned from SSO.");
      return;
    }

    (async () => {
      try {
        localStorage.setItem("access_token", token);

        const response = await api.get("/auth/profile", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const user = response.data;

        localStorage.setItem("user", JSON.stringify(user));
        localStorage.setItem("userRole", user.role || "CLIENT");
        setUser(user);

        router.replace("/dashboard");
      } catch (err) {
        logger.error("SSO callback failed:", err);
        localStorage.removeItem("access_token");
        localStorage.removeItem("user");
        localStorage.removeItem("userRole");
        setError("Could not complete sign-in. Please try again.");
      }
    })();
  }, [searchParams, router, setUser]);

  if (error) {
    return (
      <>
        <p className="text-destructive font-medium">{error}</p>
        <button
          onClick={() => router.replace("/auth/login")}
          className="text-primary hover:underline"
        >
          Back to sign in
        </button>
      </>
    );
  }

  return (
    <>
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
      <p className="text-muted-foreground">Completing sign-in…</p>
    </>
  );
}

export default function SsoCallbackPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-3">
        <Suspense
          fallback={
            <>
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
              <p className="text-muted-foreground">Completing sign-in…</p>
            </>
          }
        >
          <SsoCallbackInner />
        </Suspense>
      </div>
    </div>
  );
}
