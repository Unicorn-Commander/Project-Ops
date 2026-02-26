'use client';

import { Draggable } from '@hello-pangea/dnd';
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
  index: number;
}

const priorityColors = {
  LOW: 'bg-gray-100 text-gray-800',
  MEDIUM: 'bg-blue-100 text-blue-800',
  HIGH: 'bg-orange-100 text-orange-800',
  URGENT: 'bg-red-100 text-red-800',
};

export function KanbanCard({ project: projectData, index }: KanbanCardProps) {
  const router = useRouter();

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
    <Draggable draggableId={projectData.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className="mb-2"
        >
          <Card
            className={`p-3 cursor-pointer transition-all hover:shadow-md ${
              snapshot.isDragging ? 'shadow-lg rotate-2' : ''
            }`}
            onClick={() => router.push(`/dashboard/projects/${projectData.id}`)}
          >
            <div className="space-y-2">
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
          </Card>
        </div>
      )}
    </Draggable>
  );
}
