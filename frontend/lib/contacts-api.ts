import api from './api';

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  taxId?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  organization?: {
    id: string;
    name: string;
    type: string;
  };
  _count?: {
    projects: number;
  };
}

export interface CreateContactData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  taxId?: string;
  notes?: string;
  organizationId?: string;
  isActive?: boolean;
}

export interface ContactsResponse {
  data: Contact[];
  total: number;
  skip: number;
  take: number;
}

export interface ContactBillingSummary {
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  projectsCount: number;
  projects: Array<{
    id: string;
    projectNumber: string;
    title: string;
    billingAmount: number | null;
    amountPaid: number | null;
    paymentStatus: string | null;
    billingDate: string | null;
    paymentDueDate: string | null;
    paymentReceivedDate: string | null;
  }>;
}

export interface ContactStats {
  topContacts: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    company: string | null;
    projectsCount: number;
    totalBilled: number;
    totalPaid: number;
    outstanding: number;
  }>;
  totalContacts: number;
}

// Get all contacts with pagination and filters
export const getContacts = async (params?: {
  skip?: number;
  take?: number;
  search?: string;
  isActive?: boolean;
}): Promise<ContactsResponse> => {
  const response = await api.get('/contacts', { params });
  return response.data;
};

// Get single contact by ID
export const getContact = async (id: string): Promise<Contact> => {
  const response = await api.get(`/contacts/${id}`);
  return response.data;
};

// Create new contact
export const createContact = async (data: CreateContactData): Promise<Contact> => {
  const response = await api.post('/contacts', data);
  return response.data;
};

// Update contact
export const updateContact = async (
  id: string,
  data: Partial<CreateContactData>
): Promise<Contact> => {
  const response = await api.patch(`/contacts/${id}`, data);
  return response.data;
};

// Delete contact (soft delete)
export const deleteContact = async (id: string): Promise<void> => {
  await api.delete(`/contacts/${id}`);
};

// Get all projects for a contact
export const getContactProjects = async (
  id: string,
  params?: { skip?: number; take?: number }
) => {
  const response = await api.get(`/contacts/${id}/projects`, { params });
  return response.data;
};

// Get billing summary for a contact
export const getContactBilling = async (
  id: string
): Promise<ContactBillingSummary> => {
  const response = await api.get(`/contacts/${id}/billing`);
  return response.data;
};

// Get contact statistics for dashboard
export const getContactStats = async (): Promise<ContactStats> => {
  const response = await api.get('/contacts/stats');
  return response.data;
};

// Invite contact to portal
export interface InviteResponse {
  invitationToken: string;
  invitationUrl: string;
}

export const inviteContactToPortal = async (id: string): Promise<InviteResponse> => {
  const response = await api.post(`/contacts/${id}/invite`);
  return response.data;
};
