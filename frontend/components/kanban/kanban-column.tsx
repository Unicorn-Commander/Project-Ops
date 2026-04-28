'use client';

import { Droppable } from '@hello-pangea/dnd';
import { KanbanCard } from './kanban-card';

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

interface KanbanColumnProps {
  status: string;
  title: string;
  projects: Project[];
  color: string;
}

const statusColors = {
  NEW: 'bg-blue-100 border-blue-300',
  IN_PROGRESS: 'bg-yellow-100 border-yellow-300',
  UNDER_REVIEW: 'bg-purple-100 border-purple-300',
  COMPLETED: 'bg-green-100 border-green-300',
  ARCHIVED: 'bg-gray-100 border-gray-300',
};

const statusTextColors = {
  NEW: 'text-blue-800',
  IN_PROGRESS: 'text-yellow-800',
  UNDER_REVIEW: 'text-purple-800',
  COMPLETED: 'text-green-800',
  ARCHIVED: 'text-gray-800',
};

export function KanbanColumn({ status, title, projects, color }: KanbanColumnProps) {
  return (
    <div className="flex-shrink-0 w-80">
      <div className={`rounded-t-lg p-3 border-b-2 ${statusColors[status as keyof typeof statusColors]}`}>
        <div className="flex items-center justify-between">
          <h3 className={`font-semibold ${statusTextColors[status as keyof typeof statusTextColors]}`}>
            {title}
          </h3>
          <span className={`text-sm font-medium px-2 py-1 rounded-full ${statusColors[status as keyof typeof statusColors]}`}>
            {projects.length}
          </span>
        </div>
      </div>

      <Droppable droppableId={status}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`p-3 min-h-[calc(100vh-280px)] max-h-[calc(100vh-280px)] overflow-y-auto rounded-b-lg border-2 border-t-0 ${
              snapshot.isDraggingOver ? 'bg-gray-50 border-dashed' : 'bg-white'
            } ${statusColors[status as keyof typeof statusColors].split(' ')[1]}`}
          >
            {projects.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                No projects
              </div>
            ) : (
              projects.map((projectItem, index) => (
                <KanbanCard key={projectItem.id} project={projectItem} index={index} />
              ))
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
