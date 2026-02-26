export interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'MANAGER' | 'STAFF' | 'CLIENT';
  approved?: boolean;
  createdAt: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'UNDER_REVIEW' | 'COMPLETED' | 'REJECTED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  createdById: string;
  assignedToId?: string;
  createdAt: string;
  updatedAt: string;
  dueDate?: string;
  createdBy?: User;
  assignedTo?: User;
  documents?: Document[];
  comments?: Comment[];
}

export interface Document {
  id: string;
  projectId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedById: string;
  uploadedBy?: User;
  createdAt: string;
}

export interface Comment {
  id: string;
  projectId: string;
  userId: string;
  content: string;
  user?: User;
  createdAt: string;
}

export interface Activity {
  id: string;
  projectId: string;
  userId: string;
  action: string;
  details?: any;
  user?: User;
  createdAt: string;
}

export interface DashboardStats {
  totalProjects: number;
  pendingProjects: number;
  inProgressProjects: number;
  completedProjects: number;
  recentActivity: Activity[];
}