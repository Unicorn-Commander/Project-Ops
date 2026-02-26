'use client';

import { useState, useEffect } from 'react';
import { X, Building2, Briefcase, User as UserIcon } from 'lucide-react';
import {
  updateOrganization,
  getOrganizations,
  type UpdateOrganizationDto,
  type Organization,
} from '@/lib/organizations-api';

interface EditOrganizationModalProps {
  isOpen: boolean;
  organization: Organization;
  onClose: () => void;
  onSuccess: () => void;
}

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

export function EditOrganizationModal({ isOpen, organization, onClose, onSuccess }: EditOrganizationModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parentOrganizations, setParentOrganizations] = useState<Organization[]>([]);
  const [formData, setFormData] = useState<UpdateOrganizationDto>({
    name: organization.name,
    type: organization.type,
    taxId: organization.taxId || '',
    industry: organization.industry || '',
    website: organization.website || '',
    address: organization.address || '',
    city: organization.city || '',
    state: organization.state || '',
    zipCode: organization.zipCode || '',
    parentOrgId: organization.parentOrgId || undefined,
    isActive: organization.isActive,
    portalAccessEnabled: organization.portalAccessEnabled,
    notes: organization.notes || '',
  });

  useEffect(() => {
    if (isOpen) {
      loadParentOrganizations();
      // Reset form data when organization changes
      setFormData({
        name: organization.name,
        type: organization.type,
        taxId: organization.taxId || '',
        industry: organization.industry || '',
        website: organization.website || '',
        address: organization.address || '',
        city: organization.city || '',
        state: organization.state || '',
        zipCode: organization.zipCode || '',
        parentOrgId: organization.parentOrgId || undefined,
        isActive: organization.isActive,
        portalAccessEnabled: organization.portalAccessEnabled,
        notes: organization.notes || '',
      });
    }
  }, [isOpen, organization]);

  async function loadParentOrganizations() {
    try {
      const orgs = await getOrganizations({ type: 'CPA_FIRM', isActive: true });
      // Filter out the current organization and its descendants
      const filtered = orgs.filter(org => org.id !== organization.id);
      setParentOrganizations(filtered);
    } catch (error) {
      console.error('Failed to load parent organizations:', error);
    }
  }

  function handleInputChange(field: keyof UpdateOrganizationDto, value: any) {
    setFormData({ ...formData, [field]: value });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validation
    if (!formData.name?.trim()) {
      setError('Organization name is required');
      return;
    }

    // Tax ID validation (optional but validate format if provided)
    if (formData.taxId) {
      const cleanTaxId = formData.taxId.replace(/\D/g, '');
      if (cleanTaxId.length !== 9) {
        setError('Tax ID must be 9 digits (EIN or SSN format)');
        return;
      }
    }

    setLoading(true);

    try {
      await updateOrganization(organization.id, {
        ...formData,
        taxId: formData.taxId ? formData.taxId.replace(/\D/g, '') : undefined,
        state: formData.state?.toUpperCase(),
      });
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update organization');
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-color sticky top-0 bg-white rounded-t-xl">
          <h2 className="text-2xl font-bold text-text-dark">Edit Organization</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Organization Type Display (Read-only) */}
          <div>
            <label className="block text-sm font-medium text-text-dark mb-3">
              Organization Type
            </label>
            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-border-color">
              {organization.type === 'CPA_FIRM' && (
                <>
                  <Building2 className="h-6 w-6 text-primary" />
                  <div>
                    <p className="font-semibold text-text-dark">CPA Firm</p>
                    <p className="text-xs text-text-light">Organization type cannot be changed</p>
                  </div>
                </>
              )}
              {organization.type === 'BUSINESS' && (
                <>
                  <Briefcase className="h-6 w-6 text-green-600" />
                  <div>
                    <p className="font-semibold text-text-dark">Business</p>
                    <p className="text-xs text-text-light">Organization type cannot be changed</p>
                  </div>
                </>
              )}
              {organization.type === 'INDIVIDUAL' && (
                <>
                  <UserIcon className="h-6 w-6 text-accent" />
                  <div>
                    <p className="font-semibold text-text-dark">Individual</p>
                    <p className="text-xs text-text-light">Organization type cannot be changed</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-text-dark">Basic Information</h3>

            <div>
              <label className="block text-sm font-medium text-text-dark mb-2">
                {organization.type === 'INDIVIDUAL' ? 'Full Name' : 'Organization Name'} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                className="w-full px-4 py-2 border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-dark mb-2">
                  Tax ID (EIN or SSN)
                </label>
                <input
                  type="text"
                  value={formData.taxId}
                  onChange={(e) => handleInputChange('taxId', e.target.value)}
                  placeholder="XX-XXXXXXX"
                  className="w-full px-4 py-2 border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {organization.type === 'BUSINESS' && (
                <div>
                  <label className="block text-sm font-medium text-text-dark mb-2">
                    Industry
                  </label>
                  <input
                    type="text"
                    value={formData.industry}
                    onChange={(e) => handleInputChange('industry', e.target.value)}
                    placeholder="Healthcare, Technology, etc."
                    className="w-full px-4 py-2 border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              {organization.type !== 'INDIVIDUAL' && (
                <div className={organization.type === 'BUSINESS' ? 'col-span-2' : ''}>
                  <label className="block text-sm font-medium text-text-dark mb-2">
                    Website
                  </label>
                  <input
                    type="url"
                    value={formData.website}
                    onChange={(e) => handleInputChange('website', e.target.value)}
                    placeholder="https://example.com"
                    className="w-full px-4 py-2 border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Address */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-text-dark">Address</h3>

            <div>
              <label className="block text-sm font-medium text-text-dark mb-2">
                Street Address
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => handleInputChange('address', e.target.value)}
                placeholder="123 Main Street"
                className="w-full px-4 py-2 border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-dark mb-2">
                  City
                </label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => handleInputChange('city', e.target.value)}
                  placeholder="New York"
                  className="w-full px-4 py-2 border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-dark mb-2">
                  State
                </label>
                <select
                  value={formData.state}
                  onChange={(e) => handleInputChange('state', e.target.value)}
                  className="w-full px-4 py-2 border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select State</option>
                  {US_STATES.map(state => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-dark mb-2">
                  Zip Code
                </label>
                <input
                  type="text"
                  value={formData.zipCode}
                  onChange={(e) => handleInputChange('zipCode', e.target.value)}
                  placeholder="10001"
                  maxLength={10}
                  className="w-full px-4 py-2 border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Hierarchy */}
          {organization.type !== 'CPA_FIRM' && parentOrganizations.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-text-dark mb-2">
                Parent Organization
              </label>
              <select
                value={formData.parentOrgId || ''}
                onChange={(e) => handleInputChange('parentOrgId', e.target.value || undefined)}
                className="w-full px-4 py-2 border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">None (Independent)</option>
                {parentOrganizations.map(org => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-text-light mt-1">
                Link this organization to a parent CPA firm
              </p>
            </div>
          )}

          {/* Status */}
          <div className="space-y-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(e) => handleInputChange('isActive', e.target.checked)}
                className="rounded border-border-color text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium text-text-dark">Active Organization</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.portalAccessEnabled}
                onChange={(e) => handleInputChange('portalAccessEnabled', e.target.checked)}
                className="rounded border-border-color text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium text-text-dark">Enable Portal Access</span>
            </label>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-text-dark mb-2">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleInputChange('notes', e.target.value)}
              rows={3}
              placeholder="Additional information about this organization..."
              className="w-full px-4 py-2 border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border-color">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 border border-border-color text-text-dark rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
