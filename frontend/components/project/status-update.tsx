"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import api from "@/lib/api";

interface StatusUpdateProps {
  projectId: string;
  currentStatus: string;
  onSuccess?: () => void;
  disabled?: boolean;
}

const PROJECT_STATUSES = [
  { value: "NEW", label: "New", color: "bg-blue-100 text-blue-800" },
  {
    value: "IN_PROGRESS",
    label: "In Progress",
    color: "bg-yellow-100 text-yellow-800",
  },
  {
    value: "UNDER_REVIEW",
    label: "Under Review",
    color: "bg-purple-100 text-purple-800",
  },
  {
    value: "COMPLETED",
    label: "Completed",
    color: "bg-green-100 text-green-800",
  },
  {
    value: "ARCHIVED",
    label: "Archived",
    color: "bg-gray-100 text-gray-800",
  },
];

export function StatusUpdate({
  projectId,
  currentStatus,
  onSuccess,
  disabled = false,
}: StatusUpdateProps) {
  const [status, setStatus] = useState(currentStatus);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === status) return;

    setLoading(true);
    try {
      await api.patch(`/projects/${projectId}/status`, { status: newStatus });

      setStatus(newStatus);
      toast({
        title: "Status Updated",
        description: `Project status changed to ${
          PROJECT_STATUSES.find((s) => s.value === newStatus)?.label
        }`,
      });

      if (onSuccess) {
        onSuccess();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.response?.data?.message || "Failed to update status",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const currentStatusObj = PROJECT_STATUSES.find((s) => s.value === status);

  return (
    <Select
      value={status}
      onValueChange={handleStatusChange}
      disabled={loading || disabled}
    >
      <SelectTrigger className="w-[160px] h-8">
        <SelectValue>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${currentStatusObj?.color}`}
          >
            {currentStatusObj?.label}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {PROJECT_STATUSES.map((statusOption) => (
          <SelectItem key={statusOption.value} value={statusOption.value}>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusOption.color}`}
            >
              {statusOption.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
