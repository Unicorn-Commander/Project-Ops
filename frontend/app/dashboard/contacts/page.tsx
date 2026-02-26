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
import {
  getContacts,
  deleteContact,
  type Contact,
} from "@/lib/contacts-api";
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

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterActive, setFilterActive] = useState<boolean | undefined>(true);
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

  const filteredContacts = contacts;

  return (
    <div className="min-h-screen bg-[#F5F9FC]">
      {/* Header */}
      <div className="bg-white border-b border-[#D4DADE]">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#005AF5] rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#10172B]">Contacts</h1>
                <p className="text-sm text-[#A5A6AA] mt-1">
                  Manage your contacts and information
                </p>
              </div>
            </div>
            <Button
              onClick={() => setCreateModalOpen(true)}
              className="bg-[#005AF5] hover:bg-[#004CCE] text-white px-6 py-3"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Contact
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-6 py-8">
        {/* Search and Filters */}
        <Card className="mb-6 p-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#A5A6AA] w-5 h-5" />
              <Input
                placeholder="Search by name, email, or company..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 py-6 border-[#D4DADE] focus:border-[#005AF5] focus:ring-[#005AF5]"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant={filterActive === true ? "default" : "outline"}
                onClick={() => setFilterActive(true)}
                className={
                  filterActive === true
                    ? "bg-[#005AF5] hover:bg-[#004CCE]"
                    : ""
                }
              >
                Active
              </Button>
              <Button
                variant={filterActive === false ? "default" : "outline"}
                onClick={() => setFilterActive(false)}
                className={
                  filterActive === false
                    ? "bg-[#005AF5] hover:bg-[#004CCE]"
                    : ""
                }
              >
                Inactive
              </Button>
              <Button
                variant={filterActive === undefined ? "default" : "outline"}
                onClick={() => setFilterActive(undefined)}
                className={
                  filterActive === undefined
                    ? "bg-[#005AF5] hover:bg-[#004CCE]"
                    : ""
                }
              >
                All
              </Button>
            </div>
          </div>
        </Card>

        {/* Contacts Table */}
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#F5F9FC] border-b border-[#D4DADE]">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-[#10172B] uppercase tracking-wider">
                    Contact
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-[#10172B] uppercase tracking-wider">
                    Contact Info
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-[#10172B] uppercase tracking-wider">
                    Company
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-[#10172B] uppercase tracking-wider">
                    Projects
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-[#10172B] uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-[#10172B] uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-[#D4DADE]">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#005AF5]"></div>
                      </div>
                    </td>
                  </tr>
                ) : filteredContacts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <Users className="w-12 h-12 text-[#A5A6AA] mx-auto mb-3" />
                      <p className="text-[#A5A6AA]">No contacts found</p>
                    </td>
                  </tr>
                ) : (
                  filteredContacts.map((contact) => (
                    <tr
                      key={contact.id}
                      className="hover:bg-[#F5F9FC] transition-colors cursor-pointer"
                      onClick={() => handleViewContact(contact.id)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <div className="w-10 h-10 bg-[#005AF5] bg-opacity-10 rounded-full flex items-center justify-center mr-3">
                            <span className="text-[#005AF5] font-semibold">
                              {contact.firstName[0]}
                              {contact.lastName[0]}
                            </span>
                          </div>
                          <div>
                            <div className="font-semibold text-[#10172B]">
                              {contact.firstName} {contact.lastName}
                            </div>
                            <div className="text-sm text-[#A5A6AA]">
                              {contact.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          {contact.email && (
                            <div className="flex items-center text-sm text-[#10172B]">
                              <Mail className="w-4 h-4 mr-2 text-[#A5A6AA]" />
                              {contact.email}
                            </div>
                          )}
                          {contact.phone && (
                            <div className="flex items-center text-sm text-[#10172B]">
                              <Phone className="w-4 h-4 mr-2 text-[#A5A6AA]" />
                              {contact.phone}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {contact.organization ? (
                          <div className="flex items-center text-sm text-[#10172B]">
                            <Building2 className="w-4 h-4 mr-2 text-[#A5A6AA]" />
                            {contact.organization.name}
                            <span className="ml-2 text-xs text-[#A5A6AA]">
                              ({contact.organization.type})
                            </span>
                          </div>
                        ) : contact.company ? (
                          <div className="flex items-center text-sm text-[#10172B]">
                            <Building2 className="w-4 h-4 mr-2 text-[#A5A6AA]" />
                            {contact.company}
                          </div>
                        ) : (
                          <span className="text-sm text-[#A5A6AA]">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <FileText className="w-4 h-4 mr-2 text-[#A5A6AA]" />
                          <span className="text-sm font-medium text-[#10172B]">
                            {contact._count?.projects || 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {contact.isActive ? (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewContact(contact.id)}
                            className="text-[#005AF5] hover:text-[#004CCE] hover:bg-[#005AF5] hover:bg-opacity-10"
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
                            className="text-[#005AF5] hover:text-[#004CCE] hover:bg-[#005AF5] hover:bg-opacity-10"
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
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!loading && total > take && (
            <div className="px-6 py-4 border-t border-[#D4DADE] flex items-center justify-between">
              <div className="text-sm text-[#A5A6AA]">
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
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
