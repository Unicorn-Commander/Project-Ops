"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import api from "@/lib/api";
import { logger } from "@/lib/logger";

function SsoCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setUser = useAuthStore((state) => state.setUser);
  const [error, setError] = useState<string | null>(null);
  // Run the hand-off exactly once: stripping the URL below changes searchParams,
  // which would otherwise re-run this effect with no token and show an error.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    // The backend hands the token over in the URL fragment (#token=); older
    // backends used the query string (?token=). Read either, then strip both from
    // the address bar before anything else runs, so the token does not linger in
    // the URL, the history entry, or anything that reports the page URL.
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = fragment.get("token") || searchParams.get("token");
    if (window.location.hash || window.location.search) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }

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
