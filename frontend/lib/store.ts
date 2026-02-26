import { create } from 'zustand';
import { User, Project } from '@/types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    set({ user: null, isAuthenticated: false });
  },
}));

interface ProjectState {
  projects: Project[];
  selectedProject: Project | null;
  setProjects: (projects: Project[]) => void;
  addProject: (projectItem: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  setSelectedProject: (projectItem: Project | null) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  selectedProject: null,
  setProjects: (projects) => set({ projects }),
  addProject: (projectItem) => set((state) => ({ projects: [...state.projects, projectItem] })),
  updateProject: (id, updates) =>
    set((state) => ({
      projects: state.projects.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),
  setSelectedProject: (projectItem) => set({ selectedProject: projectItem }),
}));
