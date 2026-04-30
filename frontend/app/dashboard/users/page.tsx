"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import api from "@/lib/api";
import { roleBadgeClass, activeBadgeClass } from "@/lib/badge-styles";
import { format } from "date-fns";
import { UserPlus, Search, MoreVertical, Shield, User, Edit } from "lucide-react";
import { EditUserModal } from "@/components/modals/edit-user-modal";
import { CreateUserModal } from "@/components/modals/create-user-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar } from "@/components/ui/avatar";

interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await api.get("/users?page=1&limit=100");
      setUsers(response.data.data || []);
      setLoading(false);
    } catch (error) {
      // Error handling - always show errors
      toast({
        title: "Error",
        description: "Failed to load users",
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
    try {
      const endpoint = currentStatus
        ? `/users/${userId}/deactivate`
        : `/users/${userId}/activate`;
      await api.patch(endpoint);
      toast({
        title: "Success",
        description: `User ${currentStatus ? "deactivated" : "activated"} successfully`,
      });
      fetchUsers();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update user status",
        variant: "destructive",
      });
    }
  };

  const getRoleBadgeColor = roleBadgeClass;

  const getRoleIcon = (role: string) => {
    return role === "ADMIN" ? (
      <Shield className="h-4 w-4" />
    ) : (
      <User className="h-4 w-4" />
    );
  };

  const filteredUsers = users.filter(
    (user) =>
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-muted rounded w-1/3"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">User Management</h1>
          <p className="text-muted-foreground mt-1">
            Manage users, roles, and permissions
          </p>
        </div>
        <Button
          className="bg-primary hover:bg-primary/90"
          onClick={() => setIsCreateModalOpen(true)}
        >
          <UserPlus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-sm font-medium text-muted-foreground">
            Total Users
          </div>
          <div className="text-2xl font-bold mt-2">{users.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium text-muted-foreground">
            Active Users
          </div>
          <div className="text-2xl font-bold mt-2 text-green-600">
            {users.filter((u) => u.isActive).length}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium text-muted-foreground">
            Admins
          </div>
          <div className="text-2xl font-bold mt-2 text-red-600">
            {users.filter((u) => u.role === "ADMIN").length}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium text-muted-foreground">
            Managers
          </div>
          <div className="text-2xl font-bold mt-2 text-blue-600">
            {users.filter((u) => u.role === "MANAGER").length}
          </div>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* Users Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Last Login
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-muted/30">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <Avatar
                        name={`${user.firstName} ${user.lastName}`}
                        size={36}
                      />
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {user.firstName} {user.lastName}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          @{user.username}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                    {user.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleBadgeColor(
                        user.role
                      )}`}
                    >
                      {getRoleIcon(user.role)}
                      {user.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${activeBadgeClass(user.isActive)}`}
                    >
                      {user.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                    {user.lastLoginAt
                      ? format(new Date(user.lastLoginAt), "MMM d, yyyy")
                      : "Never"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingUser(user);
                          setIsEditModalOpen(true);
                        }}
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleUserStatus(user.id, user.isActive)}
                      >
                        {user.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredUsers.length === 0 && (
          <div className="p-4">
            <EmptyState
              icon={UserPlus}
              iconTone="rose"
              title={searchTerm ? "No users match" : "No users yet"}
              body={
                searchTerm
                  ? "Try a different search term."
                  : "Invite teammates to give them access. Roles control what each one can see and edit."
              }
              action={
                !searchTerm && (
                  <Button onClick={() => setIsCreateModalOpen(true)}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Invite user
                  </Button>
                )
              }
              className="border-0"
            />
          </div>
        )}
      </Card>

      <EditUserModal
        user={editingUser}
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingUser(null);
        }}
        onSuccess={fetchUsers}
      />

      <CreateUserModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={fetchUsers}
      />
    </div>
  );
}
