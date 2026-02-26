"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import api from "@/lib/api";
import { X, Eye, EyeOff } from "lucide-react";

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const USER_ROLES = [
  { value: "ADMIN", label: "Administrator", description: "Full system access" },
  { value: "MANAGER", label: "Manager", description: "Manage cases and users" },
  { value: "STAFF", label: "Staff Member", description: "Handle projects" },
  { value: "CLIENT", label: "Client", description: "View own cases only" },
];

export function CreateUserModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateUserModalProps) {
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    username: "",
    password: "",
    role: "CLIENT",
    isActive: true,
  });
  const [loading, setLoading] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  const validatePassword = (password: string): boolean => {
    if (password.length < 8) {
      setPasswordError("Password must be at least 8 characters long");
      return false;
    }
    setPasswordError("");
    return true;
  };

  const handlePasswordChange = (value: string) => {
    setFormData({ ...formData, password: value });
    if (value) {
      validatePassword(value);
    } else {
      setPasswordError("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate password
    if (!validatePassword(formData.password)) {
      return;
    }

    setLoading(true);
    try {
      await api.post("/users", formData);
      toast({
        title: "Success",
        description: "User created successfully",
      });

      // Reset form
      setFormData({
        firstName: "",
        lastName: "",
        email: "",
        username: "",
        password: "",
        role: "CLIENT",
        isActive: true,
      });
      setPasswordError("");
      setShowPassword(false);

      onSuccess();
      onClose();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to create user",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    // Reset form on close
    setFormData({
      firstName: "",
      lastName: "",
      email: "",
      username: "",
      password: "",
      role: "CLIENT",
      isActive: true,
    });
    setPasswordError("");
    setShowPassword(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
      onKeyDown={(e) => {
        // Close on ESC key
        if (e.key === "Escape") {
          handleClose();
        }
      }}
    >
      <Card className="w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-foreground">Create New User</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClose}
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) =>
                  setFormData({ ...formData, firstName: e.target.value })
                }
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.lastName}
                onChange={(e) =>
                  setFormData({ ...formData, lastName: e.target.value })
                }
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Username <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) =>
                  setFormData({ ...formData, username: e.target.value })
                }
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={formData.password}
                onChange={(e) => handlePasswordChange(e.target.value)}
                className={`w-full px-3 py-2 pr-10 border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
                  passwordError ? "border-red-500" : "border-input"
                }`}
                minLength={8}
                required
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
            {passwordError && (
              <p className="text-sm text-red-500 mt-1">{passwordError}</p>
            )}
            {!passwordError && formData.password && (
              <p className="text-xs text-muted-foreground mt-1">
                Password must be at least 8 characters long
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-3">
              User Role <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              {USER_ROLES.map((role) => (
                <div
                  key={role.value}
                  onClick={() => setFormData({ ...formData, role: role.value })}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    formData.role === role.value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-foreground">
                      {role.label}
                    </span>
                    {formData.role === role.value && (
                      <div className="h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                        <div className="h-2 w-2 rounded-full bg-white" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {role.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive}
              onChange={(e) =>
                setFormData({ ...formData, isActive: e.target.checked })
              }
              className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-primary"
            />
            <label
              htmlFor="isActive"
              className="text-sm font-medium text-foreground cursor-pointer"
            >
              Active User
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-primary hover:bg-primary/90"
              disabled={loading || !!passwordError}
            >
              {loading ? "Creating..." : "Create User"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
