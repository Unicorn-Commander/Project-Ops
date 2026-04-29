import api from './api';

// TypeScript interfaces (Contact defined below)
export interface Organization {
  id: string;
  name: string;
  type: 'AGENCY' | 'BUSINESS' | 'INDIVIDUAL';
  taxId?: string;
  industry?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  parentOrgId?: string;
  parentOrg?: Organization;
  childOrgs?: Organization[];
  contacts?: Contact[];
  primaryContactId?: string;
  isActive: boolean;
  portalAccessEnabled: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    contacts: number;
    projects: number;
    childOrgs: number;
    clients?: number;
  };
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  title?: string;
  organizationId?: string;
  organization?: Organization;
  userId?: string;
  isPrimaryContact: boolean;
  portalAccessEnabled: boolean;
  preferredContactMethod?: 'EMAIL' | 'PHONE' | 'SMS';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationFilters {
  search?: string;
  type?: 'AGENCY' | 'BUSINESS' | 'INDIVIDUAL';
  isActive?: boolean;
  industry?: string;
  page?: number;
  limit?: number;
}

export interface ContactFilters {
  search?: string;
  organizationId?: string;
  isPrimaryContact?: boolean;
  portalAccessEnabled?: boolean;
  page?: number;
  limit?: number;
}

export interface OrganizationStats {
  total: number;
  active: number;
  byType: {
    agency: number;
    business: number;
    individual: number;
    partner: number;
  };
  withPortalAccess: number;
  totalContacts: number;
}

export interface CreateOrganizationDto {
  name: string;
  type: 'AGENCY' | 'BUSINESS' | 'INDIVIDUAL' | 'PARTNER';
  taxId?: string;
  industry?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  parentOrgId?: string;
  portalAccessEnabled?: boolean;
  notes?: string;
}

export interface UpdateOrganizationDto extends Partial<CreateOrganizationDto> {
  isActive?: boolean;
}

export interface CreateContactDto {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  title?: string;
  organizationId?: string;
  isPrimaryContact?: boolean;
  portalAccessEnabled?: boolean;
  preferredContactMethod?: 'EMAIL' | 'PHONE' | 'SMS';
  notes?: string;
}

export interface UpdateContactDto extends Partial<CreateContactDto> {}

export interface InviteToPortalDto {
  sendEmail?: boolean;
  customMessage?: string;
}

// Organization API functions
export async function getOrganizations(filters?: OrganizationFilters) {
  const params = new URLSearchParams();
  if (filters?.search) params.append('search', filters.search);
  if (filters?.type) params.append('type', filters.type);
  if (filters?.isActive !== undefined) params.append('isActive', String(filters.isActive));
  if (filters?.industry) params.append('industry', filters.industry);
  if (filters?.page) params.append('page', String(filters.page));
  if (filters?.limit) params.append('limit', String(filters.limit));

  const response = await api.get<Organization[]>(`/organizations?${params.toString()}`);
  return response.data;
}

export async function getOrganization(id: string) {
  const response = await api.get<Organization>(`/organizations/${id}`);
  return response.data;
}

export async function createOrganization(data: CreateOrganizationDto) {
  const response = await api.post<Organization>('/organizations', data);
  return response.data;
}

export async function updateOrganization(id: string, data: UpdateOrganizationDto) {
  const response = await api.patch<Organization>(`/organizations/${id}`, data);
  return response.data;
}

export async function deleteOrganization(id: string) {
  const response = await api.delete(`/organizations/${id}`);
  return response.data;
}

export async function getOrganizationHierarchy(id: string) {
  const response = await api.get<Organization>(`/organizations/${id}/hierarchy`);
  return response.data;
}

export async function getOrganizationProjects(id: string, includeChildren: boolean = false) {
  const params = new URLSearchParams();
  params.append('includeChildren', String(includeChildren));

  const response = await api.get(`/organizations/${id}/projects?${params.toString()}`);
  return response.data;
}

export async function getOrganizationStats() {
  const response = await api.get<OrganizationStats>('/organizations/stats');
  return response.data;
}

// Contact API functions
export async function getContacts(filters?: ContactFilters) {
  const params = new URLSearchParams();
  if (filters?.search) params.append('search', filters.search);
  if (filters?.organizationId) params.append('organizationId', filters.organizationId);
  if (filters?.isPrimaryContact !== undefined) params.append('isPrimaryContact', String(filters.isPrimaryContact));
  if (filters?.portalAccessEnabled !== undefined) params.append('portalAccessEnabled', String(filters.portalAccessEnabled));
  if (filters?.page) params.append('page', String(filters.page));
  if (filters?.limit) params.append('limit', String(filters.limit));

  const response = await api.get<Contact[]>(`/contacts?${params.toString()}`);
  return response.data;
}

export async function getContact(id: string) {
  const response = await api.get<Contact>(`/contacts/${id}`);
  return response.data;
}

export async function createContact(data: CreateContactDto) {
  const response = await api.post<Contact>('/contacts', data);
  return response.data;
}

export async function updateContact(id: string, data: UpdateContactDto) {
  const response = await api.patch<Contact>(`/contacts/${id}`, data);
  return response.data;
}

export async function deleteContact(id: string) {
  const response = await api.delete(`/contacts/${id}`);
  return response.data;
}

export async function inviteContactToPortal(id: string, data?: InviteToPortalDto) {
  const response = await api.post(`/contacts/${id}/invite`, data || {});
  return response.data;
}

export async function setPrimaryContact(id: string) {
  const response = await api.patch<Contact>(`/contacts/${id}/set-primary`);
  return response.data;
}

// Utility functions
export function getOrganizationTypeBadgeColor(type: Organization['type']): string {
  switch (type) {
    case 'AGENCY':
      return 'bg-primary text-white';
    case 'BUSINESS':
      return 'bg-green-600 text-white';
    case 'INDIVIDUAL':
      return 'bg-accent text-white';
    default:
      return 'bg-gray-500 text-white';
  }
}

export function getOrganizationTypeLabel(type: Organization['type']): string {
  switch (type) {
    case 'AGENCY':
      return 'Agency';
    case 'BUSINESS':
      return 'Business';
    case 'INDIVIDUAL':
      return 'Individual';
    default:
      return type;
  }
}

export function formatTaxId(taxId?: string): string {
  if (!taxId) return 'N/A';
  return taxId;
}

export function getContactInitials(contact: Contact): string {
  return `${contact.firstName.charAt(0)}${contact.lastName.charAt(0)}`.toUpperCase();
}

export function formatAddress(org: Organization): string {
  const parts = [org.address, org.city, org.state, org.zipCode].filter(Boolean);
  return parts.join(', ') || 'No address provided';
}
