"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  FolderOpen,
  ClipboardCheck,
  Receipt,
  FileText,
  LogOut,
  Sparkles,
} from "lucide-react";

interface ClientPortalLayoutProps {
  children: React.ReactNode;
}

export default function ClientPortalLayout({ children }: ClientPortalLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    const userData = localStorage.getItem("user");

    if (!token || !userData) {
      router.push("/auth/login");
      return;
    }

    const parsedUser = JSON.parse(userData);
    if (parsedUser.role !== "CLIENT") {
      router.push("/dashboard");
      return;
    }

    setUser(parsedUser);
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("user");
    router.push("/auth/login");
  };

  // Friendly, plain-language labels — the portal speaks to a client, not staff.
  const navigation = [
    { name: "Home", href: "/client-portal/dashboard", icon: LayoutDashboard },
    { name: "Projects", href: "/client-portal/projects", icon: FileText },
    { name: "Approvals", href: "/client-portal/approvals", icon: ClipboardCheck },
    { name: "Invoices", href: "/client-portal/invoices", icon: Receipt },
    { name: "Documents", href: "/client-portal/documents", icon: FolderOpen },
  ];

  if (!user) {
    return null;
  }

  const initials =
    `${(user.firstName ?? "").charAt(0)}${(user.lastName ?? "").charAt(0)}`
      .toUpperCase()
      .trim() || "·";

  /** A nav item is active if the path matches it or sits beneath it. */
  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <div className="min-h-screen bg-background">
      {/* Skip link — first focusable element, visually hidden until focused. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      {/* Sticky chrome: brand bar + nav, with a subtle backdrop blur so content
          scrolls gracefully beneath it. */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/75">
        {/* Brand row */}
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-4">
            <Link
              href="/client-portal/dashboard"
              className="group flex items-center gap-2.5"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
                <Sparkles className="h-5 w-5" strokeWidth={2} />
              </span>
              <span className="flex flex-col leading-none">
                <span className="text-base font-bold tracking-tight text-foreground">
                  Project Ops
                </span>
                <span className="mt-0.5 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
                  Client Portal
                </span>
              </span>
            </Link>

            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2.5 sm:flex">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {initials}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {user.firstName} {user.lastName}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="text-muted-foreground hover:text-foreground"
              >
                <LogOut className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Nav row */}
        <div className="mx-auto max-w-6xl px-2 sm:px-6 lg:px-8">
          <nav
            className="flex gap-1 overflow-x-auto"
            aria-label="Portal sections"
          >
            {navigation.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex items-center gap-2 whitespace-nowrap rounded-t-lg px-3.5 py-3 text-sm font-medium transition-colors",
                    active
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                  {item.name}
                  {/* Active underline — a rounded bar that reads cleaner than a
                      square 2px border. */}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-colors",
                      active ? "bg-primary" : "bg-transparent",
                    )}
                  />
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main content — generous vertical rhythm, gentle entrance. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="po-page-enter mx-auto max-w-6xl px-4 py-8 focus:outline-none sm:px-6 sm:py-10 lg:px-8"
      >
        {children}
      </main>
    </div>
  );
}
