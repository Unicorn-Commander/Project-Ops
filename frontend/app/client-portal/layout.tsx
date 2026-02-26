"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  FileText,
  FolderOpen,
  LogOut,
  User,
} from "lucide-react";

interface ClientPortalLayoutProps {
  children: React.ReactNode;
}

export default function ClientPortalLayout({ children }: ClientPortalLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
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
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/auth/login");
  };

  const navigation = [
    {
      name: "Dashboard",
      href: "/client-portal/dashboard",
      icon: LayoutDashboard,
    },
    {
      name: "My Projects",
      href: "/client-portal/projects",
      icon: FileText,
    },
    {
      name: "Documents",
      href: "/client-portal/documents",
      icon: FolderOpen,
    },
  ];

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#F5F9FC]">
      {/* Top Navigation */}
      <header className="bg-white border-b border-[#D4DADE]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center">
              <Link href="/client-portal/dashboard" className="flex items-center">
                <span className="text-2xl font-bold text-[#005AF5]">
                  Project Ops
                </span>
                <span className="ml-2 text-sm text-[#A5A6AA]">Client Portal</span>
              </Link>
            </div>

            {/* User Info & Logout */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-[#A5A6AA]" />
                <span className="text-sm font-medium text-[#10172B]">
                  {user.firstName} {user.lastName}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="text-[#A5A6AA] hover:text-[#10172B]"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="bg-white border-b border-[#D4DADE]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-6">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`
                    flex items-center gap-2 px-3 py-4 text-sm font-medium border-b-2 transition-colors
                    ${
                      isActive
                        ? "border-[#005AF5] text-[#005AF5]"
                        : "border-transparent text-[#A5A6AA] hover:text-[#10172B] hover:border-[#D4DADE]"
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
