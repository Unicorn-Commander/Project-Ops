'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getOrganizations, type Organization } from '@/lib/organizations-api';
import { Building2, Users, Briefcase, DollarSign, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';

export function TopOrganizationsWidget() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTopOrganizations();
  }, []);

  async function loadTopOrganizations() {
    setLoading(true);
    try {
      // Get top 5 active organizations
      const orgs = await getOrganizations({ isActive: true, limit: 5 });
      setOrganizations(orgs);
    } catch (error) {
      console.error('Failed to load organizations:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <Card className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/3"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-foreground">Top Organizations</h2>
        <button
          onClick={() => router.push('/dashboard/organizations')}
          className="text-sm text-primary hover:underline flex items-center gap-1"
        >
          View All
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      {organizations.length === 0 ? (
        <div className="text-center py-8">
          <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No organizations found</p>
          <button
            onClick={() => router.push('/dashboard/organizations')}
            className="mt-3 text-sm text-primary hover:underline"
          >
            Create your first organization
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {organizations.map((org) => (
            <div
              key={org.id}
              onClick={() => router.push(`/dashboard/organizations/${org.id}`)}
              className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors group"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {org.name}
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      <span>{org._count?.contacts || 0} contacts</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Briefcase className="h-3 w-3" />
                      <span>{org._count?.projects || 0} projects</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="ml-4">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  org.type === 'AGENCY'
                    ? 'bg-primary/10 text-primary'
                    : org.type === 'BUSINESS'
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                }`}>
                  {org.type === 'AGENCY' ? 'Agency' : org.type === 'BUSINESS' ? 'Business' : 'Individual'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
