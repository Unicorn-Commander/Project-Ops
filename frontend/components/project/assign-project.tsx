"use client";

import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import api from "@/lib/api";
import { User } from "lucide-react";

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

interface AssignProjectProps {
  projectId: string;
  currentAssignedToId: string | null;
  onSuccess?: () => void;
  disabled?: boolean;
}

export function AssignProject({
  projectId,
  currentAssignedToId,
  onSuccess,
  disabled = false,
}: AssignProjectProps) {
  const [assignedToId, setAssignedToId] = useState<string | null>(
    currentAssignedToId
  );
  const [staffMembers, setStaffMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchStaffMembers();
  }, []);

  const fetchStaffMembers = async () => {
    try {
      const response = await api.get("/users?page=1&limit=100");
      const allUsers = response.data.data || [];

      // Filter for STAFF, MANAGER, and ADMIN roles
      const staffUsers = allUsers.filter(
        (user: User) =>
          user.role === "STAFF" ||
          user.role === "MANAGER" ||
          user.role === "ADMIN"
      );

      setStaffMembers(staffUsers);
      setLoadingUsers(false);
    } catch (error) {
      console.error("Error fetching users:", error);
      toast({
        title: "Error",
        description: "Failed to load team members",
        variant: "destructive",
      });
      setLoadingUsers(false);
    }
  };

  const handleAssign = async (userId: string) => {
    if (userId === assignedToId) return;

    const assigneeId = userId === "unassigned" ? null : userId;

    setLoading(true);
    try {
      await api.patch(`/projects/${projectId}/assign`, { assignedToId: assigneeId });

      setAssignedToId(assigneeId);

      const assignedUser = staffMembers.find((u) => u.id === assigneeId);
      toast({
        title: "Project Assigned",
        description: assigneeId
          ? `Project assigned to ${assignedUser?.firstName} ${assignedUser?.lastName}`
          : "Project unassigned",
      });

      if (onSuccess) {
        onSuccess();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.response?.data?.message || "Failed to assign project",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const assignedUser = staffMembers.find((u) => u.id === assignedToId);

  if (loadingUsers) {
    return (
      <div className="w-[180px] h-8 bg-muted animate-pulse rounded-md"></div>
    );
  }

  return (
    <Select
      value={assignedToId || "unassigned"}
      onValueChange={handleAssign}
      disabled={loading || disabled}
    >
      <SelectTrigger className="w-[180px] h-8">
        <SelectValue>
          <div className="flex items-center gap-2">
            <User className="h-3 w-3" />
            <span className="text-xs">
              {assignedUser
                ? `${assignedUser.firstName} ${assignedUser.lastName}`
                : "Unassigned"}
            </span>
          </div>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="unassigned">
          <span className="text-muted-foreground text-sm">Unassigned</span>
        </SelectItem>
        {staffMembers.map((user) => (
          <SelectItem key={user.id} value={user.id}>
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {user.firstName} {user.lastName}
              </span>
              <span className="text-xs text-muted-foreground">
                {user.role.charAt(0) + user.role.slice(1).toLowerCase()}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
