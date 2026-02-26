'use client';

import { useState, useEffect } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { KanbanColumn } from './kanban-column';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface Project {
  id: string;
  projectNumber: string;
  clientName: string;
  projectType: string;
  status: 'NEW' | 'IN_PROGRESS' | 'UNDER_REVIEW' | 'COMPLETED' | 'ARCHIVED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  dueDate?: string;
  assignedTo?: {
    id: string;
    name: string;
  };
}

const columns = [
  { id: 'NEW', title: 'New', color: 'blue' },
  { id: 'IN_PROGRESS', title: 'In Progress', color: 'yellow' },
  { id: 'UNDER_REVIEW', title: 'Under Review', color: 'purple' },
  { id: 'COMPLETED', title: 'Completed', color: 'green' },
  { id: 'ARCHIVED', title: 'Archived', color: 'gray' },
];

export function KanbanBoard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const role = localStorage.getItem('userRole') || 'CLIENT';
    setUserRole(role);
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const response = await api.get('/projects?page=1&limit=1000');
      setProjects(response.data.data);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      toast.error('Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  const canEditProject = () => {
    return ['ADMIN', 'MANAGER', 'STAFF'].includes(userRole);
  };

  const onDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result;

    // Dropped outside the list
    if (!destination) return;

    // Dropped in the same position
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      return;
    }

    // Check permissions
    if (!canEditProject()) {
      toast.error('You do not have permission to move projects');
      return;
    }

    const newStatus = destination.droppableId as Project['status'];
    const projectId = draggableId;

    // Optimistic update
    setProjects((prevProjects) =>
      prevProjects.map((c) =>
        c.id === projectId ? { ...c, status: newStatus } : c
      )
    );

    try {
      await api.patch(`/projects/${projectId}/status`, { status: newStatus });
      toast.success('Project status updated');
    } catch (error) {
      console.error('Failed to update project status:', error);
      toast.error('Failed to update project status');
      // Revert optimistic update
      fetchProjects();
    }
  };

  const getProjectsByStatus = (status: string) => {
    return projects.filter((c) => c.status === status);
  };

  if (!mounted || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            status={column.id}
            title={column.title}
            projects={getProjectsByStatus(column.id)}
            color={column.color}
          />
        ))}
      </div>
    </DragDropContext>
  );
}
