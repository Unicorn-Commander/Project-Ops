'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  getOrganizationHierarchy,
  type Organization,
  getOrganizationTypeBadgeColor,
  getOrganizationTypeLabel,
} from '@/lib/organizations-api';
import { Building2, ChevronDown, ChevronRight, Users, Briefcase } from 'lucide-react';

interface HierarchyTreeProps {
  organizationId: string;
}

interface TreeNodeProps {
  organization: Organization;
  level: number;
}

export function HierarchyTree({ organizationId }: HierarchyTreeProps) {
  const [rootOrg, setRootOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadHierarchy();
  }, [organizationId]);

  async function loadHierarchy() {
    setLoading(true);
    setError(null);
    try {
      const data = await getOrganizationHierarchy(organizationId);
      setRootOrg(data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load organization hierarchy');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white p-8 rounded-lg border border-border-color shadow-sm">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-text-light mt-4">Loading hierarchy...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white p-8 rounded-lg border border-border-color shadow-sm">
        <div className="text-center">
          <p className="text-red-600">{error}</p>
          <button
            onClick={loadHierarchy}
            className="mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!rootOrg) {
    return (
      <div className="bg-white p-8 rounded-lg border border-border-color shadow-sm">
        <p className="text-center text-text-light">No organization data found.</p>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg border border-border-color shadow-sm">
      <div className="space-y-2">
        <TreeNode organization={rootOrg} level={0} />
      </div>
    </div>
  );
}

function TreeNode({ organization, level }: TreeNodeProps) {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = organization.childOrgs && organization.childOrgs.length > 0;

  function handleClick() {
    router.push(`/dashboard/organizations/${organization.id}`);
  }

  function toggleExpand(e: React.MouseEvent) {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  }

  return (
    <div className="select-none">
      {/* Organization Node */}
      <div
        className="flex items-center gap-3 p-4 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors group"
        style={{ marginLeft: `${level * 32}px` }}
      >
        {/* Expand/Collapse Button */}
        <button
          onClick={toggleExpand}
          className="flex-shrink-0 p-1 hover:bg-gray-200 rounded transition-colors"
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-4 w-4 text-text-light" />
            ) : (
              <ChevronRight className="h-4 w-4 text-text-light" />
            )
          ) : (
            <div className="h-4 w-4" /> // Spacer for alignment
          )}
        </button>

        {/* Organization Icon */}
        <div className="flex-shrink-0 p-2 bg-primary/10 rounded-lg">
          <Building2 className="h-5 w-5 text-primary" />
        </div>

        {/* Organization Details */}
        <div className="flex-1 min-w-0" onClick={handleClick}>
          <div className="flex items-center gap-2 mb-1">
            <p className="font-semibold text-text-dark truncate">{organization.name}</p>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${getOrganizationTypeBadgeColor(organization.type)}`}>
              {getOrganizationTypeLabel(organization.type)}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-text-light">
            <div className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              <span>{organization._count?.contacts || 0} contacts</span>
            </div>
            <div className="flex items-center gap-1">
              <Briefcase className="h-3 w-3" />
              <span>{organization._count?.projects || 0} projects</span>
            </div>
            {hasChildren && (
              <div className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                <span>{organization.childOrgs!.length} sub-org{organization.childOrgs!.length !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        </div>

        {/* Status Badge */}
        <div className="flex-shrink-0">
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
            organization.isActive
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}>
            {organization.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {/* Child Organizations */}
      {hasChildren && isExpanded && (
        <div className="space-y-2 mt-2">
          {organization.childOrgs!.map((child) => (
            <TreeNode key={child.id} organization={child} level={level + 1} />
          ))}
        </div>
      )}

      {/* Connecting Line */}
      {level > 0 && (
        <div
          className="absolute h-full w-px bg-border-color"
          style={{
            left: `${level * 32 - 16}px`,
            top: '0',
            height: '100%',
          }}
        />
      )}
    </div>
  );
}
