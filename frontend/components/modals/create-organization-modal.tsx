'use client';

import { useState, useEffect } from 'react';
import { Building2, Briefcase, User as UserIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  createOrganization,
  getOrganizations,
  type CreateOrganizationDto,
  type Organization,
} from '@/lib/organizations-api';

interface CreateOrganizationModalProps {
  isOpen: boolean;
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

export function CreateOrganizationModal({ isOpen, onClose, onSuccess }: CreateOrganizationModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'AGENCY' | 'BUSINESS' | 'INDIVIDUAL'>('BUSINESS');
  const [parentOrganizations, setParentOrganizations] = useState<Organization[]>([]);
  const [formData, setFormData] = useState<CreateOrganizationDto>({
    name: '',
    type: 'BUSINESS',
    taxId: '',
    industry: '',
    website: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    parentOrgId: undefined,
    portalAccessEnabled: false,
    notes: '',
  });

  useEffect(() => {
    if (isOpen) {
      loadParentOrganizations();
    }
  }, [isOpen]);

  async function loadParentOrganizations() {
    try {
      const orgs = await getOrganizations({ type: 'AGENCY', isActive: true });
      setParentOrganizations(orgs);
    } catch (error) {
      console.error('Failed to load parent organizations:', error);
    }
  }

  function handleTypeChange(type: 'AGENCY' | 'BUSINESS' | 'INDIVIDUAL') {
    setSelectedType(type);
    setFormData({ ...formData, type });
  }

  function handleInputChange(field: keyof CreateOrganizationDto, value: any) {
    setFormData({ ...formData, [field]: value });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validation
    if (!formData.name.trim()) {
      setError('Organization name is required');
      return;
    }

    setLoading(true);

    try {
      await createOrganization({
        ...formData,
        taxId: formData.taxId?.trim() || undefined,
        state: formData.state?.toUpperCase(),
      });
      onSuccess();
      resetForm();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create organization');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setFormData({
      name: '',
      type: 'BUSINESS',
      taxId: '',
      industry: '',
      website: '',
      address: '',
      city: '',
      state: '',
      zipCode: '',
      parentOrgId: undefined,
      portalAccessEnabled: false,
      notes: '',
    });
    setSelectedType('BUSINESS');
    setError(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent
        overlayClassName="bg-black/50"
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-card rounded-xl shadow-2xl"
      >
        {/* Header */}
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Create Organization</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg">
              <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
            </div>
          )}

          {/* Organization Type Selection */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-3">
              Organization Type <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => handleTypeChange('AGENCY')}
                className={`p-6 rounded-lg border-2 transition-all ${
                  selectedType === 'AGENCY'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-foreground/40'
                }`}
              >
                <Building2 className={`h-8 w-8 mx-auto mb-2 ${
                  selectedType === 'AGENCY' ? 'text-primary' : 'text-muted-foreground'
                }`} />
                <p className="font-semibold text-foreground">Agency</p>
                <p className="text-xs text-muted-foreground mt-1">Your firm or parent organization</p>
              </button>

              <button
                type="button"
                onClick={() => handleTypeChange('BUSINESS')}
                className={`p-6 rounded-lg border-2 transition-all ${
                  selectedType === 'BUSINESS'
                    ? 'border-green-600 bg-green-500/10'
                    : 'border-border hover:border-foreground/40'
                }`}
              >
                <Briefcase className={`h-8 w-8 mx-auto mb-2 ${
                  selectedType === 'BUSINESS' ? 'text-green-600' : 'text-muted-foreground'
                }`} />
                <p className="font-semibold text-foreground">Business</p>
                <p className="text-xs text-muted-foreground mt-1">Corporate or LLC client</p>
              </button>

              <button
                type="button"
                onClick={() => handleTypeChange('INDIVIDUAL')}
                className={`p-6 rounded-lg border-2 transition-all ${
                  selectedType === 'INDIVIDUAL'
                    ? 'border-accent bg-accent/5'
                    : 'border-border hover:border-foreground/40'
                }`}
              >
                <UserIcon className={`h-8 w-8 mx-auto mb-2 ${
                  selectedType === 'INDIVIDUAL' ? 'text-accent' : 'text-muted-foreground'
                }`} />
                <p className="font-semibold text-foreground">Individual</p>
                <p className="text-xs text-muted-foreground mt-1">Individual taxpayer</p>
              </button>
            </div>
          </div>

          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Basic Information</h3>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                {selectedType === 'INDIVIDUAL' ? 'Full Name' : 'Organization Name'} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder={selectedType === 'INDIVIDUAL' ? 'John Doe' : 'Acme Corporation'}
                className="w-full px-4 py-2 border border-border bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Tax ID / Identifier
                </label>
                <input
                  type="text"
                  value={formData.taxId}
                  onChange={(e) => handleInputChange('taxId', e.target.value)}
                  placeholder="EIN, VAT, registry number, etc."
                  className="w-full px-4 py-2 border border-border bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {selectedType === 'BUSINESS' && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Industry
                  </label>
                  <input
                    type="text"
                    value={formData.industry}
                    onChange={(e) => handleInputChange('industry', e.target.value)}
                    placeholder="Healthcare, Technology, etc."
                    className="w-full px-4 py-2 border border-border bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}

              {selectedType !== 'INDIVIDUAL' && (
                <div className={selectedType === 'BUSINESS' ? 'col-span-2' : ''}>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Website
                  </label>
                  <input
                    type="url"
                    value={formData.website}
                    onChange={(e) => handleInputChange('website', e.target.value)}
                    placeholder="https://example.com"
                    className="w-full px-4 py-2 border border-border bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Address */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Address (Optional)</h3>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Street Address
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => handleInputChange('address', e.target.value)}
                placeholder="123 Main Street"
                className="w-full px-4 py-2 border border-border bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  City
                </label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => handleInputChange('city', e.target.value)}
                  placeholder="New York"
                  className="w-full px-4 py-2 border border-border bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  State
                </label>
                <select
                  value={formData.state}
                  onChange={(e) => handleInputChange('state', e.target.value)}
                  className="w-full px-4 py-2 border border-border bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select State</option>
                  {US_STATES.map(state => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Zip Code
                </label>
                <input
                  type="text"
                  value={formData.zipCode}
                  onChange={(e) => handleInputChange('zipCode', e.target.value)}
                  placeholder="10001"
                  maxLength={10}
                  className="w-full px-4 py-2 border border-border bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Hierarchy */}
          {selectedType !== 'AGENCY' && parentOrganizations.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Parent Organization (Optional)
              </label>
              <select
                value={formData.parentOrgId || ''}
                onChange={(e) => handleInputChange('parentOrgId', e.target.value || undefined)}
                className="w-full px-4 py-2 border border-border bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">None (Independent)</option>
                {parentOrganizations.map(org => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Link this organization to a parent CPA firm
              </p>
            </div>
          )}

          {/* Portal Settings */}
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.portalAccessEnabled}
                onChange={(e) => handleInputChange('portalAccessEnabled', e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium text-foreground">Enable Portal Access</span>
            </label>
            <p className="text-xs text-muted-foreground mt-1 ml-6">
              Allow this organization to access the client portal
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleInputChange('notes', e.target.value)}
              rows={3}
              placeholder="Additional information about this organization..."
              className="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
            <button
              type="button"
              onClick={handleClose}
              className="px-6 py-2 border border-border text-foreground rounded-lg hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              {loading ? 'Creating...' : 'Create Organization'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
