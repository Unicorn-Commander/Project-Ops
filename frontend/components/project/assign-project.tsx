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
import { useTeamMembers } from "@/lib/team-members";

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
  // Single shared cache — every AssignProject row hits the same in-flight
  // promise, then the same cached array. Before v1.6.44 this was a
  // per-row fetch and 27 simultaneous /users calls tripped the throttler.
  const { members: staffMembers, loading: loadingUsers, error: teamError } = useTeamMembers();
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (teamError) {
      toast({
        title: "Couldn't load team members",
        description: teamError,
        variant: "destructive",
      });
    }
  }, [teamError, toast]);

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
