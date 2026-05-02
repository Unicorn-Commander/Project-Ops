"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CreateContactModal } from "@/components/modals/create-contact-modal";
import { EditContactModal } from "@/components/modals/edit-contact-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar } from "@/components/ui/avatar";
import {
  getContacts,
  deleteContact,
  type Contact,
} from "@/lib/contacts-api";
import { activeBadgeClass, iconWellClass } from "@/lib/badge-styles";
import { projectColorClasses } from "@/lib/project-colors";
import { ListToolbar, FilterOption } from "@/components/ui/list-toolbar";
import { compareValues } from "@/lib/list-controls";
import { BulkActionBar, BulkActionButton, useBulkRunner } from "@/components/ui/bulk-action-bar";
import { CheckSquare as CheckSquareIcon, ToggleLeft, ToggleRight } from "lucide-react";
import api from "@/lib/api";
import {
  Search,
  Plus,
  Eye,
  Edit,
  Trash2,
  Users,
  Building2,
  Mail,
  Phone,
  FileText,
  DollarSign,
} from "lucide-react";

const ACTIVE_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "Active + inactive" },
  { value: "ACTIVE", label: "Active only", dot: "bg-emerald-500" },
  { value: "INACTIVE", label: "Inactive only", dot: "bg-zinc-500" },
];

const SORT_OPTIONS = [
  { value: "lastName-asc", label: "Last name A–Z" },
  { value: "lastName-desc", label: "Last name Z–A" },
  { value: "firstName-asc", label: "First name A–Z" },
  { value: "createdAt-desc", label: "Newest first" },
  { value: "createdAt-asc", label: "Oldest first" },
  { value: "updatedAt-desc", label: "Recently updated" },
];

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterActive, setFilterActive] = useState<boolean | undefined>(true);
  const [filterActiveLabel, setFilterActiveLabel] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ACTIVE");
  const [filterOrganization, setFilterOrganization] = useState("ALL");
  const [sortBy, setSortBy] = useState("lastName-asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [take] = useState(50);
  const { toast } = useToast();

  useEffect(() => {
    fetchContacts();
  }, [searchTerm, filterActive, skip]);

  // Deep-link from Cmd+K palette: ?new=1 opens the Create Contact modal.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      setCreateModalOpen(true);
      router.replace("/dashboard/contacts");
    }
  }, [router]);

  const fetchContacts = async () => {
    try {
      setLoading(true);
      const response = await getContacts({
        skip,
        take,
        search: searchTerm || undefined,
        isActive: filterActive,
      });
      setContacts(response.data);
      setTotal(response.total);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to fetch contacts",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (contact: Contact) => {
    setContactToDelete(contact);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!contactToDelete) return;

    try {
      setDeleting(true);
      await deleteContact(contactToDelete.id);
      toast({
        title: "Success",
        description: "Contact deleted successfully",
      });
      fetchContacts();
      setDeleteDialogOpen(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.response?.data?.message || "Failed to delete contact",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleEditClick = (contact: Contact) => {
    setSelectedContact(contact);
    setEditModalOpen(true);
  };

  const handleViewContact = (contactId: string) => {
    router.push(`/dashboard/contacts/${contactId}`);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkDelete = useBulkRunner({
    op: (id: string) => api.delete(`/contacts/${id}`),
    label: "Deleted",
    successMessage: (ok, total) => `Deleted ${ok} of ${total} contacts`,
    onAfter: async () => {
      setSelectedIds(new Set());
      await fetchContacts();
    },
  });

  const bulkActivate = useBulkRunner({
    op: (id: string) => api.patch(`/contacts/${id}`, { isActive: true }),
    label: "Activated",
    successMessage: (ok, total) => `Activated ${ok} of ${total} contacts`,
    onAfter: async () => {
      setSelectedIds(new Set());
      await fetchContacts();
    },
  });
  const bulkDeactivate = useBulkRunner({
    op: (id: string) => api.patch(`/contacts/${id}`, { isActive: false }),
    label: "Deactivated",
    successMessage: (ok, total) => `Deactivated ${ok} of ${total} contacts`,
    onAfter: async () => {
      setSelectedIds(new Set());
      await fetchContacts();
    },
  });

  const filteredContacts = contacts
    .filter((c) => {
      if (filterOrganization === "ALL") return true;
      if (filterOrganization === "NONE") return !c.organization?.id;
      return c.organization?.id === filterOrganization;
    })
    .sort((a, b) => {
      const [field, dir] = sortBy.split("-") as [string, "asc" | "desc"];
      const av = (a as any)[field];
      const bv = (b as any)[field];
      return compareValues(av, bv, dir);
    });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Contacts</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Manage your contacts and information
                </p>
              </div>
            </div>
            <Button
              onClick={() => setCreateModalOpen(true)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Contact
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-6 py-8">
        {/* Summary stats — derived client-side from the loaded contacts. The
            backend `/contacts/stats` endpoint is project-billing-focused
            (used by TopContactsWidget); this is the at-a-glance snapshot. */}
        {!loading && contacts.length > 0 && (() => {
          const total = contacts.length;
          const active = contacts.filter((c) => c.isActive).length;
          const withOrg = contacts.filter((c) => c.organization?.id).length;
          const withPortal = contacts.filter((c) => (c as any).portalAccessEnabled).length;
          return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {[
                { label: "Total", value: total,        stripe: "border-l-foreground/40", wash: "bg-foreground/[0.03] dark:bg-foreground/[0.04]" },
                { label: "Active", value: active,      stripe: "border-l-emerald-500 dark:border-l-emerald-400", wash: "bg-emerald-500/10 dark:bg-emerald-400/10" },
                { label: "With organization", value: withOrg, stripe: "border-l-violet-500 dark:border-l-violet-400", wash: "bg-violet-500/10 dark:bg-violet-400/10" },
                { label: "Portal access", value: withPortal,  stripe: "border-l-amber-500 dark:border-l-amber-400",  wash: "bg-amber-500/10 dark:bg-amber-400/10" },
              ].map(({ label, value, stripe, wash }) => (
                <Card key={label} className={`p-4 border-l-4 ${stripe} ${wash}`}>
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {label}
                  </p>
                  <p className="text-2xl font-semibold tracking-tight text-foreground tabular-nums mt-1">
                    {value}
                  </p>
                </Card>
              ))}
            </div>
          );
        })()}

        {/* Toolbar — search + Active + Organization filters + sort. */}
        {(() => {
          const orgOptions: FilterOption[] = (() => {
            const seen = new Map<string, string>();
            contacts.forEach((c) => {
              if (c.organization) {
                seen.set(c.organization.id, c.organization.name);
              }
            });
            return [
              { value: "ALL", label: "All organizations" },
              { value: "NONE", label: "No organization" },
              ...Array.from(seen.entries()).map(([value, label]) => ({ value, label })),
            ];
          })();
          return (
            <ListToolbar
              search={{
                value: searchTerm,
                onChange: setSearchTerm,
                placeholder: "Search by name, email, or company…",
              }}
              filters={[
                {
                  key: "active",
                  label: "State",
                  value: filterActiveLabel,
                  onChange: (v) => {
                    const label = v as "ALL" | "ACTIVE" | "INACTIVE";
                    setFilterActiveLabel(label);
                    setFilterActive(label === "ALL" ? undefined : label === "ACTIVE");
                  },
                  options: ACTIVE_OPTIONS,
                },
                {
                  key: "organization",
                  label: "Organization",
                  value: filterOrganization,
                  onChange: setFilterOrganization,
                  options: orgOptions,
                  hidden: orgOptions.length <= 2,
                },
              ]}
              sort={{
                value: sortBy,
                onChange: setSortBy,
                options: SORT_OPTIONS,
              }}
            />
          );
        })()}

        {/* Contacts Table */}
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="pl-4 pr-2 py-4 w-10">
                    <button
                      type="button"
                      onClick={() => {
                        const allSelected =
                          filteredContacts.length > 0 &&
                          filteredContacts.every((c) => selectedIds.has(c.id));
                        setSelectedIds((prev) => {
                          if (allSelected) return new Set();
                          const next = new Set(prev);
                          filteredContacts.forEach((c) => next.add(c.id));
                          return next;
                        });
                      }}
                      className="h-5 w-5 rounded border border-border hover:border-primary inline-flex items-center justify-center transition-colors"
                      aria-label="Select all visible"
                    >
                      {filteredContacts.length > 0 &&
                        filteredContacts.every((c) => selectedIds.has(c.id)) && (
                          <CheckSquareIcon className="h-4 w-4 text-primary" strokeWidth={2.5} />
                        )}
                    </button>
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Contact
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Contact Info
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Company
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Projects
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-foreground uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center">
                      <div className="flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                      </div>
                    </td>
                  </tr>
                ) : filteredContacts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <EmptyState
                        icon={Users}
                        iconTone="violet"
                        title={searchTerm ? "No contacts match" : "No contacts yet"}
                        body={
                          searchTerm
                            ? "Try a different search term, or clear the filter."
                            : "Add your first contact to start associating people with organizations and projects."
                        }
                        className="m-4 border-0"
                      />
                    </td>
                  </tr>
                ) : (
                  filteredContacts.map((contact) => {
                    // If contact belongs to an org, paint the row with that
                    // org's colour so the contact-org link is visually obvious.
                    // No org → neutral row.
                    const oc = contact.organization?.id
                      ? projectColorClasses(contact.organization?.id)
                      : null;
                    const isSelected = selectedIds.has(contact.id);
                    return (
                    <tr
                      key={contact.id}
                      className={`hover:bg-muted/30 transition-colors cursor-pointer group ${isSelected ? "bg-primary/5" : ""}`}
                      onClick={() => handleViewContact(contact.id)}
                    >
                      <td className="pl-4 pr-2 py-4 w-10">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelected(contact.id);
                          }}
                          className="h-5 w-5 rounded border border-border hover:border-primary inline-flex items-center justify-center transition-colors"
                          aria-label={isSelected ? "Deselect contact" : "Select contact"}
                        >
                          {isSelected && (
                            <CheckSquareIcon className="h-4 w-4 text-primary" strokeWidth={2.5} />
                          )}
                        </button>
                      </td>
                      <td className={`px-6 py-4 ${oc ? `border-l-4 ${oc.borderLeft} ${oc.cardWash}` : ""}`}>
                        <div className="flex items-center gap-3">
                          <Avatar
                            name={`${contact.firstName} ${contact.lastName}`}
                            size={36}
                          />
                          <div>
                            <div className="font-semibold text-foreground">
                              {contact.firstName} {contact.lastName}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {contact.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          {contact.email && (
                            <a
                              href={`mailto:${contact.email}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center text-sm text-foreground hover:text-primary hover:underline"
                              title={`Email ${contact.email}`}
                            >
                              <Mail className="w-4 h-4 mr-2 text-muted-foreground" />
                              {contact.email}
                            </a>
                          )}
                          {contact.phone && (
                            <a
                              href={`tel:${contact.phone}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center text-sm text-foreground hover:text-primary hover:underline"
                              title={`Call ${contact.phone}`}
                            >
                              <Phone className="w-4 h-4 mr-2 text-muted-foreground" />
                              {contact.phone}
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {contact.organization && oc ? (
                          <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${oc.badgeBg} ${oc.badgeText}`}>
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${oc.dot}`} />
                            {contact.organization.name}
                            <span className="opacity-70 ml-1">·</span>
                            <span className="opacity-70">{contact.organization.type}</span>
                          </span>
                        ) : contact.company ? (
                          <div className="flex items-center text-sm text-foreground">
                            <Building2 className="w-4 h-4 mr-2 text-muted-foreground" />
                            {contact.company}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <FileText className="w-4 h-4 mr-2 text-muted-foreground" />
                          <span className="text-sm font-medium text-foreground">
                            {contact._count?.projects || 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${activeBadgeClass(contact.isActive)}`}>
                          {contact.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewContact(contact.id)}
                            className="text-primary hover:text-primary/90 hover:bg-primary/10"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditClick(contact);
                            }}
                            className="text-primary hover:text-primary/90 hover:bg-primary/10"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteClick(contact);
                            }}
                            className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!loading && total > take && (
            <div className="px-6 py-4 border-t border-border flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing {skip + 1} to {Math.min(skip + take, total)} of {total}{" "}
                contacts
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSkip(Math.max(0, skip - take))}
                  disabled={skip === 0}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSkip(skip + take)}
                  disabled={skip + take >= total}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Modals */}
      <CreateContactModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={fetchContacts}
      />

      {selectedContact && (
        <EditContactModal
          open={editModalOpen}
          onClose={() => {
            setEditModalOpen(false);
            setSelectedContact(null);
          }}
          onSuccess={fetchContacts}
          contact={selectedContact}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold">
                {contactToDelete?.firstName} {contactToDelete?.lastName}
              </span>
              ? This action will soft delete the contact (mark as inactive).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk-action bar (v1.6.41) */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        entityLabel="contact"
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
                `Delete ${selectedIds.size} contact${selectedIds.size === 1 ? "" : "s"}? This cannot be undone.`,
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
