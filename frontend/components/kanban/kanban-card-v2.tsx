'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, User } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Project {
  id: string;
  projectNumber: string;
  clientName: string;
  projectType: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  dueDate?: string;
  assignedTo?: {
    id: string;
    name: string;
  };
}

interface KanbanCardProps {
  project: Project;
  isDragging?: boolean;
}

const priorityColors = {
  LOW: 'bg-gray-100 text-gray-800',
  MEDIUM: 'bg-blue-100 text-blue-800',
  HIGH: 'bg-orange-100 text-orange-800',
  URGENT: 'bg-red-100 text-red-800',
};

export function KanbanCard({ project: projectData, isDragging }: KanbanCardProps) {
  const router = useRouter();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging: isDraggingState,
  } = useDraggable({ id: projectData.id });

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging || isDraggingState ? 0.5 : 1,
  };

  const formatDueDate = (date?: string) => {
    if (!date) return null;
    const dueDate = new Date(date);
    const today = new Date();
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { text: 'Overdue', color: 'text-red-600' };
    if (diffDays === 0) return { text: 'Due today', color: 'text-orange-600' };
    if (diffDays <= 3) return { text: `${diffDays}d left`, color: 'text-orange-600' };
    return { text: `${diffDays}d left`, color: 'text-gray-600' };
  };

  const dueInfo = formatDueDate(projectData.dueDate);

  const getInitials = (name?: string) => {
    if (!name) return '??';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="mb-2"
    >
      <Card
        className={`p-3 pb-8 relative transition-all hover:shadow-md ${
          isDragging || isDraggingState ? 'shadow-lg opacity-80' : ''
        }`}
      >
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing select-none space-y-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-500">
                {projectData.projectNumber}
              </p>
              <p className="text-sm font-semibold text-gray-900 truncate mt-1">
                {projectData.clientName}
              </p>
            </div>
            <Badge className={`text-xs ${priorityColors[projectData.priority] || 'bg-gray-100 text-gray-800'}`}>
              {projectData.priority || 'MEDIUM'}
            </Badge>
          </div>

          <p className="text-xs text-gray-600 truncate">
            {projectData.projectType ? projectData.projectType.replace(/_/g, ' ') : 'No type'}
          </p>

          <div className="flex items-center justify-between pt-1">
            {dueInfo && (
              <div className="flex items-center gap-1">
                <Calendar className={`h-3 w-3 ${dueInfo.color}`} />
                <span className={`text-xs ${dueInfo.color}`}>
                  {dueInfo.text}
                </span>
              </div>
            )}

            {projectData.assignedTo && (
              <div className="flex items-center gap-1">
                <div className="h-6 w-6 rounded-full bg-primary text-white flex items-center justify-center text-xs">
                  {getInitials(projectData.assignedTo.name)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Click to open - separate from drag handle */}
        <button
          onClick={() => router.push(`/dashboard/projects/${projectData.id}`)}
          className="absolute bottom-2 right-2 text-xs text-primary hover:underline cursor-pointer"
          style={{ touchAction: 'none' }}
        >
          View →
        </button>
      </Card>
    </div>
  );
}
