"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Input } from "@/components/ui/input";
import {
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
  TaskComment,
  TaskDependency,
  TaskDependencyType,
  DependencyDirection,
  createTask,
  updateTaskStatus,
  markTaskComplete,
  deleteTask,
  getTaskComments,
  addTaskComment,
  assignTask,
  getSubtasks,
  getTaskDependencies,
  addTaskDependency,
  removeTaskDependency,
} from "@/lib/tasks-api";
import { taskTypeIcon } from "@/lib/task-types";
import {
  Loader2,
  Edit,
  Trash2,
  CheckCircle,
  FileText,
  User,
  Calendar,
  Clock,
  MessageSquare,
  Send,
  AlertTriangle,
  ListTree,
  Plus,
  Link2,
  ArrowRight,
  ArrowLeft,
  X,
} from "lucide-react";
import api from "@/lib/api";
import { statusBadgeClass, priorityBadgeClass } from "@/lib/badge-styles";
import { format } from "date-fns";
import { CustomFieldValues } from "@/components/custom-fields/custom-field-inputs";
import { CustomFieldEntity } from "@/lib/custom-fields-api";
import { Repeat, Timer, SlidersHorizontal } from "lucide-react";
import { parseRecurrenceRule } from "@/components/custom-fields/recurrence-picker";
import { HelpHint } from "@/components/guidance";
import { commentAuthorName } from "@/lib/comment-author";
import { formatDateOnly, isDateOnlyBeforeToday } from "@/lib/date-only";

interface TaskDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  onEdit: () => void;
  onUpdate: () => void;
}

interface UserForAssignment {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
}

export function TaskDetailsModal({
  isOpen,
  onClose,
  task,
  onEdit,
  onUpdate,
}: TaskDetailsModalProps) {
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [users, setUsers] = useState<UserForAssignment[]>([]);
  const [submittingComment, setSubmittingComment] = useState(false);

  // Subtasks (Push B)
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);

  // Dependencies (Push B). `projectTasks` is the pick-list of sibling tasks in
  // the same project (the only valid dependency targets), minus this task.
  const [dependsOn, setDependsOn] = useState<TaskDependency[]>([]);
  const [blocks, setBlocks] = useState<TaskDependency[]>([]);
  const [projectTasks, setProjectTasks] = useState<Task[]>([]);
  const [depTargetId, setDepTargetId] = useState("");
  const [depDirection, setDepDirection] = useState<DependencyDirection>(
    DependencyDirection.DEPENDS_ON,
  );
  const [depType, setDepType] = useState<TaskDependencyType>(
    TaskDependencyType.FINISH_TO_START,
  );
  const [addingDep, setAddingDep] = useState(false);

  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && task) {
      fetchComments();
      fetchUsers();
      fetchSubtasks();
      fetchDependencies();
      fetchProjectTasks();
      // Reset the inline add-controls each time a different task opens.
      setNewSubtaskTitle("");
      setDepTargetId("");
      setDepDirection(DependencyDirection.DEPENDS_ON);
      setDepType(TaskDependencyType.FINISH_TO_START);
    }
    // The fetchers are stable for a given (isOpen, task); re-running only when
    // the open task changes is intentional (matches the prior pattern).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, task]);

  const fetchComments = async () => {
    if (!task) return;
    try {
      const data = await getTaskComments(task.id);
      setComments(data);
    } catch (error) {
      console.error("Error fetching comments:", error);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await api.get("/users", {
        params: {
          role: "ADMIN,MANAGER,STAFF",
          limit: 100  // Get all users for assignment
        },
      });
      console.log("Users API response:", response.data);

      // Handle paginated response structure: { data: [...], meta: {...} }
      let userData = [];
      if (response.data?.data && Array.isArray(response.data.data)) {
        userData = response.data.data;
      } else if (Array.isArray(response.data)) {
        userData = response.data;
      }

      // Filter out any null/undefined entries
      const validUsers = userData.filter((user: any) => user && user.id);
      console.log("Valid users for assignment:", validUsers.length, validUsers);
      setUsers(validUsers);
    } catch (error: any) {
      console.error("Error fetching users:", error);
      console.error("Error details:", error.response?.data);
      setUsers([]); // Ensure users is always an array
      toast({
        title: "Warning",
        description: "Failed to load users for assignment",
        variant: "destructive",
      });
    }
  };

  // ── Subtasks ──────────────────────────────────────────────────────────────
  const fetchSubtasks = async () => {
    if (!task) return;
    try {
      setSubtasks(await getSubtasks(task.id));
    } catch (error) {
      console.error("Error fetching subtasks:", error);
      setSubtasks([]);
    }
  };

  const handleAddSubtask = async () => {
    if (!task || !newSubtaskTitle.trim()) return;
    setAddingSubtask(true);
    try {
      // A subtask must live in the same project as its parent (backend enforces
      // this). Description has a 10-char minimum, so seed a sensible default.
      await createTask({
        title: newSubtaskTitle.trim(),
        description: `Subtask of: ${task.title}`,
        type: TaskType.TASK,
        priority: task.priority,
        projectId: task.projectId,
        parentTaskId: task.id,
      });
      setNewSubtaskTitle("");
      await fetchSubtasks();
      toast({ title: "Subtask added", description: "The subtask was created." });
      // Let the parent list refresh its subtask counts.
      onUpdate();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to add subtask",
        variant: "destructive",
      });
    } finally {
      setAddingSubtask(false);
    }
  };

  // ── Dependencies ────────────────────────────────────────────────────────────
  const fetchDependencies = async () => {
    if (!task) return;
    try {
      const data = await getTaskDependencies(task.id);
      setDependsOn(data.dependsOn);
      setBlocks(data.blocks);
    } catch (error) {
      console.error("Error fetching dependencies:", error);
      setDependsOn([]);
      setBlocks([]);
    }
  };

  // Sibling tasks in the same project are the only valid dependency targets.
  const fetchProjectTasks = async () => {
    if (!task) return;
    try {
      const response = await api.get(`/tasks/project/${task.projectId}`, {
        params: { take: 200 },
      });
      const data = Array.isArray(response.data)
        ? response.data
        : response.data?.data || [];
      setProjectTasks(data.filter((t: Task) => t.id !== task.id));
    } catch (error) {
      console.error("Error fetching project tasks:", error);
      setProjectTasks([]);
    }
  };

  const handleAddDependency = async () => {
    if (!task || !depTargetId) return;
    setAddingDep(true);
    try {
      await addTaskDependency(task.id, {
        taskId: depTargetId,
        direction: depDirection,
        type: depType,
      });
      setDepTargetId("");
      await fetchDependencies();
      toast({ title: "Dependency added", description: "The link was created." });
    } catch (error: any) {
      // Surface the backend's specific 400 (cycle / duplicate / self) verbatim.
      toast({
        title: "Couldn't add dependency",
        description:
          error.response?.data?.message ||
          "Failed to add dependency. Pick a different task or direction.",
        variant: "destructive",
      });
    } finally {
      setAddingDep(false);
    }
  };

  const handleRemoveDependency = async (dependencyId: string) => {
    if (!task) return;
    try {
      await removeTaskDependency(task.id, dependencyId);
      await fetchDependencies();
      toast({ title: "Dependency removed" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to remove dependency",
        variant: "destructive",
      });
    }
  };

  const handleStatusChange = async (status: TaskStatus) => {
    if (!task) return;
    setLoading(true);
    try {
      await updateTaskStatus(task.id, status);
      toast({
        title: "Success",
        description: "Task status updated",
      });
      onUpdate();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to update status",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleMarkComplete = async () => {
    if (!task) return;
    setLoading(true);
    try {
      await markTaskComplete(task.id);
      toast({
        title: "Success",
        description: "Task marked as complete",
      });
      onUpdate();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to complete task",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReassign = async (userId: string) => {
    if (!task) return;
    setLoading(true);
    try {
      const actualUserId = userId === "UNASSIGNED" ? "" : userId;
      await assignTask(task.id, actualUserId);
      toast({
        title: "Success",
        description: actualUserId ? "Task reassigned successfully" : "Task unassigned successfully",
      });
      onUpdate();
      onClose(); // Close modal to trigger page refresh
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to reassign task",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    if (!confirm("Are you sure you want to delete this task?")) return;

    setLoading(true);
    try {
      await deleteTask(task.id);
      toast({
        title: "Success",
        description: "Task deleted successfully",
      });
      onUpdate();
      onClose();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to delete task",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!task || !newComment.trim()) return;

    setSubmittingComment(true);
    try {
      await addTaskComment(task.id, newComment.trim());
      setNewComment("");
      await fetchComments();
      toast({
        title: "Success",
        description: "Comment added",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to add comment",
        variant: "destructive",
      });
    } finally {
      setSubmittingComment(false);
    }
  };

  if (!task) return null;

  const isOverdue =
    !!task.dueDate &&
    isDateOnlyBeforeToday(task.dueDate) &&
    task.status !== TaskStatus.COMPLETED &&
    task.status !== TaskStatus.CANCELLED;

  // Human-readable recurrence ("Every week" / "Every 2 weeks"). The picker's
  // parser tolerates anything; an unrecognized rule shows the raw string.
  const recurrenceSummary = (() => {
    const { freq, interval } = parseRecurrenceRule(task.recurrenceRule);
    if (!freq) return task.recurrenceRule ?? "";
    const noun = { DAILY: "day", WEEKLY: "week", MONTHLY: "month" }[freq];
    return interval === 1 ? `Every ${noun}` : `Every ${interval} ${noun}s`;
  })();

  // Whether the task has any populated custom-field value (gates the section
  // header; CustomFieldValues itself also hides if no definitions match).
  const cfMap = task.metadata?.customFields ?? {};
  const hasCustomFieldValues = Object.values(cfMap).some((v) => {
    if (v === null || v === undefined) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });

  const getStatusColor = (status: TaskStatus) => statusBadgeClass(status);
  const getPriorityColor = (priority: TaskPriority) => priorityBadgeClass(priority);

  // Centralised in lib/task-types.tsx (v1.6.13).
  const getTypeIcon = (type: TaskType) => taskTypeIcon(type);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        overlayClassName="bg-black/50 backdrop-blur-sm"
        className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-card"
      >
        {/* Header — the built-in close button sits top-right, so leave room. */}
        <DialogHeader className="text-left">
          <div className="flex items-start gap-4 pr-8">
            <div className="p-3 bg-primary/10 rounded-lg">
              {getTypeIcon(task.type)}
            </div>
            <div className="flex-1">
              <DialogTitle className="text-2xl font-bold mb-2">
                {task.title}
              </DialogTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={getStatusColor(task.status)}>
                  {task.status.replace(/_/g, ' ')}
                </Badge>
                <Badge className={getPriorityColor(task.priority)}>
                  {task.priority}
                </Badge>
                <Badge>
                  {task.type.replace(/_/g, ' ')}
                </Badge>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Overdue Warning */}
        {isOverdue && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg flex items-center gap-2 text-rose-700 dark:text-rose-300">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-semibold">This task is overdue!</span>
          </div>
        )}

        {/* Description */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-muted-foreground mb-2">
            DESCRIPTION
          </h3>
          <p className="text-foreground whitespace-pre-wrap">{task.description}</p>
        </div>

        {/* Task Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 pb-6 border-b">
          {/* Case */}
          {task.project && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                PROJECT
              </h3>
              <div>
                <p className="font-mono text-sm text-muted-foreground">
                  {task.project.projectNumber}
                </p>
                <p className="font-semibold text-foreground">{task.project.title}</p>
                {task.project.clientName && (
                  <p className="text-sm text-muted-foreground">{task.project.clientName}</p>
                )}
              </div>
            </div>
          )}

          {/* Assigned To */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
              <User className="h-4 w-4" />
              ASSIGNED TO
            </h3>
            <div className="flex items-center gap-2">
              {task.assignedTo ? (
                <span className="text-foreground">
                  {task.assignedTo.firstName && task.assignedTo.lastName
                    ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}`
                    : task.assignedTo.email}
                </span>
              ) : (
                <span className="text-muted-foreground italic">Unassigned</span>
              )}
              <Select
                value={task.assignedToId || "UNASSIGNED"}
                onValueChange={handleReassign}
                disabled={loading}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Reassign" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
                  {users && users.length > 0 ? (
                    users
                      .filter(user => user && user.id)
                      .map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.firstName && user.lastName
                            ? `${user.firstName} ${user.lastName}`
                            : user.email || "Unknown User"}
                        </SelectItem>
                      ))
                  ) : (
                    <SelectItem value="NO_USERS" disabled>
                      No users available
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Due Date */}
          {task.dueDate && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                DUE DATE
              </h3>
              <p className={`text-foreground ${isOverdue ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''}`}>
                {formatDateOnly(task.dueDate, {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
          )}

          {/* Created By */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
              <User className="h-4 w-4" />
              CREATED BY
            </h3>
            <p className="text-foreground">
              {task.createdBy && task.createdBy.firstName && task.createdBy.lastName
                ? `${task.createdBy.firstName} ${task.createdBy.lastName}`
                : task.createdBy?.email || 'Unknown'}
            </p>
          </div>

          {/* Created Date */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              CREATED
            </h3>
            <p className="text-foreground">
              {format(new Date(task.createdAt), "MMMM d, yyyy")}
            </p>
          </div>

          {/* Completed Date */}
          {task.completedAt && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                COMPLETED
              </h3>
              <p className="text-foreground">
                {format(new Date(task.completedAt), "MMMM d, yyyy")}
              </p>
            </div>
          )}

          {/* Estimated Hours */}
          {task.estimatedHours !== null && task.estimatedHours !== undefined && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                <Timer className="h-4 w-4" />
                ESTIMATED HOURS
                <HelpHint learnMore={{ category: "capacity", article: "capacity-overview" }}>
                  The effort budgeted for this task. Estimates roll up into
                  capacity planning to show who's over- or under-committed.
                </HelpHint>
              </h3>
              <p className="text-foreground">
                {Number(task.estimatedHours)}{" "}
                {Number(task.estimatedHours) === 1 ? "hour" : "hours"}
              </p>
            </div>
          )}

          {/* Recurrence */}
          {task.recurrenceRule && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                <Repeat className="h-4 w-4" />
                REPEATS
                <HelpHint learnMore={{ category: "recurring", article: "repeats" }}>
                  This task recurs on a schedule — Project Ops materializes the
                  next instance automatically when one is due.
                </HelpHint>
              </h3>
              <p className="text-foreground">{recurrenceSummary}</p>
            </div>
          )}
        </div>

        {/* Custom Fields */}
        {hasCustomFieldValues && (
          <div className="mb-6 pb-6 border-b">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              CUSTOM FIELDS
            </h3>
            <CustomFieldValues
              entity={CustomFieldEntity.TASK}
              values={task.metadata?.customFields}
            />
          </div>
        )}

        {/* Actions */}
        <div className="mb-6 pb-6 border-b">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground mb-3">
            ACTIONS
            <HelpHint learnMore={{ category: "projects-tasks", article: "tasks" }}>
              Change the task's status — Pending, In progress, Waiting for
              client, Completed, or Cancelled. Status also moves with a drag on
              the Kanban board.
            </HelpHint>
          </h3>
          <div className="flex flex-wrap gap-3">
            <Select
              value={task.status}
              onValueChange={(value) => handleStatusChange(value as TaskStatus)}
              disabled={loading}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Change Status" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(TaskStatus).map((status) => (
                  <SelectItem key={status} value={status}>
                    {status.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {task.status !== TaskStatus.COMPLETED && (
              <Button
                variant="outline"
                onClick={handleMarkComplete}
                disabled={loading}
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Mark Complete
              </Button>
            )}

            <Button variant="outline" onClick={onEdit} disabled={loading}>
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Button>

            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={loading}
              className="text-red-600 hover:text-red-700"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>

        {/* Subtasks Section */}
        <div className="mb-6 pb-6 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <ListTree className="h-4 w-4" />
            SUBTASKS ({subtasks.length})
          </h3>

          {subtasks.length > 0 && (
            <div className="space-y-2 mb-3">
              {subtasks.map((sub) => {
                const subOverdue =
                  sub.dueDate &&
                  isDateOnlyBeforeToday(sub.dueDate) &&
                  sub.status !== TaskStatus.COMPLETED &&
                  sub.status !== TaskStatus.CANCELLED;
                return (
                  <div
                    key={sub.id}
                    className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2"
                  >
                    <span className="shrink-0">{taskTypeIcon(sub.type)}</span>
                    <span className="flex-1 truncate text-sm text-foreground">
                      {sub.title}
                    </span>
                    {sub.dueDate && (
                      <span
                        className={`text-xs ${subOverdue ? "text-rose-600 dark:text-rose-400 font-medium" : "text-muted-foreground"}`}
                      >
                        {formatDateOnly(sub.dueDate, { month: "short", day: "numeric" })}
                      </span>
                    )}
                    <Badge className={`shrink-0 ${getStatusColor(sub.status)}`}>
                      {sub.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add subtask inline */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="Add a subtask…"
              value={newSubtaskTitle}
              onChange={(e) => setNewSubtaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSubtaskTitle.trim() && !addingSubtask) {
                  e.preventDefault();
                  handleAddSubtask();
                }
              }}
              disabled={addingSubtask}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddSubtask}
              disabled={addingSubtask || !newSubtaskTitle.trim()}
            >
              {addingSubtask ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Add
            </Button>
          </div>
        </div>

        {/* Dependencies Section */}
        <div className="mb-6 pb-6 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            DEPENDENCIES
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* Depends on */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" />
                Depends on
              </h4>
              {dependsOn.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">Nothing yet</p>
              ) : (
                <div className="space-y-2">
                  {dependsOn.map((dep) => (
                    <DependencyRow
                      key={dep.id}
                      title={dep.predecessor?.title ?? "Unknown task"}
                      status={dep.predecessor?.status}
                      type={dep.type}
                      onRemove={() => handleRemoveDependency(dep.id)}
                      getStatusColor={getStatusColor}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Blocks */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <ArrowRight className="h-3.5 w-3.5" />
                Blocks
              </h4>
              {blocks.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">Nothing yet</p>
              ) : (
                <div className="space-y-2">
                  {blocks.map((dep) => (
                    <DependencyRow
                      key={dep.id}
                      title={dep.successor?.title ?? "Unknown task"}
                      status={dep.successor?.status}
                      type={dep.type}
                      onRemove={() => handleRemoveDependency(dep.id)}
                      getStatusColor={getStatusColor}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Add dependency control */}
          {projectTasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No other tasks in this project to link to yet.
            </p>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <Select
                value={depDirection}
                onValueChange={(v) => setDepDirection(v as DependencyDirection)}
              >
                <SelectTrigger className="w-full sm:w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DependencyDirection.DEPENDS_ON}>
                    Depends on
                  </SelectItem>
                  <SelectItem value={DependencyDirection.BLOCKS}>Blocks</SelectItem>
                </SelectContent>
              </Select>

              <Select value={depTargetId} onValueChange={setDepTargetId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a task…" />
                </SelectTrigger>
                <SelectContent>
                  {projectTasks.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={depType}
                onValueChange={(v) => setDepType(v as TaskDependencyType)}
              >
                <SelectTrigger className="w-full sm:w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(TaskDependencyType).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, " ").toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={handleAddDependency}
                disabled={addingDep || !depTargetId}
              >
                {addingDep ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Link
              </Button>
            </div>
          )}
        </div>

        {/* Comments Section */}
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-4 flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            COMMENTS ({comments.length})
          </h3>

          {/* Add Comment */}
          <div className="mb-6">
            <Textarea
              placeholder="Add a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={3}
              className="mb-2"
            />
            <Button
              onClick={handleAddComment}
              disabled={submittingComment || !newComment.trim()}
              size="sm"
            >
              {submittingComment ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Post Comment
            </Button>
          </div>

          {/* Comments List */}
          <div className="space-y-4">
            {comments.length === 0 ? (
              <p className="text-sm text-muted-foreground italic text-center py-4">
                No comments yet
              </p>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="p-4 bg-muted/50 rounded-lg">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="font-semibold text-foreground">
                        {commentAuthorName(comment)}
                      </span>
                      <span className="text-sm text-muted-foreground ml-2">
                        {format(new Date(comment.createdAt), "MMM d, yyyy h:mm a")}
                      </span>
                    </div>
                  </div>
                  <p className="text-foreground whitespace-pre-wrap">
                    {comment.content}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Close Button */}
        <div className="flex justify-end gap-3 pt-6 border-t mt-6">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// A single dependency edge row: the related task, its status, the edge type,
// and a remove button. Shared by the "Depends on" and "Blocks" columns.
function DependencyRow({
  title,
  status,
  type,
  onRemove,
  getStatusColor,
}: {
  title: string;
  status?: TaskStatus;
  type: TaskDependencyType;
  onRemove: () => void;
  getStatusColor: (status: TaskStatus) => string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm text-foreground">{title}</p>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {type.replace(/_/g, " ").toLowerCase()}
        </p>
      </div>
      {status && (
        <Badge className={`shrink-0 ${getStatusColor(status)}`}>
          {status.replace(/_/g, " ")}
        </Badge>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
        aria-label={`Remove dependency on ${title}`}
        title="Remove dependency"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
