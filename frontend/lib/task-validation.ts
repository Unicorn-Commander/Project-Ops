import * as z from 'zod';
import { TaskType, TaskPriority, TaskStatus } from './tasks-api';

// Create task validation schema
export const createTaskSchema = z.object({
  title: z
    .string()
    .min(3, 'Title must be at least 3 characters')
    .max(200, 'Title must not exceed 200 characters'),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(2000, 'Description must not exceed 2000 characters'),
  type: z.nativeEnum(TaskType),
  priority: z.nativeEnum(TaskPriority),
  dueDate: z
    .string()
    .optional()
    .refine(
      (date) => {
        if (!date) return true;
        return new Date(date) > new Date();
      },
      { message: 'Due date must be in the future' }
    ),
  projectId: z.string().min(1, 'Case is required'),
  assignedToId: z.string().optional().or(z.literal('')),
});

// Update task validation schema
export const updateTaskSchema = z.object({
  title: z
    .string()
    .min(3, 'Title must be at least 3 characters')
    .max(200, 'Title must not exceed 200 characters')
    .optional(),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(2000, 'Description must not exceed 2000 characters')
    .optional(),
  type: z.nativeEnum(TaskType).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  dueDate: z
    .string()
    .optional()
    .refine(
      (date) => {
        if (!date) return true;
        return new Date(date) > new Date();
      },
      { message: 'Due date must be in the future' }
    ),
  assignedToId: z.string().optional().or(z.literal('')),
});

// Task comment validation schema
export const taskCommentSchema = z.object({
  content: z
    .string()
    .min(1, 'Comment cannot be empty')
    .max(1000, 'Comment must not exceed 1000 characters'),
});

export type CreateTaskFormData = z.infer<typeof createTaskSchema>;
export type UpdateTaskFormData = z.infer<typeof updateTaskSchema>;
export type TaskCommentFormData = z.infer<typeof taskCommentSchema>;
