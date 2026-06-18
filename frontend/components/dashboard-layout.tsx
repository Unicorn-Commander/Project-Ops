"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { AssistantPanel } from "@/components/assistant-panel";
import { CommandPalette } from "@/components/command-palette";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { TimerProvider } from "@/components/time-tracking/timer-provider";
import { TimerWidget } from "@/components/time-tracking/timer-widget";
import { roleBadgeClass } from "@/lib/badge-styles";
import { Avatar } from "@/components/ui/avatar";
import {
  LayoutDashboard,
  FileText,
  Users,
  FolderOpen,
  Settings,
  LogOut,
  Menu,
  X,
  LayoutGrid,
  UserCircle,
  CheckSquare,
  Building2,
  CalendarRange,
  ChevronDown,
  Search,
  Inbox,
  Clock,
  CalendarClock,
  BarChart3,
  Receipt,
  LineChart,
  Gauge,
  Zap,
} from "lucide-react";

interface NavItem {
  name: string;
  href: string;
  icon: any;
  adminOnly?: boolean;
  /** Managers (MANAGER/ADMIN) only — used for approval + billing surfaces. */
  managerOnly?: boolean;
  group: "Workspace" | "Time & Billing" | "CRM" | "Admin";
}

const navigation: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, group: "Workspace" },
  { name: "My Tasks", href: "/dashboard/my-tasks", icon: CheckSquare, group: "Workspace" },
  { name: "Triage", href: "/dashboard/triage", icon: Inbox, group: "Workspace" },
  { name: "Projects", href: "/dashboard/projects", icon: FileText, group: "Workspace" },
  { name: "Kanban Board", href: "/dashboard/kanban", icon: LayoutGrid, group: "Workspace" },
  { name: "Schedule", href: "/dashboard/schedule", icon: CalendarRange, group: "Workspace" },
  { name: "Documents", href: "/dashboard/documents", icon: FolderOpen, group: "Workspace" },
  { name: "Time entries", href: "/dashboard/time", icon: Clock, group: "Time & Billing" },
  { name: "Timesheets", href: "/dashboard/timesheets", icon: CalendarClock, group: "Time & Billing" },
  { name: "Utilization", href: "/dashboard/utilization", icon: BarChart3, group: "Time & Billing" },
  { name: "Reports", href: "/dashboard/reports", icon: LineChart, group: "Time & Billing" },
  { name: "Capacity", href: "/dashboard/capacity", icon: Gauge, managerOnly: true, group: "Time & Billing" },
  { name: "Billing", href: "/dashboard/billing", icon: Receipt, managerOnly: true, group: "Time & Billing" },
  { name: "Organizations", href: "/dashboard/organizations", icon: Building2, group: "CRM" },
  { name: "Contacts", href: "/dashboard/contacts", icon: UserCircle, group: "CRM" },
  { name: "Automations", href: "/dashboard/automations", icon: Zap, managerOnly: true, group: "Admin" },
  { name: "Users", href: "/dashboard/users", icon: Users, adminOnly: true, group: "Admin" },
  { name: "Settings", href: "/dashboard/settings", icon: Settings, group: "Admin" },
];

/**
 * Map a pathname to a contextual page title for the top bar. Falls back to
 * "Project Ops" so the bar never reads empty during transitions.
 */
function pageTitleFor(pathname: string | null): string {
  if (!pathname) return "Project Ops";
  // Most-specific routes first.
  if (pathname.startsWith("/dashboard/projects/")) return "Project";
  if (pathname.startsWith("/dashboard/organizations/")) return "Organization";
  if (pathname.startsWith("/dashboard/contacts/")) return "Contact";
  if (pathname.startsWith("/dashboard/settings/email")) return "Email settings";
  const map: Record<string, string> = {
    "/dashboard": "Dashboard",
    "/dashboard/my-tasks": "My tasks",
    "/dashboard/triage": "Triage",
    "/dashboard/projects": "Projects",
    "/dashboard/kanban": "Kanban board",
    "/dashboard/documents": "Documents",
    "/dashboard/time": "Time entries",
    "/dashboard/timesheets": "Timesheets",
    "/dashboard/utilization": "Utilization",
    "/dashboard/billing": "Billing",
    "/dashboard/organizations": "Organizations",
    "/dashboard/contacts": "Contacts",
    "/dashboard/users": "Users",
    "/dashboard/settings": "Settings",
  };
  return map[pathname] ?? "Project Ops";
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Cmd/Ctrl+K opens the command palette from anywhere in the dashboard.
  // Cmd+/ toggles too — common alt-binding from other SaaS apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K" || e.key === "/")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Pretty platform-aware shortcut hint for the trigger button. `navigator` is
  // client-only, so the server and the first client render must agree on the
  // neutral "Ctrl K" label; once hydrated we swap in the Mac glyph. Gating on
  // `useHydrated()` (rather than reading navigator during render) avoids a
  // text-content hydration mismatch (React #418) in the top bar.
  const hydrated = useHydrated();
  const cmdLabel = useMemo(() => {
    if (!hydrated || typeof navigator === "undefined") return "Ctrl K";
    return navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K";
  }, [hydrated]);
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    router.push("/auth/login");
  };

  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER";
  const filteredNavigation = navigation.filter((item) => {
    if (item.adminOnly && user?.role !== "ADMIN") return false;
    if (item.managerOnly && !isManager) return false;
    return true;
  });

  const groupedNav = useMemo(() => {
    const groups: Record<string, NavItem[]> = {};
    filteredNavigation.forEach((item) => {
      groups[item.group] = groups[item.group] ?? [];
      groups[item.group].push(item);
    });
    return groups;
  }, [filteredNavigation]);

  const initials = (user?.firstName?.[0] ?? "") + (user?.lastName?.[0] ?? "");
  const title = pageTitleFor(pathname);

  // Server renders the generic "Project Ops · Magic Unicorn" title; once
  // hydrated we update document.title to match the contextual page name so
  // browser tabs / bookmarks read meaningfully.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = `${title} · Project Ops`;
    }
  }, [title]);

  return (
    <TimerProvider>
    <div className="min-h-screen bg-background">
      {/* Skip link — first focusable element; visually hidden until focused,
          then it jumps keyboard users straight past the sidebar/top bar to
          the page content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 transform border-r border-border bg-card transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          {/* Brand mark */}
          <div className="flex h-16 items-center justify-between border-b border-border/60 px-4">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <span className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-md bg-white dark:bg-zinc-100 ring-1 ring-border">
                <Image src="/projectops-mascot.png" alt="" aria-hidden width={32} height={32} priority />
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-tight">Project Ops</div>
                <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                  by Magic Unicorn
                </div>
              </div>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Navigation — grouped by section so the 9-item nav reads as
              three short lists rather than one long one. The active item
              gets a tinted icon-well treatment matching its group, the
              same colour vocabulary the dashboard stat cards use. */}
          <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
            {(
              [
                ["Workspace", "blue"],
                ["Time & Billing", "violet"],
                ["CRM", "emerald"],
                ["Admin", "rose"],
              ] as const
            ).map(([group, tone]) =>
              groupedNav[group]?.length ? (
                <div key={group}>
                  <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                    {group}
                  </div>
                  <div className="space-y-0.5">
                    {groupedNav[group].map((item) => {
                      const Icon = item.icon;
                      const isActive =
                        pathname === item.href ||
                        (item.href !== "/dashboard" && pathname?.startsWith(item.href + "/"));
                      const activeIconBg = {
                        blue: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
                        violet: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
                        emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
                        rose: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
                      }[tone];
                      return (
                        <Link
                          key={item.name}
                          href={item.href}
                          className={`group flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
                            isActive
                              ? "bg-foreground/[0.06] text-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                          onClick={() => setSidebarOpen(false)}
                        >
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                              isActive
                                ? activeIconBg
                                : "text-muted-foreground group-hover:text-foreground"
                            }`}
                          >
                            <Icon className="h-[18px] w-[18px]" />
                          </span>
                          {item.name}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ) : null,
            )}
          </nav>

          {/* Subtle footer mark — replaces the old bulky user info block;
              the user is now in the top-right dropdown. */}
          <div className="border-t border-border/60 px-4 py-3 text-[11px] text-muted-foreground">
            Part of the Unicorn Commander suite
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/60 bg-card/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/60 lg:px-6">
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <div className="flex-1" />
          {/* Cmd+K trigger — keyboard-first shortcut to jump anywhere. */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden md:inline-flex items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            aria-label="Open command palette"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search…</span>
            <kbd className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium">
              {cmdLabel}
            </kbd>
          </button>
          {/* Mobile-only icon trigger */}
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
          >
            <Search className="h-5 w-5" />
          </Button>
          <TimerWidget />
          <AssistantPanel />
          <WorkspaceSwitcher />
          <NotificationBell />
          <ThemeToggle />

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-2 px-2"
                aria-label="User menu"
              >
                {user?.email || user?.firstName ? (
                  <Avatar
                    name={`${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || user?.email || "?"}
                    initials={initials || undefined}
                    size={28}
                  />
                ) : (
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground/10">
                    <UserCircle className="h-4 w-4" />
                  </span>
                )}
                <span className="hidden text-sm font-medium md:inline">
                  {user?.firstName}
                </span>
                <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground md:inline" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <div className="px-2 py-2">
                <div className="text-sm font-semibold text-foreground">
                  {user?.firstName} {user?.lastName}
                </div>
                <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
                {user?.role && (
                  <span
                    className={`mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleBadgeClass(user.role)}`}
                  >
                    {user.role}
                  </span>
                )}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => router.push("/dashboard/settings")}>
                <Settings className="h-4 w-4 text-muted-foreground" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleLogout}
                className="text-rose-600 focus:text-rose-600 dark:text-rose-400 dark:focus:text-rose-400"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Page content */}
        <main id="main-content" tabIndex={-1} className="p-4 lg:p-6 focus:outline-none">
          {children}
        </main>
      </div>

      {/* Cmd+K palette — mounted once at root so it's reachable from any page. */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
    </TimerProvider>
  );
}
