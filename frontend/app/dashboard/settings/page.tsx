"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/store";
import { User, Lock, Bell, Shield, Mail, ChevronRight } from "lucide-react";
import Link from "next/link";

export default function SettingsPage() {
  const { user } = useAuthStore();

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your account settings and preferences
        </p>
      </div>

      {/* Profile Settings */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <User className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Profile Information</h2>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input id="firstName" defaultValue={user?.firstName} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input id="lastName" defaultValue={user?.lastName} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" defaultValue={user?.email} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input id="username" defaultValue={user?.username} />
          </div>
          <Button className="bg-primary hover:bg-primary/90">
            Save Changes
          </Button>
        </div>
      </Card>

      {/* Password Settings */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <Lock className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Change Password</h2>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current Password</Label>
            <Input id="currentPassword" type="password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New Password</Label>
            <Input id="newPassword" type="password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm New Password</Label>
            <Input id="confirmPassword" type="password" />
          </div>
          <Button className="bg-primary hover:bg-primary/90">
            Update Password
          </Button>
        </div>
      </Card>

      {/* Notification Settings */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <Bell className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Notifications</h2>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Email Notifications</p>
              <p className="text-sm text-muted-foreground">
                Receive email updates about your cases
              </p>
            </div>
            <input type="checkbox" className="h-4 w-4" defaultChecked />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Project Updates</p>
              <p className="text-sm text-muted-foreground">
                Get notified when project status changes
              </p>
            </div>
            <input type="checkbox" className="h-4 w-4" defaultChecked />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Document Uploads</p>
              <p className="text-sm text-muted-foreground">
                Alerts when new documents are uploaded
              </p>
            </div>
            <input type="checkbox" className="h-4 w-4" defaultChecked />
          </div>
        </div>
      </Card>

      {/* Security */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Security</h2>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Password Security</p>
              <p className="text-sm text-muted-foreground">
                Your password is encrypted and securely stored
              </p>
            </div>
            <Link href="/auth/change-password">
              <Button variant="outline">Change Password</Button>
            </Link>
          </div>
        </div>
      </Card>

      {/* Admin Settings */}
      {user?.role === "ADMIN" && (
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Admin Settings</h2>
          </div>
          <div className="space-y-4">
            <Link href="/dashboard/settings/email">
              <div className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors cursor-pointer">
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">Email Configuration</p>
                    <p className="text-sm text-muted-foreground">
                      Configure SMTP settings for sending emails
                    </p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </div>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
