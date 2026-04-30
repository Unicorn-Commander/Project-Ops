"use client";

import { useMemo, useState } from "react";
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
import { ThemeToggle } from "@/components/theme-toggle";
import { AssistantPanel } from "@/components/assistant-panel";
import { roleBadgeClass } from "@/lib/badge-styles";
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
  ChevronDown,
} from "lucide-react";

interface NavItem {
  name: string;
  href: string;
  icon: any;
  adminOnly?: boolean;
  group: "Workspace" | "CRM" | "Admin";
}

const navigation: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, group: "Workspace" },
  { name: "My Tasks", href: "/dashboard/my-tasks", icon: CheckSquare, group: "Workspace" },
  { name: "Projects", href: "/dashboard/projects", icon: FileText, group: "Workspace" },
  { name: "Kanban Board", href: "/dashboard/kanban", icon: LayoutGrid, group: "Workspace" },
  { name: "Documents", href: "/dashboard/documents", icon: FolderOpen, group: "Workspace" },
  { name: "Organizations", href: "/dashboard/organizations", icon: Building2, group: "CRM" },
  { name: "Contacts", href: "/dashboard/contacts", icon: UserCircle, group: "CRM" },
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
    "/dashboard/projects": "Projects",
    "/dashboard/kanban": "Kanban board",
    "/dashboard/documents": "Documents",
    "/dashboard/organizations": "Organizations",
    "/dashboard/contacts": "Contacts",
    "/dashboard/users": "Users",
    "/dashboard/settings": "Settings",
  };
  return map[pathname] ?? "Project Ops";
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    router.push("/auth/login");
  };

  const filteredNavigation = navigation.filter(
    (item) => !item.adminOnly || user?.role === "ADMIN",
  );

  const groupedNav = useMemo(() => {
    const groups: Record<string, NavItem[]> = {};
    filteredNavigation.forEach((item) => {
      groups[item.group] = groups[item.group] ?? [];
      groups[item.group].push(item);
    });
    return groups;
  }, [filteredNavigation]);

  const initials = (user?.firstName?.[0] ?? "") + (user?.lastName?.[0] ?? "");

  return (
    <div className="min-h-screen bg-background">
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
              <span className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-border">
                <Image src="/projectops-mascot.png" alt="" width={32} height={32} priority />
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
              three short lists rather than one long one. */}
          <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
            {(["Workspace", "CRM", "Admin"] as const).map((group) =>
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
                      return (
                        <Link
                          key={item.name}
                          href={item.href}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                            isActive
                              ? "bg-foreground/[0.06] text-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                          onClick={() => setSidebarOpen(false)}
                        >
                          <Icon
                            className={`h-[18px] w-[18px] ${
                              isActive ? "text-foreground" : "text-muted-foreground"
                            }`}
                          />
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
            {pageTitleFor(pathname)}
          </h1>
          <div className="flex-1" />
          <AssistantPanel />
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
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground/10 text-[11px] font-semibold uppercase">
                  {initials || <UserCircle className="h-4 w-4" />}
                </span>
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
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
