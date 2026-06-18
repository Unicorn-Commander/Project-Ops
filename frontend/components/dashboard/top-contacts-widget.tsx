'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getContactStats, type ContactStats } from '@/lib/contacts-api';
import { Building2, DollarSign, FileText, UserCircle, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function TopContactsWidget() {
  const router = useRouter();
  const [contactStats, setContactStats] = useState<ContactStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTopContacts();
  }, []);

  async function loadTopContacts() {
    setLoading(true);
    setError(null);
    try {
      const stats = await getContactStats();
      setContactStats(stats);
    } catch (error) {
      console.error('Failed to load contact stats:', error);
      setError('Failed to load top contacts');
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
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-foreground">Top Clients</h2>
        </div>
        <div className="text-center py-8">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={loadTopContacts}
          >
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (!contactStats || contactStats.topContacts.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-foreground">Top Clients</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push('/dashboard/contacts')}
          >
            View All
          </Button>
        </div>
        <div className="text-center py-8">
          <UserCircle className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-sm text-muted-foreground mb-2">No contacts found</p>
          <p className="text-xs text-muted-foreground">
            Start by adding contacts, or linking clients to your projects
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-foreground">Top Contacts</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push('/dashboard/contacts')}
        >
          View All
        </Button>
      </div>

      <div className="space-y-4">
        {contactStats.topContacts.map((contact, index) => {
          // Calculate payment status based on outstanding balance
          const isPaid = contact.outstanding === 0 && contact.totalBilled > 0;
          const isPartial = contact.outstanding > 0 && contact.totalPaid > 0;
          const isOverdue = contact.outstanding > 0 && contact.totalPaid === 0;

          return (
            <div
              key={contact.id}
              className="group relative flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 hover:shadow-md transition-all cursor-pointer"
              onClick={() => router.push(`/dashboard/contacts/${contact.id}`)}
            >
              {/* Left Section: Rank & Contact Info */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Rank Badge */}
                <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <span className="text-primary font-semibold text-sm">
                    #{index + 1}
                  </span>
                </div>

                {/* Contact Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                    {contact.firstName} {contact.lastName}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    {contact.company && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Building2 className="w-3 h-3" />
                        <span className="truncate max-w-[150px]">{contact.company}</span>
                      </div>
                    )}
                    {contact.company && contact.projectsCount > 0 && (
                      <span className="text-xs text-muted-foreground">•</span>
                    )}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <FileText className="w-3 h-3" />
                      <span>{contact.projectsCount} project{contact.projectsCount !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Section: Billing Info */}
              <div className="flex-shrink-0 text-right ml-4">
                {/* Total Billed */}
                <div className="flex items-center justify-end gap-1 text-sm font-semibold text-foreground">
                  <DollarSign className="w-4 h-4" />
                  <span>
                    {contact.totalBilled.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>

                {/* Payment Status */}
                <div className="mt-1">
                  {isPaid && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
                      <span className="w-2 h-2 bg-green-600 rounded-full"></span>
                      Paid
                    </span>
                  )}
                  {isPartial && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-600">
                      <span className="w-2 h-2 bg-yellow-600 rounded-full"></span>
                      Partial
                    </span>
                  )}
                  {isOverdue && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
                      <span className="w-2 h-2 bg-red-600 rounded-full"></span>
                      Overdue
                    </span>
                  )}
                  {!isPaid && !isPartial && !isOverdue && contact.totalBilled === 0 && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500">
                      No billing
                    </span>
                  )}
                </div>

                {/* Outstanding Amount */}
                {contact.outstanding > 0 && (
                  <div className="text-xs text-red-600 mt-1">
                    ${contact.outstanding.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} outstanding
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Stats */}
      {contactStats.totalContacts > contactStats.topContacts.length && (
        <div className="mt-6 pt-4 border-t">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Showing top {contactStats.topContacts.length} of {contactStats.totalContacts} contacts
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                router.push('/dashboard/contacts');
              }}
              className="text-primary hover:text-primary/90"
            >
              View all contacts →
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
