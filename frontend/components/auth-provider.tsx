"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { logger } from "@/lib/logger";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { setUser } = useAuthStore();

  useEffect(() => {
    // Small delay to ensure localStorage is fully available after navigation
    const timeoutId = setTimeout(() => {
      // Check if user is authenticated
      const token = localStorage.getItem("access_token");
      const userStr = localStorage.getItem("user");

      logger.log("🔍 AuthProvider check:", {
        pathname,
        hasToken: !!token,
        hasUser: !!userStr
      });

      if (token && userStr) {
        try {
          const user = JSON.parse(userStr);
          setUser(user);
          logger.log("✅ User authenticated:", { email: user.email, role: user.role });

          // If user must change password, redirect to change-password page
          if (user.forcePasswordChange === true && pathname !== "/auth/change-password") {
            logger.log("🔄 Forcing password change redirect");
            router.replace("/auth/change-password");
            return;
          }

          // Redirect to dashboard if authenticated and on login/register page
          if (pathname === "/auth/login" || pathname === "/auth/register") {
            if (user.forcePasswordChange !== true) {
              logger.log("🔄 Already authenticated, redirecting to dashboard");
              router.replace("/dashboard");
            }
          }
        } catch (error) {
          logger.error("❌ Failed to parse user from localStorage:", error);
          localStorage.removeItem("access_token");
          localStorage.removeItem("user");
        }
      } else {
        logger.log("⚠️ No token/user found in localStorage");
        // Redirect to login if not authenticated and trying to access protected route
        if (pathname?.startsWith("/dashboard")) {
          logger.log("🔄 Redirecting to login - no auth");
          router.replace("/auth/login");
        }
      }
    }, 50); // Small delay to ensure localStorage is available

    return () => clearTimeout(timeoutId);
  }, [pathname, router, setUser]);

  return <>{children}</>;
}
