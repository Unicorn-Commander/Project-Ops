"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { createTask, TaskType, TaskPriority, TaskStatus } from "@/lib/tasks-api";
import { TASK_TYPES } from "@/lib/task-types";
import {
  createTaskSchema,
  type CreateTaskFormData,
} from "@/lib/task-validation";
import { Loader2 } from "lucide-react";
import api from "@/lib/api";

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preselectedProjectId?: string;
  /**
   * When set (e.g. from a kanban column's "Add task"), the new task is created
   * directly in this status instead of the backend default (PENDING).
   */
  defaultStatus?: TaskStatus;
}

interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
}

interface Project {
  id: string;
  projectNumber: string;
  title: string;
  clientName: string;
}

const PRIORITY_LEVELS = [
  { value: TaskPriority.LOW, label: "Low", color: "text-zinc-500 dark:text-zinc-400" },
  { value: TaskPriority.MEDIUM, label: "Medium", color: "text-blue-600 dark:text-blue-400" },
  { value: TaskPriority.HIGH, label: "High", color: "text-orange-600 dark:text-orange-400" },
  { value: TaskPriority.URGENT, label: "Urgent", color: "text-rose-600 dark:text-rose-400" },
];

export function CreateTaskModal({
  isOpen,
  onClose,
  onSuccess,
  preselectedProjectId,
  defaultStatus,
}: CreateTaskModalProps) {
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<CreateTaskFormData>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: {
      title: "",
      description: "",
      type: TaskType.OTHER,
      priority: TaskPriority.MEDIUM,
      dueDate: "",
      projectId: preselectedProjectId || "",
      assignedToId: "",
    },
  });

  const taskType = watch("type");
  const priority = watch("priority");
  const description = watch("description");
  const projectId = watch("projectId");

  // Fetch users and cases when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchUsers();
      if (!preselectedProjectId) {
        fetchProjects();
      }
    }
  }, [isOpen, preselectedProjectId]);

  // Set preselected project if provided
  useEffect(() => {
    if (preselectedProjectId) {
      setValue("projectId", preselectedProjectId);
    }
  }, [preselectedProjectId, setValue]);

  const fetchUsers = async () => {
    try {
      const response = await api.get("/users", {
        params: { take: 100 },
      });
      // Filter to only ADMIN, MANAGER, STAFF on frontend
      const filteredUsers = (response.data.data || response.data).filter((user: User) =>
        ['ADMIN', 'MANAGER', 'STAFF'].includes(user.role)
      );
      setUsers(filteredUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  const fetchProjects = async () => {
    try {
      const response = await api.get("/projects", {
        params: { take: 100 },
      });
      setProjects(response.data.data || response.data);
    } catch (error) {
      console.error("Error fetching projects:", error);
    }
  };

  const onSubmit = async (data: CreateTaskFormData) => {
    setLoading(true);
    try {
      await createTask({
        title: data.title,
        description: data.description,
        type: data.type,
        priority: data.priority,
        // When opened from a kanban column, drop the new task straight into
        // that column's status instead of the backend default (PENDING).
        status: defaultStatus,
        dueDate: data.dueDate || undefined,
        projectId: data.projectId,
        assignedToId: data.assignedToId && data.assignedToId !== "UNASSIGNED" ? data.assignedToId : undefined,
      });

      toast({
        title: "Success",
        description: "Task created successfully",
      });

      reset();
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error("Error creating task:", error);
      toast({
        title: "Error",
        description:
          error.response?.data?.message ||
          "Failed to create task. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        overlayClassName="bg-black/50 backdrop-blur-sm"
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-card"
      >
        {/* Header */}
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Create New Task</DialogTitle>
          <DialogDescription>
            Add a task to track work on a project
          </DialogDescription>
        </DialogHeader>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Task Information */}
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4 border-b pb-2">
              Task Information
            </h3>
            <div className="space-y-4">
              {/* Title */}
              <div>
                <Label htmlFor="title">
                  Title <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="title"
                  type="text"
                  placeholder="Enter task title"
                  {...register("title")}
                  className={errors.title ? "border-red-500" : ""}
                />
                {errors.title && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.title.message}
                  </p>
                )}
              </div>

              {/* Description */}
              <div>
                <Label htmlFor="description">
                  Description <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="description"
                  placeholder="Provide detailed information about the task..."
                  rows={4}
                  {...register("description")}
                  className={errors.description ? "border-red-500" : ""}
                />
                <div className="flex justify-between items-center mt-1">
                  <div>
                    {errors.description && (
                      <p className="text-sm text-red-500">
                        {errors.description.message}
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {description?.length || 0} / 2000 characters
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Task Type */}
                <div>
                  <Label htmlFor="type">
                    Task Type <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={taskType}
                    onValueChange={(value) => setValue("type", value as TaskType)}
                  >
                    <SelectTrigger
                      id="type"
                      className={errors.type ? "border-red-500" : ""}
                    >
                      <SelectValue placeholder="Select task type" />
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.type && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.type.message}
                    </p>
                  )}
                </div>

                {/* Priority */}
                <div>
                  <Label htmlFor="priority">
                    Priority <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={priority}
                    onValueChange={(value) =>
                      setValue("priority", value as TaskPriority)
                    }
                  >
                    <SelectTrigger
                      id="priority"
                      className={errors.priority ? "border-red-500" : ""}
                    >
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_LEVELS.map((level) => (
                        <SelectItem key={level.value} value={level.value}>
                          <span className={level.color}>{level.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.priority && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.priority.message}
                    </p>
                  )}
                </div>
              </div>

              {/* Due Date */}
              <div>
                <Label htmlFor="dueDate">Due Date</Label>
                <Input
                  id="dueDate"
                  type="date"
                  min={new Date().toISOString().split("T")[0]}
                  {...register("dueDate")}
                  className={errors.dueDate ? "border-red-500" : ""}
                />
                {errors.dueDate && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.dueDate.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Assignment */}
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4 border-b pb-2">
              Assignment
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Case */}
              <div>
                <Label htmlFor="projectId">
                  Case <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={projectId}
                  onValueChange={(value) => setValue("projectId", value)}
                  disabled={!!preselectedProjectId}
                >
                  <SelectTrigger
                    id="projectId"
                    className={errors.projectId ? "border-red-500" : ""}
                  >
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((projectItem) => (
                      <SelectItem key={projectItem.id} value={projectItem.id}>
                        <div className="flex flex-col">
                          <span className="font-medium">{projectItem.projectNumber}</span>
                          <span className="text-xs text-muted-foreground">
                            {projectItem.clientName}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.projectId && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.projectId.message}
                  </p>
                )}
              </div>

              {/* Assign To */}
              <div>
                <Label htmlFor="assignedToId">Assign To</Label>
                <Select
                  value={watch("assignedToId")}
                  onValueChange={(value) => setValue("assignedToId", value)}
                >
                  <SelectTrigger id="assignedToId">
                    <SelectValue placeholder="Select assignee (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.firstName && user.lastName
                          ? `${user.firstName} ${user.lastName}`
                          : user.email}{" "}
                        ({user.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-primary hover:bg-primary/90"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Task"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
