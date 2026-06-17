"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import {
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
  TaskComment,
  updateTaskStatus,
  markTaskComplete,
  deleteTask,
  getTaskComments,
  addTaskComment,
  assignTask,
} from "@/lib/tasks-api";
import { taskTypeIcon } from "@/lib/task-types";
import {
  X,
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
} from "lucide-react";
import api from "@/lib/api";
import { statusBadgeClass, priorityBadgeClass } from "@/lib/badge-styles";
import { format } from "date-fns";

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
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && task) {
      fetchComments();
      fetchUsers();
    }
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

  if (!isOpen || !task) return null;

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== TaskStatus.COMPLETED;

  const getStatusColor = (status: TaskStatus) => statusBadgeClass(status);
  const getPriorityColor = (priority: TaskPriority) => priorityBadgeClass(priority);

  // Centralised in lib/task-types.tsx (v1.6.13).
  const getTypeIcon = (type: TaskType) => taskTypeIcon(type);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <Card className="w-full max-w-4xl mx-4 p-6 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-start gap-4 flex-1">
            <div className="p-3 bg-primary/10 rounded-lg">
              {getTypeIcon(task.type)}
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-foreground mb-2">
                {task.title}
              </h2>
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
          <Button aria-label="Close"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
            type="button"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

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
                {format(new Date(task.dueDate), "EEEE, MMMM d, yyyy")}
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
        </div>

        {/* Actions */}
        <div className="mb-6 pb-6 border-b">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">
            ACTIONS
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
                        {comment.user && comment.user.firstName && comment.user.lastName
                          ? `${comment.user.firstName} ${comment.user.lastName}`
                          : comment.user?.email || "Unknown User"}
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
      </Card>
    </div>
  );
}
