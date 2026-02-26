'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  getOrganization,
  getOrganizationProjects,
  getContacts,
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
// import { EditContactModal } from '@/components/modals/edit-contact-modal'; // TODO: Create EditOrganizationContactModal
import { HierarchyTree } from '@/components/organizations/hierarchy-tree';

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

  function handleInviteToPortal(contact: OrganizationContact) {
    // TODO: Implement invite to portal
    console.log('Invite to portal:', contact.id);
  }

  if (loading || !organization) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-text-light mt-4">Loading organization...</p>
        </div>
      </div>
    );
  }

  const primaryContact = contacts.find(c => c.isPrimaryContact);
  const otherContacts = contacts.filter(c => !c.isPrimaryContact);

  // Calculate billing summary
  const totalBilled = cases.reduce((sum, c) => sum + (c.billingAmount || 0), 0);
  const totalPaid = cases.reduce((sum, c) => sum + (c.amountPaid || 0), 0);
  const outstanding = totalBilled - totalPaid;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="p-4 bg-primary/10 rounded-xl">
            <Building2 className="h-8 w-8 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-text-dark">{organization.name}</h1>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${getOrganizationTypeBadgeColor(organization.type)}`}>
                {getOrganizationTypeLabel(organization.type)}
              </span>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                organization.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {organization.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            {organization.parentOrg && (
              <div className="flex items-center gap-2 text-sm text-text-light mt-2">
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
      <div className="border-b border-border-color">
        <div className="flex gap-6">
          {['overview', 'contacts', 'projects', 'hierarchy'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 px-1 border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-text-light hover:text-text-dark'
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
            <div className="bg-white p-6 rounded-lg border border-border-color shadow-sm">
              <h2 className="text-xl font-semibold text-text-dark mb-4">Organization Information</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-text-light">Tax ID</label>
                  <p className="text-text-dark font-medium mt-1">{formatTaxId(organization.taxId)}</p>
                </div>
                <div>
                  <label className="text-sm text-text-light">Industry</label>
                  <p className="text-text-dark font-medium mt-1">{organization.industry || 'N/A'}</p>
                </div>
                {organization.website && (
                  <div className="col-span-2">
                    <label className="text-sm text-text-light">Website</label>
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
                  <label className="text-sm text-text-light">Address</label>
                  <div className="flex items-start gap-2 mt-1">
                    <MapPin className="h-4 w-4 text-text-light mt-0.5" />
                    <p className="text-text-dark">{formatAddress(organization)}</p>
                  </div>
                </div>
                {organization.notes && (
                  <div className="col-span-2">
                    <label className="text-sm text-text-light">Notes</label>
                    <p className="text-text-dark mt-1 whitespace-pre-wrap">{organization.notes}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-6 rounded-lg border border-border-color shadow-sm">
                <div className="flex items-center gap-3">
                  <Users className="h-8 w-8 text-primary" />
                  <div>
                    <p className="text-2xl font-bold text-text-dark">{organization._count?.contacts || 0}</p>
                    <p className="text-sm text-text-light">Contacts</p>
                  </div>
                </div>
              </div>
              <div className="bg-white p-6 rounded-lg border border-border-color shadow-sm">
                <div className="flex items-center gap-3">
                  <Users className="h-8 w-8 text-purple-600" />
                  <div>
                    <p className="text-2xl font-bold text-text-dark">{organization._count?.contacts || 0}</p>
                    <p className="text-sm text-text-light">Contacts</p>
                  </div>
                </div>
              </div>
              <div className="bg-white p-6 rounded-lg border border-border-color shadow-sm">
                <div className="flex items-center gap-3">
                  <Briefcase className="h-8 w-8 text-green-600" />
                  <div>
                    <p className="text-2xl font-bold text-text-dark">{organization._count?.projects || 0}</p>
                    <p className="text-sm text-text-light">Projects</p>
                  </div>
                </div>
              </div>
              <div className="bg-white p-6 rounded-lg border border-border-color shadow-sm">
                <div className="flex items-center gap-3">
                  <Building2 className="h-8 w-8 text-accent" />
                  <div>
                    <p className="text-2xl font-bold text-text-dark">{organization._count?.childOrgs || 0}</p>
                    <p className="text-sm text-text-light">Sub-Orgs</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Billing Summary */}
            <div className="bg-white p-6 rounded-lg border border-border-color shadow-sm">
              <h2 className="text-xl font-semibold text-text-dark mb-4">Billing Summary</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-text-light">Total Billed</label>
                  <p className="text-2xl font-bold text-text-dark mt-1">
                    ${totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-text-light">Total Paid</label>
                  <p className="text-2xl font-bold text-green-600 mt-1">
                    ${totalPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-text-light">Outstanding</label>
                  <p className="text-2xl font-bold text-red-600 mt-1">
                    ${outstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Primary Contact */}
          <div className="space-y-6">
            {primaryContact ? (
              <div className="bg-white p-6 rounded-lg border border-border-color shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-text-dark">Primary Contact</h2>
                  <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                </div>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                      {getContactInitials(primaryContact)}
                    </div>
                    <div>
                      <p className="font-semibold text-text-dark">
                        {primaryContact.firstName} {primaryContact.lastName}
                      </p>
                      {primaryContact.title && (
                        <p className="text-sm text-text-light">{primaryContact.title}</p>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-text-light" />
                      <a href={`mailto:${primaryContact.email}`} className="text-primary hover:underline">
                        {primaryContact.email}
                      </a>
                    </div>
                    {primaryContact.phone && (
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-4 w-4 text-text-light" />
                        <a href={`tel:${primaryContact.phone}`} className="text-primary hover:underline">
                          {primaryContact.phone}
                        </a>
                      </div>
                    )}
                  </div>
                  {primaryContact.portalAccessEnabled ? (
                    <div className="px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-sm text-green-800">Portal Access Enabled</p>
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
              <div className="bg-white p-6 rounded-lg border border-border-color shadow-sm">
                <h2 className="text-xl font-semibold text-text-dark mb-4">Primary Contact</h2>
                <p className="text-text-light text-center py-4">No primary contact set</p>
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
            <div className="bg-white p-6 rounded-lg border border-border-color shadow-sm">
              <h2 className="text-xl font-semibold text-text-dark mb-4">Portal Settings</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-light">Portal Access</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    organization.portalAccessEnabled
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
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
              <h2 className="text-xl font-semibold text-text-dark">Portal Contacts ({contacts.length})</h2>
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
                  className="bg-white p-6 rounded-lg border border-border-color shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                        {getContactInitials(contact)}
                      </div>
                      <div>
                        <p className="font-semibold text-text-dark">
                          {contact.firstName} {contact.lastName}
                        </p>
                        {contact.title && (
                          <p className="text-xs text-text-light">{contact.title}</p>
                        )}
                      </div>
                    </div>
                    {contact.isPrimaryContact && (
                      <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                    )}
                  </div>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-3 w-3 text-text-light" />
                      <a href={`mailto:${contact.email}`} className="text-primary hover:underline truncate">
                        {contact.email}
                      </a>
                    </div>
                    {contact.phone && (
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-3 w-3 text-text-light" />
                        <a href={`tel:${contact.phone}`} className="text-primary hover:underline">
                          {contact.phone}
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditContact(contact)}
                      className="flex-1 px-3 py-1.5 bg-gray-100 text-text-dark rounded-lg hover:bg-gray-200 transition-colors text-sm"
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
          <div className="bg-white p-6 rounded-lg border border-border-color shadow-sm">
            <h2 className="text-xl font-semibold text-text-dark mb-4">
              Linked Contacts ({organization.contacts?.length || 0})
            </h2>
            {organization.contacts && organization.contacts.length > 0 ? (
              <div className="space-y-3">
                {organization.contacts.map((contact: any) => (
                  <div
                    key={contact.id}
                    className="p-4 border border-border-color rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/dashboard/contacts/${contact.id}`)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-text-dark">
                            {contact.firstName} {contact.lastName}
                          </p>
                          {organization.primaryContactId === contact.id && (
                            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded-full">
                              Primary Contact
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1">
                          <div className="flex items-center gap-1 text-sm text-text-light">
                            <Mail className="h-3 w-3" />
                            <span>{contact.email}</span>
                          </div>
                          {contact.phone && (
                            <div className="flex items-center gap-1 text-sm text-text-light">
                              <Phone className="h-3 w-3" />
                              <span>{contact.phone}</span>
                            </div>
                          )}
                        </div>
                        {contact.company && (
                          <p className="text-sm text-text-light mt-1">
                            <Building2 className="h-3 w-3 inline mr-1" />
                            {contact.company}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-medium text-text-dark">
                            {contact._count?.projects || 0} {contact._count?.projects === 1 ? 'project' : 'projects'}
                          </p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          contact.isActive
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {contact.isActive ? 'Active' : 'Inactive'}
                        </span>
                        <ChevronRight className="h-5 w-5 text-text-light" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-text-light">
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
              <h2 className="text-xl font-semibold text-text-dark">Projects ({projects.length})</h2>
              {organization.type === 'CPA_FIRM' && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeChildProjects}
                    onChange={(e) => setIncludeChildProjects(e.target.checked)}
                    className="rounded border-border-color text-primary focus:ring-primary"
                  />
                  <span className="text-text-light">Include child organizations</span>
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

          <div className="bg-white rounded-lg border border-border-color shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-border-color">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-text-light uppercase">Case Title</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-text-light uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-text-light uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-text-light uppercase">Payment Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-text-light uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-color">
                {cases.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-text-light">
                      No cases found for this organization.
                    </td>
                  </tr>
                ) : (
                  projects.map((projectItem) => (
                    <tr key={projectItem.id} className="hover:bg-gray-50 cursor-pointer">
                      <td className="px-6 py-4">
                        <p className="font-medium text-text-dark">{projectItem.title}</p>
                        <p className="text-sm text-text-light">{projectItem.projectNumber}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {projectItem.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-text-dark">
                          ${(projectItem.billingAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          projectItem.paymentStatus === 'PAID'
                            ? 'bg-green-100 text-green-800'
                            : projectItem.paymentStatus === 'PARTIAL'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
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
          <h2 className="text-xl font-semibold text-text-dark">Organization Hierarchy</h2>
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

      {/* TODO: Create EditOrganizationContactModal for editing organization contacts */}
      {/* {editingContact && (
        <EditContactModal
          isOpen={!!editingContact}
          contact={editingContact}
          onClose={() => setEditingContact(null)}
          onSuccess={() => {
            setEditingContact(null);
            loadData();
          }}
        />
      )} */}
    </div>
  );
}
