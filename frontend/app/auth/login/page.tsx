"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { useAuthStore } from "@/lib/store";
import api from "@/lib/api";
import { logger } from "@/lib/logger";
import { Eye, EyeOff } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const setUser = useAuthStore((state) => state.setUser);

  // Log when component mounts to verify React is running
  logger.log("🚀 LoginPage React component rendering, email:", email);

  const handleSubmit = async (e: React.FormEvent) => {
    logger.log("🎯 FORM SUBMIT HANDLER CALLED!");
    e.preventDefault();
    setIsLoading(true);

    try {
      logger.log("🔐 Attempting login with:", { email });
      const response = await api.post("/auth/login", { email, password });

      const { access_token, user } = response.data;

      // Set localStorage items
      logger.log("💾 Saving to localStorage...");
      localStorage.setItem("access_token", access_token);
      localStorage.setItem("user", JSON.stringify(user));
      localStorage.setItem("userRole", user.role || "CLIENT");

      // Update auth store
      setUser(user);

      toast({
        title: "Success",
        description: "Logged in successfully",
      });

      // Check if user must change password
      logger.log(
        "🔄 Redirecting to:",
        user.forcePasswordChange ? "/auth/change-password" : "/dashboard",
      );

      // Use router.replace with a longer delay to ensure localStorage is available
      await new Promise((resolve) => setTimeout(resolve, 200));

      if (user.forcePasswordChange === true) {
        router.replace("/auth/change-password");
      } else {
        router.replace("/dashboard");
      }
    } catch (error: any) {
      logger.error("Login failed", error.response?.status);
      toast({
        title: "Error",
        description: error.response?.data?.message || "Invalid credentials",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-70 dark:opacity-40"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, color-mix(in oklab, var(--color-primary) 22%, transparent) 0%, transparent 70%)",
        }}
      />

      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-md border-border/70 shadow-xl shadow-primary/5">
        <CardHeader className="space-y-1 text-center">
          <Link
            href="/"
            className="mx-auto mb-1 inline-flex flex-col items-center gap-2"
            aria-label="Project Ops home"
          >
            <Image
              src="/projectops-mascot.png"
              alt="Project Ops mascot"
              width={120}
              height={120}
              priority
              className="drop-shadow-md"
            />
            <div className="leading-tight">
              <div className="text-xl font-semibold tracking-tight">
                Project Ops
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                by Magic Unicorn
              </div>
            </div>
          </Link>
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>Sign in to continue.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {process.env.NEXT_PUBLIC_AUTH_MODE !== "local" && (
            <>
              <Button
                asChild
                variant="outline"
                className="w-full"
                disabled={isLoading}
              >
                <a
                  href={`${process.env.NEXT_PUBLIC_API_URL || "/api/v1"}/auth/keycloak`}
                  className="flex items-center justify-center gap-2"
                >
                  <Image
                    src="/the-colonel.png"
                    alt=""
                    width={22}
                    height={22}
                    className="h-[22px] w-[22px] shrink-0"
                  />
                  <span>Sign in with SSO</span>
                </a>
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    Or sign in with email and password
                  </span>
                </div>
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>

          <div className="text-center text-sm">
            Client portal access?{" "}
            <Link
              href="/auth/register"
              className="text-primary hover:underline"
            >
              Request an invitation
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
