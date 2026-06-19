"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useAuthStore } from "@/lib/store";
import { iconWellClass } from "@/lib/badge-styles";
import api from "@/lib/api";
import {
  User,
  Lock,
  Shield,
  Mail,
  ChevronRight,
  Loader2,
  SlidersHorizontal,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { ApiTokensCard } from "./api-tokens-card";
import { WorkspacesCard } from "./workspaces-card";
import { NotificationPreferencesCard } from "@/components/settings/notification-preferences-card";
import { GuidanceControlsCard } from "@/components/settings/guidance-controls-card";

export default function SettingsPage() {
  const { user, setUser } = useAuthStore();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [username, setUsername] = useState(user?.username ?? "");

  async function handleSaveProfile() {
    if (!user) return;
    setSaving(true);
    try {
      const { data } = await api.patch(`/users/${user.id}`, {
        firstName,
        lastName,
        email,
        username,
      });
      // The store accepts a full user; merge with existing keys we might miss.
      setUser({ ...user, ...data });
      toast({
        title: "Profile updated",
        description: "Your changes have been saved.",
      });
    } catch (err: any) {
      toast({
        title: "Couldn't save profile",
        description:
          err?.response?.data?.message ??
          "The server rejected the update. Try again or contact your admin.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your account settings and preferences
        </p>
      </div>

      {/* Profile Settings — wired against PATCH /users/:id (v1.6.30). */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass("blue")}`}>
            <User className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Profile information</h2>
            <p className="text-xs text-muted-foreground">
              How your name appears in projects, comments, and the assistant.
            </p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={saving}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground">
              Changing your email here updates your Project-Ops record only;
              SSO email at <span className="font-mono">auth.unicorncommander.ai</span> is the
              source of truth and won't change.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={saving}
            />
          </div>
          <Button onClick={handleSaveProfile} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </Card>

      {/* Security */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass("rose")}`}>
            <Shield className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Security</h2>
            <p className="text-xs text-muted-foreground">
              Authentication is handled by Unicorn Commander SSO. The
              password form is for the local fallback account only.
            </p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border p-4">
            <div>
              <p className="font-medium">Local password</p>
              <p className="text-sm text-muted-foreground">
                Used only when SSO is unavailable, or for client-portal users.
              </p>
            </div>
            <Link href="/auth/change-password">
              <Button variant="outline">
                <Lock className="mr-2 h-4 w-4" />
                Change password
              </Button>
            </Link>
          </div>
        </div>
      </Card>

      {/* Workspaces — create + manage members ("easy sharing"). */}
      <WorkspacesCard />

      {/* API tokens — Personal Access Tokens for the customer's own MCP clients. */}
      <ApiTokensCard />

      {/* Notifications — real email preferences wired to /notifications/preferences. */}
      <NotificationPreferencesCard />

      {/* Help & guidance — in-app tips master switch + reset/replay tour. */}
      <GuidanceControlsCard />

      {/* Admin Settings */}
      {user?.role === "ADMIN" && (
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass("violet")}`}>
              <Shield className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Admin settings</h2>
              <p className="text-xs text-muted-foreground">
                Tenant-wide configuration. Visible only to ADMIN users.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Link href="/dashboard/settings/email">
              <div className="flex items-center justify-between p-4 rounded-md border hover:bg-muted/50 transition-colors cursor-pointer group">
                <div className="flex items-center gap-3">
                  <div className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass("blue")}`}>
                    <Mail className="h-5 w-5" strokeWidth={1.75} />
                  </div>
                  <div>
                    <p className="font-medium">Email configuration</p>
                    <p className="text-sm text-muted-foreground">
                      SMTP settings used by the project notification + invite flows.
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
            <Link href="/dashboard/settings/custom-fields">
              <div className="flex items-center justify-between p-4 rounded-md border hover:bg-muted/50 transition-colors cursor-pointer group">
                <div className="flex items-center gap-3">
                  <div className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass("violet")}`}>
                    <SlidersHorizontal className="h-5 w-5" strokeWidth={1.75} />
                  </div>
                  <div>
                    <p className="font-medium">Custom fields</p>
                    <p className="text-sm text-muted-foreground">
                      Define your own fields on tasks and projects (text, number, date, select…).
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
            <Link href="/dashboard/settings/webhooks">
              <div className="flex items-center justify-between p-4 rounded-md border hover:bg-muted/50 transition-colors cursor-pointer group">
                <div className="flex items-center gap-3">
                  <div className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass("emerald")}`}>
                    <Webhook className="h-5 w-5" strokeWidth={1.75} />
                  </div>
                  <div>
                    <p className="font-medium">Webhooks</p>
                    <p className="text-sm text-muted-foreground">
                      Send signed HTTP callbacks to your systems when tasks and projects change.
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
