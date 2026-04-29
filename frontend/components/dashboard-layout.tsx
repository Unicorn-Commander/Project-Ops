"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store";
import { ThemeToggle } from "@/components/theme-toggle";
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
} from "lucide-react";

interface NavItem {
  name: string;
  href: string;
  icon: any;
  adminOnly?: boolean;
}

const navigation: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "My Tasks", href: "/dashboard/my-tasks", icon: CheckSquare },
  { name: "Organizations", href: "/dashboard/organizations", icon: Building2 },
  { name: "Contacts", href: "/dashboard/contacts", icon: UserCircle },
  { name: "Projects", href: "/dashboard/projects", icon: FileText },
  { name: "Kanban Board", href: "/dashboard/kanban", icon: LayoutGrid },
  { name: "Documents", href: "/dashboard/documents", icon: FolderOpen },
  { name: "Users", href: "/dashboard/users", icon: Users, adminOnly: true },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

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
    (item) => !item.adminOnly || user?.role === "ADMIN"
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 transform bg-card border-r transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center justify-between px-4 border-b border-border/60">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <Image src="/logo-mark.svg" alt="" width={28} height={28} priority />
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

          {/* Navigation */}
          <nav className="flex-1 space-y-1 px-3 py-4">
            {filteredNavigation.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <Icon className="h-5 w-5" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* User info & logout */}
          <div className="border-t p-4">
            <div className="mb-3 px-3">
              <p className="text-sm font-medium text-foreground">
                {user?.firstName} {user?.lastName}
              </p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
              <p className="mt-1 text-xs font-medium text-primary">
                {user?.role}
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border/60 bg-card/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/60 lg:px-6">
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1" />
          <ThemeToggle />
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
