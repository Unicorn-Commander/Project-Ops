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
import { Building2, Users, Briefcase, User, Plus, MoreVertical, Edit, Trash2, Network, Star as StarIcon, CheckSquare as CheckSquareIcon, ToggleLeft, ToggleRight } from 'lucide-react';
import { useStarred } from '@/lib/starred';
import { CreateOrganizationModal } from '@/components/modals/create-organization-modal';
import { EditOrganizationModal } from '@/components/modals/edit-organization-modal';
import { activeBadgeClass, iconWellClass } from '@/lib/badge-styles';
import { projectColorClasses } from '@/lib/project-colors';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { ListToolbar, FilterOption } from '@/components/ui/list-toolbar';
import { compareValues } from '@/lib/list-controls';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { BulkActionBar, BulkActionButton, useBulkRunner } from '@/components/ui/bulk-action-bar';
import api from '@/lib/api';

const TYPE_OPTIONS: FilterOption[] = [
  { value: 'ALL', label: 'All types' },
  { value: 'AGENCY', label: 'Agencies', dot: 'bg-violet-500' },
  { value: 'BUSINESS', label: 'Businesses', dot: 'bg-emerald-500' },
  { value: 'INDIVIDUAL', label: 'Individuals', dot: 'bg-amber-500' },
];

const ACTIVE_OPTIONS: FilterOption[] = [
  { value: 'ALL', label: 'Active + inactive' },
  { value: 'ACTIVE', label: 'Active only', dot: 'bg-emerald-500' },
  { value: 'INACTIVE', label: 'Inactive only', dot: 'bg-rose-500' },
];

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
  { value: 'createdAt-desc', label: 'Newest first' },
  { value: 'createdAt-asc', label: 'Oldest first' },
  { value: 'updatedAt-desc', label: 'Recently updated' },
];

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
  const [sortBy, setSortBy] = useState('name-asc');
  const { starred, toggle: toggleStar } = useStarred('organizations');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkActivate = useBulkRunner({
    op: (id: string) => api.patch(`/organizations/${id}`, { isActive: true }),
    label: 'Activated',
    successMessage: (ok, total) => `Activated ${ok} of ${total} organizations`,
    onAfter: async () => {
      setSelectedIds(new Set());
      await loadData();
    },
  });
  const bulkDeactivate = useBulkRunner({
    op: (id: string) => api.patch(`/organizations/${id}`, { isActive: false }),
    label: 'Deactivated',
    successMessage: (ok, total) => `Deactivated ${ok} of ${total} organizations`,
    onAfter: async () => {
      setSelectedIds(new Set());
      await loadData();
    },
  });
  const bulkDelete = useBulkRunner({
    op: (id: string) => api.delete(`/organizations/${id}`),
    label: 'Deleted',
    successMessage: (ok, total) => `Deleted ${ok} of ${total} organizations`,
    onAfter: async () => {
      setSelectedIds(new Set());
      await loadData();
    },
  });

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
        <div className="flex items-center gap-2">
          <ExportCsvButton
            data={organizations}
            filenameStem="organizations"
            dateField={{ label: 'Created', get: (o) => (o as any).createdAt ?? null }}
            statusField={{
              label: 'Type',
              options: TYPE_OPTIONS.filter((t) => t.value !== 'ALL').map((t) => ({
                value: t.value,
                label: t.label,
              })),
              get: (o) => o.type ?? null,
            }}
            buildHeader={() => ['Name', 'Type', 'Industry', 'Tax ID', 'Active', 'Created']}
            buildRow={(o) => [
              o.name ?? '',
              o.type ?? '',
              (o as any).industry ?? '',
              (o as any).taxId ?? '',
              o.isActive ? 'Yes' : 'No',
              (o as any).createdAt
                ? new Date((o as any).createdAt).toISOString().slice(0, 10)
                : '',
            ]}
          />
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-5 w-5" />
            New Organization
          </button>
        </div>
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

      {/* Toolbar — type / state filters + sort (v1.6.33). */}
      <ListToolbar
        search={{
          value: filters.search ?? '',
          onChange: (v) => setFilters({ ...filters, search: v }),
          placeholder: 'Search by name, tax ID, or industry…',
        }}
        filters={[
          {
            key: 'type',
            label: 'Type',
            value: filters.type ?? 'ALL',
            onChange: (v) => handleTypeFilter(v === 'ALL' ? undefined : (v as 'AGENCY' | 'BUSINESS' | 'INDIVIDUAL')),
            options: TYPE_OPTIONS,
          },
          {
            key: 'active',
            label: 'State',
            value: filters.isActive === undefined ? 'ALL' : filters.isActive ? 'ACTIVE' : 'INACTIVE',
            onChange: (v) => handleActiveFilter(v === 'ALL' ? undefined : v === 'ACTIVE'),
            options: ACTIVE_OPTIONS,
          },
        ]}
        sort={{
          value: sortBy,
          onChange: setSortBy,
          options: SORT_OPTIONS,
        }}
        views={{
          scope: "organizations",
          current: {
            type: filters.type ?? "ALL",
            active:
              filters.isActive === undefined ? "ALL" : filters.isActive ? "ACTIVE" : "INACTIVE",
            sortBy,
          },
          onApply: (state) => {
            if (state.type !== undefined) {
              handleTypeFilter(state.type === "ALL" ? undefined : (state.type as 'AGENCY' | 'BUSINESS' | 'INDIVIDUAL'));
            }
            if (state.active !== undefined) {
              handleActiveFilter(state.active === "ALL" ? undefined : state.active === "ACTIVE");
            }
            if (state.sortBy !== undefined) setSortBy(state.sortBy);
          },
        }}
      />

      <p className="text-xs text-muted-foreground -mt-3">
        {organizations.length} organisation{organizations.length === 1 ? '' : 's'}
      </p>

      {/* Organizations Table */}
      <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="pl-4 pr-2 py-3 w-10">
                <button
                  type="button"
                  onClick={() => {
                    const allSelected =
                      organizations.length > 0 &&
                      organizations.every((o) => selectedIds.has(o.id));
                    setSelectedIds((prev) => {
                      if (allSelected) return new Set();
                      const next = new Set(prev);
                      organizations.forEach((o) => next.add(o.id));
                      return next;
                    });
                  }}
                  className="h-5 w-5 rounded border border-border hover:border-primary inline-flex items-center justify-center transition-colors"
                  aria-label="Select all visible"
                >
                  {organizations.length > 0 &&
                    organizations.every((o) => selectedIds.has(o.id)) && (
                      <CheckSquareIcon className="h-4 w-4 text-primary" strokeWidth={2.5} />
                    )}
                </button>
              </th>
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
                <td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">
                  Loading organizations...
                </td>
              </tr>
            ) : organizations.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-0">
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
              [...organizations]
                .sort((a, b) => {
                  const [field, dir] = sortBy.split('-') as [string, 'asc' | 'desc'];
                  return compareValues((a as any)[field], (b as any)[field], dir);
                })
                .map((org) => {
                const oc = projectColorClasses(org.id);
                const isSelected = selectedIds.has(org.id);
                return (
                <tr
                  key={org.id}
                  onClick={() => handleRowClick(org)}
                  className={`hover:bg-muted/30 cursor-pointer transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                >
                  <td className="pl-4 pr-2 py-4 w-10">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelected(org.id);
                      }}
                      className="h-5 w-5 rounded border border-border hover:border-primary inline-flex items-center justify-center transition-colors"
                      aria-label={isSelected ? 'Deselect organization' : 'Select organization'}
                    >
                      {isSelected && (
                        <CheckSquareIcon className="h-4 w-4 text-primary" strokeWidth={2.5} />
                      )}
                    </button>
                  </td>
                  <td className={`px-6 py-4 border-l-4 ${oc.borderLeft} ${oc.cardWash}`}>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStar(org.id);
                        }}
                        className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted/60 transition-colors"
                        aria-label={starred.has(org.id) ? 'Unstar organization' : 'Star organization'}
                        title={starred.has(org.id) ? 'Unstar' : 'Star'}
                      >
                        <StarIcon
                          className={`h-4 w-4 ${
                            starred.has(org.id)
                              ? 'fill-amber-400 text-amber-500 dark:text-amber-400'
                              : 'text-muted-foreground/50 hover:text-muted-foreground'
                          }`}
                          strokeWidth={1.75}
                        />
                      </button>
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

      <BulkActionBar
        selectedCount={selectedIds.size}
        entityLabel="organization"
        onClear={() => setSelectedIds(new Set())}
      >
        <BulkActionButton
          icon={ToggleRight}
          pending={bulkActivate.pending}
          onClick={() => bulkActivate.run([...selectedIds])}
        >
          Activate
        </BulkActionButton>
        <BulkActionButton
          icon={ToggleLeft}
          pending={bulkDeactivate.pending}
          onClick={() => bulkDeactivate.run([...selectedIds])}
        >
          Deactivate
        </BulkActionButton>
        <BulkActionButton
          icon={Trash2}
          pending={bulkDelete.pending}
          onClick={() => {
            if (
              window.confirm(
                `Delete ${selectedIds.size} organization${selectedIds.size === 1 ? '' : 's'}? This will deactivate them (soft delete).`,
              )
            ) {
              bulkDelete.run([...selectedIds]);
            }
          }}
          destructive
        >
          Delete
        </BulkActionButton>
      </BulkActionBar>
    </div>
  );
}
