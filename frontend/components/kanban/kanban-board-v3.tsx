'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { KanbanColumn } from './kanban-column-v2';
import { KanbanCard } from './kanban-card-v2';
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
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  console.log('📋 KanbanBoard rendered with', projects.length, 'projects, mounted:', mounted);

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

  const handleDragStart = (event: DragStartEvent) => {
    console.log('🎯 DRAG START:', event.active.id);
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    console.log('🏁 DRAG END:', { active: active.id, over: over?.id });
    console.log('📊 Total projects in state:', projects.length);
    console.log('🔍 Looking for project ID:', active.id);
    console.log('📝 All project IDs:', projects.map(c => ({ id: c.id, projectNumber: c.projectNumber, status: c.status })));
    setActiveId(null);

    if (!over) {
      console.log('❌ No drop target');
      return;
    }

    const projectId = active.id as string;
    const newStatus = over.id as Project['status'];

    // Check if dropped on a different column
    const currentProject = projects.find((c) => c.id === projectId);
    if (!currentProject) {
      console.error('❌ Project not found:', projectId);
      console.error('Available project IDs:', projects.map(c => c.id));
      return;
    }

    console.log('📋 Current project:', { id: currentProject.id, projectNumber: currentProject.projectNumber, currentStatus: currentProject.status, newStatus });

    if (currentProject.status === newStatus) {
      console.log('⚠️ Same status, no change needed:', currentProject.status, '→', newStatus);
      return;
    }

    // Check permissions
    console.log('👤 User role:', userRole, 'Can edit:', canEditProject());
    if (!canEditProject()) {
      console.error('🚫 Permission denied! User role:', userRole);
      toast.error('You do not have permission to move projects');
      return;
    }

    console.log('📤 Updating project:', projectId, 'from', currentProject.status, 'to', newStatus);

    // Optimistic update
    setProjects((prevProjects) =>
      prevProjects.map((c) =>
        c.id === projectId ? { ...c, status: newStatus } : c
      )
    );

    try {
      const response = await api.patch(`/projects/${projectId}/status`, { status: newStatus });
      console.log('✅ API Response:', response.data);
      toast.success('Project status updated');
    } catch (error: any) {
      console.error('❌ Failed to update project status:', error);
      console.error('Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      toast.error(error.response?.data?.message || 'Failed to update project status');
      // Revert optimistic update
      fetchProjects();
    }
  };

  const getProjectsByStatus = (status: string) => {
    return projects.filter((c) => c.status === status);
  };

  const activeProject = activeId ? projects.find((c) => c.id === activeId) : null;

  if (!mounted || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            id={column.id}
            title={column.title}
            projects={getProjectsByStatus(column.id)}
            color={column.color}
          />
        ))}
      </div>
      <DragOverlay>
        {activeProject ? <KanbanCard project={activeProject} isDragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}
