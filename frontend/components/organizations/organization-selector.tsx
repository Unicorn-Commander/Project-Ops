'use client';

import { useState, useEffect } from 'react';
import { Search, Building2, ChevronDown } from 'lucide-react';
import {
  getOrganizations,
  type Organization,
  getOrganizationTypeBadgeColor,
  getOrganizationTypeLabel,
} from '@/lib/organizations-api';

interface OrganizationSelectorProps {
  value?: string;
  onChange: (organizationId: string | undefined) => void;
  placeholder?: string;
  allowClear?: boolean;
}

export function OrganizationSelector({
  value,
  onChange,
  placeholder = 'Select organization...',
  allowClear = true,
}: OrganizationSelectorProps) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    loadOrganizations();
  }, []);

  async function loadOrganizations() {
    setLoading(true);
    try {
      const orgs = await getOrganizations({ isActive: true, limit: 100 });
      setOrganizations(orgs);
    } catch (error) {
      console.error('Failed to load organizations:', error);
    } finally {
      setLoading(false);
    }
  }

  const selectedOrg = organizations.find(org => org.id === value);

  const filteredOrgs = organizations.filter(org =>
    org.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    org.taxId?.includes(searchTerm) ||
    org.industry?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  function handleSelect(orgId: string) {
    onChange(orgId);
    setIsOpen(false);
    setSearchTerm('');
  }

  function handleClear() {
    onChange(undefined);
    setSearchTerm('');
  }

  return (
    <div className="relative">
      {/* Selected Value Display */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-left flex items-center justify-between"
      >
        {selectedOrg ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="p-1.5 bg-primary/10 rounded">
              <Building2 className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">{selectedOrg.name}</p>
              <p className="text-xs text-muted-foreground">
                {getOrganizationTypeLabel(selectedOrg.type)}
              </p>
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown Content */}
          <div className="absolute z-50 w-full mt-2 bg-popover border border-border rounded-lg shadow-lg max-h-80 overflow-hidden">
            {/* Search */}
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search organizations..."
                  className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  autoFocus
                />
              </div>
            </div>

            {/* Options List */}
            <div className="overflow-y-auto max-h-64">
              {allowClear && value && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="w-full px-4 py-2 text-left hover:bg-muted/40 transition-colors border-b border-border"
                >
                  <p className="text-sm text-muted-foreground">Clear selection</p>
                </button>
              )}

              {loading ? (
                <div className="p-8 text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
                  <p className="text-sm text-muted-foreground mt-2">Loading...</p>
                </div>
              ) : filteredOrgs.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-muted-foreground">No organizations found</p>
                </div>
              ) : (
                filteredOrgs.map((org) => (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => handleSelect(org.id)}
                    className={`w-full px-4 py-3 text-left hover:bg-muted/40 transition-colors border-b border-border last:border-0 ${
                      value === org.id ? 'bg-primary/5' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <Building2 className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium text-foreground truncate">{org.name}</p>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getOrganizationTypeBadgeColor(org.type)}`}>
                            {getOrganizationTypeLabel(org.type)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {org.industry && <span>{org.industry}</span>}
                          {org.taxId && <span>Tax ID: {org.taxId.slice(0, 2)}-***-{org.taxId.slice(-4)}</span>}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
