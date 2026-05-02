"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import api from "@/lib/api";
import { roleBadgeClass, activeBadgeClass } from "@/lib/badge-styles";
import { format } from "date-fns";
import { UserPlus, MoreVertical, Shield, User, Edit } from "lucide-react";
import { EditUserModal } from "@/components/modals/edit-user-modal";
import { CreateUserModal } from "@/components/modals/create-user-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { ListToolbar, FilterOption } from "@/components/ui/list-toolbar";
import { compareValues } from "@/lib/list-controls";

const ROLE_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All roles" },
  { value: "ADMIN", label: "Admin", dot: "bg-violet-500" },
  { value: "MANAGER", label: "Manager", dot: "bg-blue-500" },
  { value: "STAFF", label: "Staff", dot: "bg-emerald-500" },
  { value: "CLIENT", label: "Client", dot: "bg-amber-500" },
];

const ACTIVE_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "Active + inactive" },
  { value: "ACTIVE", label: "Active only", dot: "bg-emerald-500" },
  { value: "INACTIVE", label: "Inactive only", dot: "bg-zinc-500" },
];

const SORT_OPTIONS = [
  { value: "lastName-asc", label: "Last name A–Z" },
  { value: "lastName-desc", label: "Last name Z–A" },
  { value: "email-asc", label: "Email A–Z" },
  { value: "createdAt-desc", label: "Newest first" },
  { value: "createdAt-asc", label: "Oldest first" },
  { value: "lastLoginAt-desc", label: "Recently logged in" },
];

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
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRole, setFilterRole] = useState("ALL");
  const [filterActive, setFilterActive] = useState("ALL");
  const [sortBy, setSortBy] = useState("lastName-asc");
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await api.get("/users?page=1&limit=500");
      setUsers(response.data.data || []);
      setTotalAvailable(response.data.meta?.total ?? response.data.data?.length ?? 0);
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

  const filteredUsers = users
    .filter((user) => {
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        term === "" ||
        user.email.toLowerCase().includes(term) ||
        user.firstName.toLowerCase().includes(term) ||
        user.lastName.toLowerCase().includes(term) ||
        user.username.toLowerCase().includes(term);
      const matchesRole = filterRole === "ALL" || user.role === filterRole;
      const matchesActive =
        filterActive === "ALL" ||
        (filterActive === "ACTIVE" ? user.isActive : !user.isActive);
      return matchesSearch && matchesRole && matchesActive;
    })
    .sort((a, b) => {
      const [field, dir] = sortBy.split("-") as [string, "asc" | "desc"];
      return compareValues((a as any)[field], (b as any)[field], dir);
    });

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

      {/* SSO model explainer — Project-Ops federates identity to the
          uchub Keycloak realm; team members self-provision on first SSO
          login. The "Add User" button creates non-SSO password users
          intended for client-portal access via /contacts/:id/invite. */}
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm flex items-start gap-3">
        <Shield className="h-4 w-4 mt-0.5 text-foreground/60 shrink-0" />
        <div className="space-y-1">
          <p className="text-foreground">
            <span className="font-semibold">Identity is federated through Unicorn Commander SSO.</span>{" "}
            Team members appear in this list automatically the first time they sign in via{" "}
            <span className="font-mono text-xs">auth.unicorncommander.ai</span> — there's no
            pre-creation step.
          </p>
          <p className="text-muted-foreground text-xs">
            New SSO users land as <span className="font-semibold">CLIENT</span> by default; promote them here.
            The <span className="font-semibold">Add User</span> button is for non-SSO accounts (client-portal users invited via the Contacts page) and for seeding accounts with a specific role before first login.
          </p>
        </div>
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

      {/* Toolbar — search + Role + State filters + sort (v1.6.34). */}
      <ListToolbar
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: "Search by name, email, or username…",
        }}
        filters={[
          {
            key: "role",
            label: "Role",
            value: filterRole,
            onChange: setFilterRole,
            options: ROLE_OPTIONS,
          },
          {
            key: "active",
            label: "State",
            value: filterActive,
            onChange: setFilterActive,
            options: ACTIVE_OPTIONS,
          },
        ]}
        sort={{
          value: sortBy,
          onChange: setSortBy,
          options: SORT_OPTIONS,
        }}
      />

      <p className="text-xs text-muted-foreground">
        {filteredUsers.length === users.length
          ? `${users.length} user${users.length === 1 ? "" : "s"}`
          : `${filteredUsers.length} of ${users.length} users match`}
        {totalAvailable > users.length && (
          <span className="ml-2 text-amber-600 dark:text-amber-400">
            · Showing first {users.length} of {totalAvailable}. Refine filters to narrow further.
          </span>
        )}
      </p>

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
