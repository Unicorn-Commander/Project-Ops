"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { EditContactModal } from "@/components/modals/edit-contact-modal";
import {
  getContact,
  getContactProjects,
  getContactBilling,
  inviteContactToPortal,
  type Contact,
  type ContactBillingSummary,
} from "@/lib/contacts-api";
import {
  ArrowLeft,
  Edit,
  Mail,
  Phone,
  Building2,
  MapPin,
  CreditCard,
  FileText,
  DollarSign,
  TrendingUp,
  Calendar,
  AlertCircle,
  Eye,
  UserPlus,
  Check,
  Copy,
  X,
} from "lucide-react";

interface ProjectWithDetails {
  id: string;
  projectNumber: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  assignedTo?: {
    firstName: string;
    lastName: string;
  };
  _count?: {
    documents: number;
    comments: number;
  };
}

export default function ContactProfilePage() {
  const router = useRouter();
  const params = useParams();
  const contactId = params?.id as string;
  const [contact, setContact] = useState<Contact | null>(null);
  const [projects, setProjects] = useState<ProjectWithDetails[]>([]);
  const [billing, setBilling] = useState<ContactBillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [invitationUrl, setInvitationUrl] = useState("");
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (contactId) {
      fetchContactData();
    }
  }, [contactId]);

  const fetchContactData = async () => {
    try {
      setLoading(true);
      const [contactData, casesData, billingData] = await Promise.all([
        getContact(contactId),
        getContactProjects(contactId),
        getContactBilling(contactId),
      ]);
      setContact(contactData);
      setProjects(casesData.data);
      setBilling(billingData);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to fetch contact data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      NEW: "bg-blue-100 text-blue-800",
      IN_PROGRESS: "bg-yellow-100 text-yellow-800",
      UNDER_REVIEW: "bg-purple-100 text-purple-800",
      COMPLETED: "bg-green-100 text-green-800",
      ARCHIVED: "bg-gray-100 text-gray-800",
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      LOW: "text-gray-600",
      MEDIUM: "text-blue-600",
      HIGH: "text-orange-600",
      URGENT: "text-red-600",
    };
    return colors[priority] || "text-gray-600";
  };

  const handleInviteToPortal = async () => {
    try {
      setInviting(true);
      const response = await inviteContactToPortal(contactId);
      setInvitationUrl(response.invitationUrl);
      setInviteModalOpen(true);
      toast({
        title: "Success",
        description: "Portal invitation generated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to generate invitation",
        variant: "destructive",
      });
    } finally {
      setInviting(false);
    }
  };

  const handleCopyInvitation = async () => {
    try {
      await navigator.clipboard.writeText(invitationUrl);
      setCopied(true);
      toast({
        title: "Copied!",
        description: "Invitation URL copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F9FC] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#005AF5]"></div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="min-h-screen bg-[#F5F9FC] flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-[#A5A6AA] mx-auto mb-4" />
          <p className="text-xl text-[#A5A6AA]">Contact not found</p>
          <Button
            onClick={() => router.push("/dashboard/contacts")}
            className="mt-4 bg-[#005AF5] hover:bg-[#004CCE]"
          >
            Back to Contacts
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F9FC]">
      {/* Header */}
      <div className="bg-white border-b border-[#D4DADE]">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => router.push("/dashboard/contacts")}
                className="text-[#A5A6AA] hover:text-[#10172B]"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="w-12 h-12 bg-[#005AF5] bg-opacity-10 rounded-full flex items-center justify-center">
                <span className="text-[#005AF5] font-semibold text-lg">
                  {contact.firstName[0]}
                  {contact.lastName[0]}
                </span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#10172B]">
                  {contact.firstName} {contact.lastName}
                </h1>
                <p className="text-sm text-[#A5A6AA] mt-1">{contact.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={handleInviteToPortal}
                disabled={inviting}
                variant="outline"
                className="border-[#005AF5] text-[#005AF5] hover:bg-[#005AF5] hover:text-white"
              >
                {inviting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[#005AF5] mr-2"></div>
                    Sending...
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Invite to Portal
                  </>
                )}
              </Button>
              <Button
                onClick={() => setEditModalOpen(true)}
                className="bg-[#005AF5] hover:bg-[#004CCE] text-white"
              >
                <Edit className="w-4 h-4 mr-2" />
                Edit Contact
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Contact Info */}
          <div className="space-y-6">
            {/* Contact Information */}
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-[#10172B] mb-4">
                Contact Information
              </h2>
              <div className="space-y-3">
                {contact.email && (
                  <div className="flex items-start">
                    <Mail className="w-5 h-5 text-[#A5A6AA] mr-3 mt-0.5" />
                    <div>
                      <p className="text-sm text-[#A5A6AA]">Email</p>
                      <p className="text-sm font-medium text-[#10172B]">
                        {contact.email}
                      </p>
                    </div>
                  </div>
                )}
                {contact.phone && (
                  <div className="flex items-start">
                    <Phone className="w-5 h-5 text-[#A5A6AA] mr-3 mt-0.5" />
                    <div>
                      <p className="text-sm text-[#A5A6AA]">Phone</p>
                      <p className="text-sm font-medium text-[#10172B]">
                        {contact.phone}
                      </p>
                    </div>
                  </div>
                )}
                {contact.company && (
                  <div className="flex items-start">
                    <Building2 className="w-5 h-5 text-[#A5A6AA] mr-3 mt-0.5" />
                    <div>
                      <p className="text-sm text-[#A5A6AA]">Company</p>
                      <p className="text-sm font-medium text-[#10172B]">
                        {contact.company}
                      </p>
                    </div>
                  </div>
                )}
                {(contact.address || contact.city || contact.state) && (
                  <div className="flex items-start">
                    <MapPin className="w-5 h-5 text-[#A5A6AA] mr-3 mt-0.5" />
                    <div>
                      <p className="text-sm text-[#A5A6AA]">Address</p>
                      <p className="text-sm font-medium text-[#10172B]">
                        {contact.address && <>{contact.address}<br /></>}
                        {contact.city && contact.state
                          ? `${contact.city}, ${contact.state} ${contact.zipCode || ""}`
                          : contact.city || contact.state || ""}
                      </p>
                    </div>
                  </div>
                )}
                {contact.taxId && (
                  <div className="flex items-start">
                    <CreditCard className="w-5 h-5 text-[#A5A6AA] mr-3 mt-0.5" />
                    <div>
                      <p className="text-sm text-[#A5A6AA]">Tax ID</p>
                      <p className="text-sm font-medium text-[#10172B]">
                        {contact.taxId}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Billing Summary */}
            {billing && (
              <Card className="p-6">
                <h2 className="text-lg font-semibold text-[#10172B] mb-4">
                  Billing Summary
                </h2>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-[#A5A6AA]">Total Billed</p>
                    <p className="text-2xl font-bold text-[#10172B]">
                      ${billing.totalBilled.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  <div className="flex items-center justify-between py-2 border-t border-[#D4DADE]">
                    <span className="text-sm text-[#A5A6AA]">Total Paid</span>
                    <span className="text-sm font-semibold text-green-600">
                      ${billing.totalPaid.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-t border-[#D4DADE]">
                    <span className="text-sm text-[#A5A6AA]">Outstanding</span>
                    <span className={`text-sm font-semibold ${billing.outstanding > 0 ? "text-red-600" : "text-green-600"}`}>
                      ${billing.outstanding.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-t border-[#D4DADE]">
                    <span className="text-sm text-[#A5A6AA]">Total Projects</span>
                    <span className="text-sm font-semibold text-[#10172B]">
                      {billing.projectsCount}
                    </span>
                  </div>
                </div>
              </Card>
            )}

            {/* Notes */}
            {contact.notes && (
              <Card className="p-6">
                <h2 className="text-lg font-semibold text-[#10172B] mb-4">
                  Notes
                </h2>
                <p className="text-sm text-[#10172B] whitespace-pre-wrap">
                  {contact.notes}
                </p>
              </Card>
            )}
          </div>

          {/* Right Column - Projects */}
          <div className="lg:col-span-2">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-[#10172B]">
                  Projects ({projects.length})
                </h2>
                <Button
                  onClick={() => router.push(`/dashboard/projects?contactId=${contactId}`)}
                  className="bg-[#005AF5] hover:bg-[#004CCE] text-white"
                  size="sm"
                >
                  View All Projects
                </Button>
              </div>

              {projects.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="w-12 h-12 text-[#A5A6AA] mx-auto mb-3" />
                  <p className="text-[#A5A6AA]">No projects found for this contact</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {projects.map((project_) => (
                    <div
                      key={project_.id}
                      className="border border-[#D4DADE] rounded-lg p-4 hover:bg-[#F5F9FC] transition-colors cursor-pointer"
                      onClick={() => router.push(`/dashboard/projects/${project_.id}`)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-sm font-mono text-[#A5A6AA]">
                              {project_.projectNumber}
                            </span>
                            <span
                              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                                project_.status
                              )}`}
                            >
                              {project_.status.replace("_", " ")}
                            </span>
                            <span
                              className={`text-xs font-medium ${getPriorityColor(
                                project_.priority
                              )}`}
                            >
                              {project_.priority}
                            </span>
                          </div>
                          <h3 className="font-semibold text-[#10172B] mb-1">
                            {project_.title}
                          </h3>
                          {project_.assignedTo && (
                            <p className="text-sm text-[#A5A6AA]">
                              Assigned to: {project_.assignedTo.firstName}{" "}
                              {project_.assignedTo.lastName}
                            </p>
                          )}
                          <div className="flex items-center gap-4 mt-2 text-xs text-[#A5A6AA]">
                            {project_._count && (
                              <>
                                <span>
                                  {project_._count.documents} documents
                                </span>
                                <span>{project_._count.comments} comments</span>
                              </>
                            )}
                            <span>
                              Created {new Date(project_.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/dashboard/projects/${project_.id}`);
                          }}
                          className="text-[#005AF5] hover:text-[#004CCE]"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>

      {/* Invitation Modal */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <Card className="w-full max-w-md bg-white">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-[#10172B]">
                  Portal Invitation Created
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setInviteModalOpen(false)}
                  className="text-[#A5A6AA] hover:text-[#10172B]"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>

              <p className="text-sm text-[#A5A6AA] mb-4">
                Share this invitation URL with your contact to grant them access to
                the portal:
              </p>

              <div className="bg-[#F5F9FC] border border-[#D4DADE] rounded-lg p-3 mb-4">
                <p className="text-sm text-[#10172B] break-all font-mono">
                  {invitationUrl}
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleCopyInvitation}
                  className={`flex-1 ${
                    copied
                      ? "bg-green-500 hover:bg-green-600"
                      : "bg-[#005AF5] hover:bg-[#004CCE]"
                  } text-white`}
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy URL
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setInviteModalOpen(false)}
                  className="flex-1"
                >
                  Close
                </Button>
              </div>

              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-xs text-yellow-800">
                  <strong>Note:</strong> This invitation link can only be used once.
                  The contact will use it to create their portal account.
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Edit Modal */}
      {contact && (
        <EditContactModal
          open={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          onSuccess={fetchContactData}
          contact={contact}
        />
      )}
    </div>
  );
}
