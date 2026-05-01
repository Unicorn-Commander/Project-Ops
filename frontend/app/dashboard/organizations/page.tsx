'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  getOrganizations,
  getOrganizationStats,
  deleteOrganization,
  type Organization,
  type OrganizationFilters,
  type OrganizationStats,
  getOrganizationTypeBadgeColor,
  getOrganizationTypeLabel,
} from '@/lib/organizations-api';
import { Building2, Users, Briefcase, User, Plus, Search, Filter, MoreVertical, Edit, Trash2, Network } from 'lucide-react';
import { CreateOrganizationModal } from '@/components/modals/create-organization-modal';
import { EditOrganizationModal } from '@/components/modals/edit-organization-modal';
import { activeBadgeClass, iconWellClass } from '@/lib/badge-styles';
import { projectColorClasses } from '@/lib/project-colors';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';

export default function OrganizationsPage() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [stats, setStats] = useState<OrganizationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<OrganizationFilters>({
    search: '',
    type: undefined,
    isActive: true,
  });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [filters]);

  async function loadData() {
    setLoading(true);
    try {
      const [orgsData, statsData] = await Promise.all([
        getOrganizations(filters),
        getOrganizationStats(),
      ]);
      setOrganizations(orgsData);
      setStats(statsData);
    } catch (error) {
      console.error('Failed to load organizations:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    setFilters({ ...filters, search: e.target.value });
  }

  function handleTypeFilter(type: 'AGENCY' | 'BUSINESS' | 'INDIVIDUAL' | undefined) {
    setFilters({ ...filters, type });
  }

  function handleActiveFilter(isActive: boolean | undefined) {
    setFilters({ ...filters, isActive });
  }

  function handleRowClick(org: Organization) {
    router.push(`/dashboard/organizations/${org.id}`);
  }

  function handleEdit(org: Organization, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingOrg(org);
  }

  async function handleDelete(org: Organization, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete ${org.name}? This will deactivate the organization (soft delete).`)) {
      return;
    }
    try {
      await deleteOrganization(org.id);
      await loadData();
    } catch (err) {
      console.error('Failed to delete organization:', err);
      alert('Failed to delete organization. Please try again.');
    }
  }

  function handleViewHierarchy(org: Organization, e: React.MouseEvent) {
    e.stopPropagation();
    router.push(`/dashboard/organizations/${org.id}?tab=hierarchy`);
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Organizations</h1>
          <p className="text-muted-foreground mt-1">Manage CPA firms, businesses, and individual clients</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-5 w-5" />
          New Organization
        </button>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Organizations</p>
                <p className="text-3xl font-bold text-foreground mt-1">{stats.total}</p>
              </div>
              <div className={`p-3 rounded-lg ${iconWellClass("primary")}`}>
                <Building2 className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-3xl font-bold text-foreground mt-1">{stats.active}</p>
              </div>
              <div className={`p-3 rounded-lg ${iconWellClass("emerald")}`}>
                <Building2 className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Agencies</p>
                <p className="text-3xl font-bold text-foreground mt-1">{stats.byType.agency}</p>
              </div>
              <div className={`p-3 rounded-lg ${iconWellClass("primary")}`}>
                <Briefcase className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Businesses</p>
                <p className="text-3xl font-bold text-foreground mt-1">{stats.byType.business}</p>
              </div>
              <div className={`p-3 rounded-lg ${iconWellClass("emerald")}`}>
                <Building2 className="h-6 w-6" />
              </div>
            </div>
          </div>

          <div className="bg-card p-6 rounded-lg border border-border shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Individuals</p>
                <p className="text-3xl font-bold text-foreground mt-1">{stats.byType.individual}</p>
              </div>
              <div className={`p-3 rounded-lg ${iconWellClass("violet")}`}>
                <User className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-card p-4 rounded-lg border border-border shadow-sm">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by name, tax ID, or industry..."
                value={filters.search}
                onChange={handleSearch}
                className="w-full pl-10 pr-4 py-2 border border-border bg-background rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {/* Type Filter */}
          <div className="flex gap-2">
            <button
              onClick={() => handleTypeFilter(undefined)}
              className={`px-4 py-2 rounded-lg border transition-colors ${
                filters.type === undefined
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-foreground border-border hover:bg-muted/50'
              }`}
            >
              All Types
            </button>
            <button
              onClick={() => handleTypeFilter('AGENCY')}
              className={`px-4 py-2 rounded-lg border transition-colors ${
                filters.type === 'AGENCY'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-foreground border-border hover:bg-muted/50'
              }`}
            >
              Agencies
            </button>
            <button
              onClick={() => handleTypeFilter('BUSINESS')}
              className={`px-4 py-2 rounded-lg border transition-colors ${
                filters.type === 'BUSINESS'
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-card text-foreground border-border hover:bg-muted/50'
              }`}
            >
              Businesses
            </button>
            <button
              onClick={() => handleTypeFilter('INDIVIDUAL')}
              className={`px-4 py-2 rounded-lg border transition-colors ${
                filters.type === 'INDIVIDUAL'
                  ? 'bg-accent text-white border-accent'
                  : 'bg-card text-foreground border-border hover:bg-muted/50'
              }`}
            >
              Individuals
            </button>
          </div>

          {/* Active Filter */}
          <div className="flex gap-2">
            <button
              onClick={() => handleActiveFilter(undefined)}
              className={`px-4 py-2 rounded-lg border transition-colors ${
                filters.isActive === undefined
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-foreground border-border hover:bg-muted/50'
              }`}
            >
              All
            </button>
            <button
              onClick={() => handleActiveFilter(true)}
              className={`px-4 py-2 rounded-lg border transition-colors ${
                filters.isActive === true
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-card text-foreground border-border hover:bg-muted/50'
              }`}
            >
              Active
            </button>
            <button
              onClick={() => handleActiveFilter(false)}
              className={`px-4 py-2 rounded-lg border transition-colors ${
                filters.isActive === false
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-card text-foreground border-border hover:bg-muted/50'
              }`}
            >
              Inactive
            </button>
          </div>
        </div>
      </div>

      {/* Organizations Table */}
      <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Organization
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Industry
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Contacts
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Projects
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">
                  Loading organizations...
                </td>
              </tr>
            ) : organizations.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-0">
                  <EmptyState
                    icon={Building2}
                    iconTone="emerald"
                    title="No organizations yet"
                    body="Add your first client organization to start tracking projects, contacts, and billing against it."
                    action={
                      <Button onClick={() => setShowCreateModal(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        New organization
                      </Button>
                    }
                    className="m-4 border-0"
                  />
                </td>
              </tr>
            ) : (
              organizations.map((org) => {
                const oc = projectColorClasses(org.id);
                return (
                <tr
                  key={org.id}
                  onClick={() => handleRowClick(org)}
                  className="hover:bg-muted/30 cursor-pointer transition-colors"
                >
                  <td className={`px-6 py-4 border-l-4 ${oc.borderLeft} ${oc.cardWash}`}>
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${oc.badgeBg} ${oc.badgeText}`}>
                        <Building2 className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{org.name}</div>
                        {org.parentOrg && (
                          <div className="text-sm text-muted-foreground">
                            Parent: {org.parentOrg.name}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${getOrganizationTypeBadgeColor(org.type)}`}>
                      {getOrganizationTypeLabel(org.type)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-foreground">
                    {org.industry || 'N/A'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm text-foreground">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      {org._count?.contacts || 0}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm text-foreground">
                      <Briefcase className="h-4 w-4 text-muted-foreground" />
                      {org._count?.projects || 0}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${activeBadgeClass(org.isActive)}`}>
                      {org.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={(e) => handleViewHierarchy(org, e)}
                        className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                        title="View Hierarchy"
                      >
                        <Network className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => handleEdit(org, e)}
                        className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(org, e)}
                        className="p-2 text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateOrganizationModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            loadData();
          }}
        />
      )}

      {editingOrg && (
        <EditOrganizationModal
          isOpen={!!editingOrg}
          organization={editingOrg}
          onClose={() => setEditingOrg(null)}
          onSuccess={() => {
            setEditingOrg(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}
