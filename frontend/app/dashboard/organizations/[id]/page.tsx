'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  getOrganization,
  getOrganizationProjects,
  getContacts,
  inviteContactToPortal,
  type Organization,
  type Contact as OrganizationContact,
  getOrganizationTypeBadgeColor,
  getOrganizationTypeLabel,
  formatTaxId,
  formatAddress,
  getContactInitials,
} from '@/lib/organizations-api';
import {
  Building2,
  Users,
  Briefcase,
  Edit,
  Plus,
  Mail,
  Phone,
  MapPin,
  Globe,
  FileText,
  DollarSign,
  Star,
  Network,
  ChevronRight,
  ExternalLink,
  UserPlus,
} from 'lucide-react';
import { EditOrganizationModal } from '@/components/modals/edit-organization-modal';
import { CreateContactModal } from '@/components/modals/create-contact-modal';
import { HierarchyTree } from '@/components/organizations/hierarchy-tree';
import { activeBadgeClass, statusBadgeClass, paymentStatusBadgeClass, iconWellClass } from '@/lib/badge-styles';
import { format } from 'date-fns';

export default function OrganizationProfilePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgId = params.id as string;
  const defaultTab = searchParams.get('tab') || 'overview';

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [contacts, setContacts] = useState<OrganizationContact[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [includeChildProjects, setIncludeChildProjects] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCreateContactModal, setShowCreateContactModal] = useState(false);
  const [editingContact, setEditingContact] = useState<OrganizationContact | null>(null);

  useEffect(() => {
    loadData();
  }, [orgId, includeChildProjects]);

  async function loadData() {
    setLoading(true);
    try {
      const [orgData, contactsData, projectsData] = await Promise.all([
        getOrganization(orgId),
        getContacts({ organizationId: orgId }),
        getOrganizationProjects(orgId, includeChildProjects),
      ]);
      setOrganization(orgData);
      setContacts(contactsData);
      setProjects(projectsData);
    } catch (error) {
      console.error('Failed to load organization:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleEditContact(contact: OrganizationContact) {
    setEditingContact(contact);
  }

  async function handleInviteToPortal(contact: OrganizationContact) {
    if (!contact.email) {
      alert('This contact has no email address. Add one before sending an invite.');
      return;
    }
    try {
      await inviteContactToPortal(contact.id);
      alert(`Portal invitation sent to ${contact.email}.`);
      await loadData();
    } catch (err: any) {
      console.error('Failed to invite contact:', err);
      const message =
        err?.response?.data?.message ||
        'Failed to send portal invitation. Please try again.';
      alert(message);
    }
  }

  if (loading || !organization) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground mt-4">Loading organization...</p>
        </div>
      </div>
    );
  }

  const primaryContact = contacts.find(c => c.isPrimaryContact);
  const otherContacts = contacts.filter(c => !c.isPrimaryContact);

  // Calculate billing summary
  const totalBilled = projects.reduce((sum: number, p: any) => sum + (p.billingAmount || 0), 0);
  const totalPaid = projects.reduce((sum: number, p: any) => sum + (p.amountPaid || 0), 0);
  const outstanding = totalBilled - totalPaid;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className={`p-4 rounded-xl ${iconWellClass("primary")}`}>
            <Building2 className="h-8 w-8" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-foreground">{organization.name}</h1>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${getOrganizationTypeBadgeColor(organization.type)}`}>
                {getOrganizationTypeLabel(organization.type)}
              </span>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${activeBadgeClass(organization.isActive)}`}>
                {organization.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            {organization.parentOrg && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                <span>Parent Organization:</span>
                <button
                  onClick={() => router.push(`/dashboard/organizations/${organization.parentOrg!.id}`)}
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  {organization.parentOrg.name}
                  <ExternalLink className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowEditModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
        >
          <Edit className="h-4 w-4" />
          Edit Organization
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-6">
          {['overview', 'contacts', 'projects', 'hierarchy'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 px-1 border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Organization Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Information */}
            <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
              <h2 className="text-xl font-semibold text-foreground mb-4">Organization Information</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">Tax ID</label>
                  <p className="text-foreground font-medium mt-1">{formatTaxId(organization.taxId)}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Industry</label>
                  <p className="text-foreground font-medium mt-1">{organization.industry || 'N/A'}</p>
                </div>
                {organization.website && (
                  <div className="col-span-2">
                    <label className="text-sm text-muted-foreground">Website</label>
                    <a
                      href={organization.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-2 mt-1"
                    >
                      <Globe className="h-4 w-4" />
                      {organization.website}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
                <div className="col-span-2">
                  <label className="text-sm text-muted-foreground">Address</label>
                  <div className="flex items-start gap-2 mt-1">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <p className="text-foreground">{formatAddress(organization)}</p>
                  </div>
                </div>
                {organization.notes && (
                  <div className="col-span-2">
                    <label className="text-sm text-muted-foreground">Notes</label>
                    <p className="text-foreground mt-1 whitespace-pre-wrap">{organization.notes}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
                <div className="flex items-center gap-3">
                  <Users className="h-8 w-8 text-primary" />
                  <div>
                    <p className="text-2xl font-bold text-foreground">{organization._count?.contacts || 0}</p>
                    <p className="text-sm text-muted-foreground">Contacts</p>
                  </div>
                </div>
              </div>
              <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
                <div className="flex items-center gap-3">
                  <Users className="h-8 w-8 text-violet-600 dark:text-violet-400" />
                  <div>
                    <p className="text-2xl font-bold text-foreground">{organization._count?.contacts || 0}</p>
                    <p className="text-sm text-muted-foreground">Contacts</p>
                  </div>
                </div>
              </div>
              <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
                <div className="flex items-center gap-3">
                  <Briefcase className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <p className="text-2xl font-bold text-foreground">{organization._count?.projects || 0}</p>
                    <p className="text-sm text-muted-foreground">Projects</p>
                  </div>
                </div>
              </div>
              <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
                <div className="flex items-center gap-3">
                  <Building2 className="h-8 w-8 text-accent" />
                  <div>
                    <p className="text-2xl font-bold text-foreground">{organization._count?.childOrgs || 0}</p>
                    <p className="text-sm text-muted-foreground">Sub-Orgs</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Billing Summary */}
            <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
              <h2 className="text-xl font-semibold text-foreground mb-4">Billing Summary</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">Total Billed</label>
                  <p className="text-2xl font-bold text-foreground mt-1">
                    ${totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Total Paid</label>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    ${totalPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Outstanding</label>
                  <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
                    ${outstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Primary Contact */}
          <div className="space-y-6">
            {primaryContact ? (
              <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-foreground">Primary Contact</h2>
                  <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                </div>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className={`h-12 w-12 rounded-full flex items-center justify-center font-semibold ${iconWellClass("primary")}`}>
                      {getContactInitials(primaryContact)}
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">
                        {primaryContact.firstName} {primaryContact.lastName}
                      </p>
                      {primaryContact.title && (
                        <p className="text-sm text-muted-foreground">{primaryContact.title}</p>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <a href={`mailto:${primaryContact.email}`} className="text-primary hover:underline">
                        {primaryContact.email}
                      </a>
                    </div>
                    {primaryContact.phone && (
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <a href={`tel:${primaryContact.phone}`} className="text-primary hover:underline">
                          {primaryContact.phone}
                        </a>
                      </div>
                    )}
                  </div>
                  {primaryContact.portalAccessEnabled ? (
                    <div className="px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                      <p className="text-sm text-emerald-700 dark:text-emerald-300">Portal Access Enabled</p>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleInviteToPortal(primaryContact)}
                      className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors text-sm"
                    >
                      <UserPlus className="h-4 w-4 inline mr-2" />
                      Invite to Portal
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
                <h2 className="text-xl font-semibold text-foreground mb-4">Primary Contact</h2>
                <p className="text-muted-foreground text-center py-4">No primary contact set</p>
                <button
                  onClick={() => setShowCreateContactModal(true)}
                  className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
                >
                  <Plus className="h-4 w-4 inline mr-2" />
                  Add Contact
                </button>
              </div>
            )}

            {/* Portal Access Status */}
            <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
              <h2 className="text-xl font-semibold text-foreground mb-4">Portal Settings</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Portal Access</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${activeBadgeClass(organization.portalAccessEnabled)}`}>
                    {organization.portalAccessEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contacts Tab */}
      {activeTab === 'contacts' && (
        <div className="space-y-6">
          {/* Portal Contacts Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-foreground">Portal Contacts ({contacts.length})</h2>
              <button
                onClick={() => setShowCreateContactModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add Contact
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="bg-card p-6 rounded-lg border border-border shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center font-semibold text-sm ${iconWellClass("primary")}`}>
                        {getContactInitials(contact)}
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">
                          {contact.firstName} {contact.lastName}
                        </p>
                        {contact.title && (
                          <p className="text-xs text-muted-foreground">{contact.title}</p>
                        )}
                      </div>
                    </div>
                    {contact.isPrimaryContact && (
                      <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                    )}
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-3 w-3 text-muted-foreground" />
                      <a href={`mailto:${contact.email}`} className="text-primary hover:underline truncate">
                        {contact.email}
                      </a>
                    </div>
                    {contact.phone && (
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        <a href={`tel:${contact.phone}`} className="text-primary hover:underline">
                          {contact.phone}
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditContact(contact)}
                      className="flex-1 px-3 py-1.5 bg-muted text-foreground rounded-lg hover:bg-muted/70 transition-colors text-sm"
                    >
                      Edit
                    </button>
                    {!contact.portalAccessEnabled && (
                      <button
                        onClick={() => handleInviteToPortal(contact)}
                        className="flex-1 px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors text-sm"
                      >
                        Invite
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Contacts Section */}
          <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
            <h2 className="text-xl font-semibold text-foreground mb-4">
              Linked Contacts ({organization.contacts?.length || 0})
            </h2>
            {organization.contacts && organization.contacts.length > 0 ? (
              <div className="space-y-3">
                {organization.contacts.map((contact: any) => (
                  <div
                    key={contact.id}
                    className="p-4 border border-border rounded-lg hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => router.push(`/dashboard/contacts/${contact.id}`)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-foreground">
                            {contact.firstName} {contact.lastName}
                          </p>
                          {organization.primaryContactId === contact.id && (
                            <span className={`px-2 py-0.5 text-xs rounded-full ${statusBadgeClass("NEW")}`}>
                              Primary Contact
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1">
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Mail className="h-3 w-3" />
                            <span>{contact.email}</span>
                          </div>
                          {contact.phone && (
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Phone className="h-3 w-3" />
                              <span>{contact.phone}</span>
                            </div>
                          )}
                        </div>
                        {contact.company && (
                          <p className="text-sm text-muted-foreground mt-1">
                            <Building2 className="h-3 w-3 inline mr-1" />
                            {contact.company}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-medium text-foreground">
                            {contact._count?.projects || 0} {contact._count?.projects === 1 ? 'project' : 'projects'}
                          </p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${activeBadgeClass(contact.isActive)}`}>
                          {contact.isActive ? 'Active' : 'Inactive'}
                        </span>
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="text-lg font-medium mb-1">No contacts linked to this organization</p>
                <p className="text-sm">Contacts will appear here when they are assigned to this organization</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Projects Tab */}
      {activeTab === 'projects' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-semibold text-foreground">Projects ({projects.length})</h2>
              {organization.type === 'AGENCY' && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeChildProjects}
                    onChange={(e) => setIncludeChildProjects(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-muted-foreground">Include child organizations</span>
                </label>
              )}
            </div>
            <button
              onClick={() => router.push(`/dashboard/projects/new?organizationId=${orgId}`)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add Case
            </button>
          </div>

          <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Case Title</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Payment Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {projects.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                      No projects found for this organization.
                    </td>
                  </tr>
                ) : (
                  projects.map((projectItem) => (
                    <tr key={projectItem.id} className="hover:bg-muted/30 cursor-pointer">
                      <td className="px-6 py-4">
                        <p className="font-medium text-foreground">{projectItem.title}</p>
                        <p className="text-sm text-muted-foreground">{projectItem.projectNumber}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusBadgeClass(projectItem.status)}`}>
                          {projectItem.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-foreground">
                          ${(projectItem.billingAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${paymentStatusBadgeClass(projectItem.paymentStatus || 'UNPAID')}`}>
                          {projectItem.paymentStatus || 'UNPAID'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => router.push(`/dashboard/projects/${projectItem.id}`)}
                          className="text-primary hover:underline text-sm"
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Hierarchy Tab */}
      {activeTab === 'hierarchy' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Organization Hierarchy</h2>
          <HierarchyTree organizationId={orgId} />
        </div>
      )}

      {/* Modals */}
      {showEditModal && (
        <EditOrganizationModal
          isOpen={showEditModal}
          organization={organization}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            loadData();
          }}
        />
      )}

      {showCreateContactModal && (
        <CreateContactModal
          isOpen={showCreateContactModal}
          organizationId={orgId}
          onClose={() => setShowCreateContactModal(false)}
          onSuccess={() => {
            setShowCreateContactModal(false);
            loadData();
          }}
        />
      )}

    </div>
  );
}
