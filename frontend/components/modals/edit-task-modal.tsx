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
import { updateTask, Task, TaskType, TaskPriority } from "@/lib/tasks-api";
import { TASK_TYPES } from "@/lib/task-types";
import {
  updateTaskSchema,
  type UpdateTaskFormData,
} from "@/lib/task-validation";
import { Loader2 } from "lucide-react";
import api from "@/lib/api";
import { CustomFieldInputs } from "@/components/custom-fields/custom-field-inputs";
import { RecurrencePicker } from "@/components/custom-fields/recurrence-picker";
import {
  CustomFieldEntity,
  type CustomFieldValueMap,
} from "@/lib/custom-fields-api";
import { FieldHint, HelpHint } from "@/components/guidance";

interface EditTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  task: Task | null;
}

interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
}

const PRIORITY_LEVELS = [
  { value: TaskPriority.LOW, label: "Low", color: "text-zinc-500 dark:text-zinc-400" },
  { value: TaskPriority.MEDIUM, label: "Medium", color: "text-blue-600 dark:text-blue-400" },
  { value: TaskPriority.HIGH, label: "High", color: "text-orange-600 dark:text-orange-400" },
  { value: TaskPriority.URGENT, label: "Urgent", color: "text-rose-600 dark:text-rose-400" },
];

export function EditTaskModal({
  isOpen,
  onClose,
  onSuccess,
  task,
}: EditTaskModalProps) {
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldValueMap>({});
  // Hide the custom-fields heading (and hint) when no TASK fields are defined.
  const [hasCustomFields, setHasCustomFields] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [fixedAmount, setFixedAmount] = useState("");
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<UpdateTaskFormData>({
    resolver: zodResolver(updateTaskSchema),
  });

  const taskType = watch("type");
  const priority = watch("priority");
  const description = watch("description");

  // Populate form with task data when modal opens
  useEffect(() => {
    if (isOpen && task) {
      reset({
        title: task.title,
        description: task.description,
        type: task.type,
        priority: task.priority,
        dueDate: task.dueDate ? task.dueDate.split('T')[0] : "",
        assignedToId: task.assignedToId || "",
      });
      // Hydrate the non-form fields from the task.
      setCustomFields(task.metadata?.customFields ?? {});
      setRecurrenceRule(task.recurrenceRule ?? "");
      setEstimatedHours(
        task.estimatedHours === null || task.estimatedHours === undefined
          ? ""
          : String(task.estimatedHours),
      );
      setFixedAmount(
        task.fixedAmount === null || task.fixedAmount === undefined
          ? ""
          : String(task.fixedAmount),
      );
      fetchUsers();
    }
  }, [isOpen, task, reset]);

  const fetchUsers = async () => {
    try {
      const response = await api.get("/users", {
        params: { role: "ADMIN,MANAGER,STAFF" },
      });
      setUsers(response.data.data || response.data);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  const onSubmit = async (data: UpdateTaskFormData) => {
    if (!task) return;

    setLoading(true);
    try {
      await updateTask(task.id, {
        title: data.title,
        description: data.description,
        type: data.type,
        priority: data.priority,
        dueDate: data.dueDate || undefined,
        assignedToId: data.assignedToId || undefined,
        // Always send the recurrence rule so clearing it ("") is persisted.
        recurrenceRule: recurrenceRule,
        estimatedHours:
          estimatedHours.trim() !== "" ? Number(estimatedHours) : undefined,
        fixedAmount: fixedAmount.trim() !== "" ? Number(fixedAmount) : null,
        customFields: customFields,
      });

      toast({
        title: "Success",
        description: "Task updated successfully",
      });

      onSuccess();
      onClose();
    } catch (error: any) {
      console.error("Error updating task:", error);
      toast({
        title: "Error",
        description:
          error.response?.data?.message ||
          "Failed to update task. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!task) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        overlayClassName="bg-black/50 backdrop-blur-sm"
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-card"
      >
        {/* Header */}
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Edit Task</DialogTitle>
          <DialogDescription>Update task details</DialogDescription>
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
                    Task Type
                    <FieldHint learnMore={{ category: "projects-tasks", article: "tasks" }}>
                      What kind of work this is — Task, Milestone, Deliverable,
                      Review, Meeting, or Research — so boards and the schedule
                      can tell milestones apart from routine work.
                    </FieldHint>
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
                    Priority
                    <FieldHint learnMore={{ category: "projects-tasks", article: "tasks" }}>
                      How urgent this task is — Low, Medium, High, or Urgent.
                      It's colour-coded everywhere the task appears so the
                      urgent ones stand out at a glance.
                    </FieldHint>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

                {/* Assign To */}
                <div>
                  <Label htmlFor="assignedToId">Assign To</Label>
                  <Select
                    value={watch("assignedToId")}
                    onValueChange={(value) => setValue("assignedToId", value)}
                  >
                    <SelectTrigger id="assignedToId">
                      <SelectValue placeholder="Select assignee" />
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
          </div>

          {/* Scheduling — estimate + recurrence */}
          <div>
            <h3 className="flex items-center gap-1.5 text-lg font-semibold text-foreground mb-4 border-b pb-2">
              Scheduling
              <HelpHint learnMore={{ category: "recurring", article: "repeats" }}>
                Set a “Repeats” rule and Project Ops materializes the next
                instance automatically — for work on a cadence like a weekly
                report or a monthly close.
              </HelpHint>
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="estimatedHours">
                    Estimated hours
                    <FieldHint learnMore={{ category: "capacity", article: "capacity-overview" }}>
                      Your best guess at the effort this task takes, in hours.
                      Estimates roll up into capacity planning to show who's
                      over- or under-committed.
                    </FieldHint>
                  </Label>
                  <Input
                    id="estimatedHours"
                    type="number"
                    min={0}
                    step="0.25"
                    placeholder="e.g. 4.5"
                    value={estimatedHours}
                    onChange={(e) => setEstimatedHours(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="edit-fixedAmount">
                    Flat fee
                    <FieldHint learnMore={{ category: "time-billing", article: "billing" }}>
                      A fixed price for this task, billed once. Clear it only
                      before the fee has been invoiced.
                    </FieldHint>
                  </Label>
                  <Input
                    id="edit-fixedAmount"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="e.g. 2500.00"
                    value={fixedAmount}
                    onChange={(e) => setFixedAmount(e.target.value)}
                    disabled={!!task?.invoicedAt}
                  />
                </div>
              </div>
              <RecurrencePicker
                value={recurrenceRule}
                onChange={setRecurrenceRule}
                idPrefix="edit-task-recurrence"
              />
            </div>
          </div>

          {/* Custom fields — workspace-defined TASK attributes. Bare inputs +
              an owned heading so we can hang a hint on it; hidden when none. */}
          <div className={hasCustomFields ? "" : "hidden"}>
            {hasCustomFields && (
              <h3 className="flex items-center gap-1.5 text-lg font-semibold text-foreground mb-4 border-b pb-2">
                Custom fields
                <HelpHint learnMore={{ category: "custom-fields", article: "custom-fields-overview" }}>
                  Workspace-specific attributes an admin added to tasks — a
                  client code, a billing category, a launch date. Fill in the
                  values as you work.
                </HelpHint>
              </h3>
            )}
            <CustomFieldInputs
              entity={CustomFieldEntity.TASK}
              values={customFields}
              onChange={setCustomFields}
              onDefinitionsLoaded={(defs) => setHasCustomFields(defs.length > 0)}
            />
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
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
