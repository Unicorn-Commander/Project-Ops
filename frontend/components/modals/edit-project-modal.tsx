"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Textarea } from "@/components/ui/textarea";
import api from "@/lib/api";
import { getContacts, type Contact } from "@/lib/contacts-api";
import { Search, Plus, X } from "lucide-react";
import { CustomFieldInputs } from "@/components/custom-fields/custom-field-inputs";
import { RecurrencePicker } from "@/components/custom-fields/recurrence-picker";
import { FieldHint, HelpHint } from "@/components/guidance";
import {
  CustomFieldEntity,
  type CustomFieldValueMap,
} from "@/lib/custom-fields-api";

interface Project {
  id: string;
  projectNumber: string;
  title: string;
  description: string;
  clientId?: string | null;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  status: string;
  priority: string;
  category?: string | null;
  tags?: string[] | null;
  dueDate: string | null;
  assignedToId: string | null;
  invoiceNumber?: string | null;
  billingAmount?: number | null;
  flatFeeAmount?: number | null;
  amountPaid?: number | null;
  paymentStatus?: string | null;
  billingDate?: string | null;
  paymentDueDate?: string | null;
  paymentReceivedDate?: string | null;
  billingNotes?: string | null;
  recurrenceRule?: string | null;
  metadata?: { customFields?: Record<string, any>; [key: string]: any } | null;
}

interface EditProjectModalProps {
  projectData: Project | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PROJECT_STATUSES = [
  { value: "NEW", label: "New" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "UNDER_REVIEW", label: "Under Review" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ARCHIVED", label: "Archived" },
];

const PRIORITIES = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

const PAYMENT_STATUSES = [
  { value: "UNPAID", label: "Unpaid" },
  { value: "PARTIALLY_PAID", label: "Partially Paid" },
  { value: "PAID", label: "Paid" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "CANCELLED", label: "Cancelled" },
];

export function EditProjectModal({
  projectData,
  isOpen,
  onClose,
  onSuccess,
}: EditProjectModalProps) {
  const [formData, setFormData] = useState({
    clientId: "",
    title: "",
    description: "",
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    status: "NEW",
    priority: "MEDIUM",
    category: "",
    tags: [] as string[],
    dueDate: "",
    invoiceNumber: "",
    billingAmount: null as number | null,
    flatFeeAmount: null as number | null,
    amountPaid: null as number | null,
    paymentStatus: "UNPAID",
    billingDate: "",
    paymentDueDate: "",
    paymentReceivedDate: "",
    billingNotes: "",
  });
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<Contact[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showClientSelector, setShowClientSelector] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [customFields, setCustomFields] = useState<CustomFieldValueMap>({});
  // Hide the custom-fields heading (and hint) when no PROJECT fields exist.
  const [hasCustomFields, setHasCustomFields] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState("");
  const { toast } = useToast();

  const addTag = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setFormData((prev) => {
      if (prev.tags.some((t) => t.toLowerCase() === value.toLowerCase()))
        return prev;
      return { ...prev, tags: [...prev.tags, value].slice(0, 20) };
    });
    setTagDraft("");
  };

  const removeTag = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== value),
    }));
  };

  // Fetch clients
  useEffect(() => {
    const fetchClients = async () => {
      try {
        const response = await getContacts({ take: 100, isActive: true });
        setClients(response.data);
      } catch (error) {
        // Silent error - clients optional
      }
    };
    if (isOpen) {
      fetchClients();
    }
  }, [isOpen]);

  useEffect(() => {
    if (projectData) {
      setFormData({
        clientId: projectData.clientId || "",
        title: projectData.title,
        description: projectData.description,
        clientName: projectData.clientName,
        clientEmail: projectData.clientEmail,
        clientPhone: projectData.clientPhone,
        status: projectData.status,
        priority: projectData.priority,
        category: projectData.category || "",
        tags: Array.isArray(projectData.tags) ? projectData.tags : [],
        dueDate: projectData.dueDate
          ? new Date(projectData.dueDate).toISOString().split("T")[0]
          : "",
        invoiceNumber: projectData.invoiceNumber || "",
        billingAmount: projectData.billingAmount || null,
        flatFeeAmount: projectData.flatFeeAmount || null,
        amountPaid: projectData.amountPaid || null,
        paymentStatus: projectData.paymentStatus || "UNPAID",
        billingDate: projectData.billingDate
          ? new Date(projectData.billingDate).toISOString().split("T")[0]
          : "",
        paymentDueDate: projectData.paymentDueDate
          ? new Date(projectData.paymentDueDate).toISOString().split("T")[0]
          : "",
        paymentReceivedDate: projectData.paymentReceivedDate
          ? new Date(projectData.paymentReceivedDate)
              .toISOString()
              .split("T")[0]
          : "",
        billingNotes: projectData.billingNotes || "",
      });
      setCustomFields(projectData.metadata?.customFields ?? {});
      setRecurrenceRule(projectData.recurrenceRule ?? "");
    }
  }, [projectData]);

  // Handle client selection
  const handleClientSelect = (selectedClientId: string) => {
    const selectedClient = clients.find((c) => c.id === selectedClientId);
    if (selectedClient) {
      setFormData({
        ...formData,
        clientId: selectedClient.id,
        clientName: `${selectedClient.firstName} ${selectedClient.lastName}`,
        clientEmail: selectedClient.email || "",
        clientPhone: selectedClient.phone || "",
      });
      setShowClientSelector(false);
    }
  };

  // Filter clients
  const filteredClients = clients.filter((client) =>
    `${client.firstName} ${client.lastName} ${client.email} ${client.company || ""}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase()),
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectData) return;

    // Validation
    if (!formData.title.trim()) {
      toast({
        title: "Validation Error",
        description: "Title is required",
        variant: "destructive",
      });
      return;
    }

    if (!formData.clientEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }

    // Validate amount paid does not exceed billing amount
    if (
      formData.amountPaid &&
      formData.billingAmount &&
      formData.amountPaid > formData.billingAmount
    ) {
      toast({
        title: "Validation Error",
        description: "Amount paid cannot exceed billing amount",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ...formData,
        dueDate: formData.dueDate || null,
        // Always send so clearing the recurrence ("") is persisted.
        recurrenceRule,
        customFields,
      };

      await api.patch(`/projects/${projectData.id}`, payload);

      toast({
        title: "Success",
        description: "Project updated successfully",
      });
      onSuccess();
      onClose();
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.response?.data?.message || "Failed to update project",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <Label htmlFor="title">Project Title</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })
              }
              placeholder="e.g., 2024 Tax Return Filing"
              required
            />
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              className="w-full min-h-[100px] px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              placeholder="Case details..."
            />
          </div>

          {/* Client Selector */}
          <div>
            <Label>Client Selection</Label>
            {!formData.clientId ? (
              <div className="space-y-3 mt-2">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setShowClientSelector(!showClientSelector)}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    Select Existing Client
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowClientSelector(false)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Manual Entry
                  </Button>
                </div>

                {showClientSelector && (
                  <div className="border rounded-lg p-3 bg-muted/50">
                    <div className="mb-2">
                      <Input
                        placeholder="Search clients..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {filteredClients.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-3">
                          No clients found
                        </p>
                      ) : (
                        filteredClients.map((client) => (
                          <button
                            key={client.id}
                            type="button"
                            className="w-full text-left p-2 rounded hover:bg-background border text-sm transition-colors"
                            onClick={() => handleClientSelect(client.id)}
                          >
                            <div className="font-medium">
                              {client.firstName} {client.lastName}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {client.email}
                              {client.company && ` • ${client.company}`}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between p-2 border rounded-lg bg-primary/5 mt-2">
                <div>
                  <div className="text-sm font-medium">
                    Linked: {formData.clientName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formData.clientEmail}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFormData({
                      ...formData,
                      clientId: "",
                    });
                  }}
                >
                  Change
                </Button>
              </div>
            )}
          </div>

          {/* Client Info */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="clientName">Client Name</Label>
              <Input
                id="clientName"
                value={formData.clientName}
                onChange={(e) =>
                  setFormData({ ...formData, clientName: e.target.value })
                }
                placeholder="John Doe"
                required
              />
            </div>

            <div>
              <Label htmlFor="clientEmail">Client Email</Label>
              <Input
                id="clientEmail"
                type="email"
                value={formData.clientEmail}
                onChange={(e) =>
                  setFormData({ ...formData, clientEmail: e.target.value })
                }
                placeholder="john@example.com"
                required
              />
            </div>

            <div>
              <Label htmlFor="clientPhone">Client Phone</Label>
              <Input
                id="clientPhone"
                type="tel"
                value={formData.clientPhone}
                onChange={(e) =>
                  setFormData({ ...formData, clientPhone: e.target.value })
                }
                placeholder="+1 (555) 000-0000"
              />
            </div>
          </div>

          {/* Status, Priority */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="status">
                Status
                <FieldHint
                  learnMore={{
                    category: "projects-tasks",
                    article: "projects",
                  }}
                >
                  Where the project stands — New, In progress, Under review, On
                  hold, Completed, or Archived. It drives the dashboard counts
                  and the status charts.
                </FieldHint>
              </Label>
              <Select
                value={formData.status}
                onValueChange={(value) =>
                  setFormData({ ...formData, status: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_STATUSES.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="priority">
                Priority
                <FieldHint
                  learnMore={{
                    category: "projects-tasks",
                    article: "projects",
                  }}
                >
                  How urgent this project is — Low, Medium, High, or Urgent.
                  It's colour-coded across lists and the schedule so the
                  pressing work stands out.
                </FieldHint>
              </Label>
              <Select
                value={formData.priority}
                onValueChange={(value) =>
                  setFormData({ ...formData, priority: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((priority) => (
                    <SelectItem key={priority.value} value={priority.value}>
                      {priority.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Due Date + Category */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="dueDate">Due Date (Optional)</Label>
              <Input
                id="dueDate"
                type="date"
                value={formData.dueDate}
                onChange={(e) =>
                  setFormData({ ...formData, dueDate: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="category">Category / Product</Label>
              <Input
                id="category"
                value={formData.category}
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value })
                }
                placeholder="e.g., Web, Mobile, Onboarding"
              />
            </div>
          </div>

          {/* Tags — chip input; press Enter or comma to add. */}
          <div>
            <Label htmlFor="tags">Tags</Label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 transition-colors focus-within:border-ring">
              {formData.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="text-primary/60 hover:text-primary"
                    aria-label={`Remove ${tag}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                id="tags"
                type="text"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag(tagDraft);
                  } else if (
                    e.key === "Backspace" &&
                    !tagDraft &&
                    formData.tags.length
                  ) {
                    removeTag(formData.tags[formData.tags.length - 1]);
                  }
                }}
                onBlur={() => addTag(tagDraft)}
                placeholder={
                  formData.tags.length
                    ? "Add another…"
                    : "Add tags (press Enter)"
                }
                className="flex-1 min-w-[120px] border-0 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Billing & Invoicing Section */}
          <div className="pt-4 border-t">
            <h3 className="text-lg font-semibold mb-4">Billing & Invoicing</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Invoice Number */}
              <div>
                <Label htmlFor="invoiceNumber">Invoice Number</Label>
                <Input
                  id="invoiceNumber"
                  value={formData.invoiceNumber}
                  onChange={(e) =>
                    setFormData({ ...formData, invoiceNumber: e.target.value })
                  }
                  placeholder="INV-2025-001"
                />
              </div>

              {/* Payment Status */}
              <div>
                <Label htmlFor="paymentStatus">
                  Payment Status
                  <FieldHint
                    learnMore={{ category: "time-billing", article: "billing" }}
                  >
                    Where this project's invoice stands — Unpaid, Partially
                    paid, Paid, Overdue, or Cancelled.
                  </FieldHint>
                </Label>
                <Select
                  value={formData.paymentStatus}
                  onValueChange={(value) =>
                    setFormData({ ...formData, paymentStatus: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_STATUSES.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Billing Amount */}
              <div>
                <Label htmlFor="billingAmount">
                  Billing Amount
                  <FieldHint
                    learnMore={{ category: "time-billing", article: "billing" }}
                  >
                    The total you're invoicing the client for this project.
                    Amount Paid is tracked against it to surface what's
                    outstanding.
                  </FieldHint>
                </Label>
                <Input
                  id="billingAmount"
                  type="number"
                  step="0.01"
                  value={formData.billingAmount ?? ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      billingAmount: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                  placeholder="2500.00"
                />
              </div>

              <div>
                <Label htmlFor="flatFeeAmount">
                  Flat fee
                  <FieldHint
                    learnMore={{ category: "time-billing", article: "billing" }}
                  >
                    A fixed price for the whole project, billed once. A task
                    with its own flat fee is billed instead of this.
                  </FieldHint>
                </Label>
                <Input
                  id="flatFeeAmount"
                  type="number"
                  step="0.01"
                  value={formData.flatFeeAmount ?? ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      flatFeeAmount: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                  placeholder="2500.00"
                />
              </div>

              {/* Amount Paid */}
              <div>
                <Label htmlFor="amountPaid">Amount Paid</Label>
                <Input
                  id="amountPaid"
                  type="number"
                  step="0.01"
                  value={formData.amountPaid ?? ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      amountPaid: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                  placeholder="0.00"
                />
              </div>

              {/* Billing Date */}
              <div>
                <Label htmlFor="billingDate">Billing Date</Label>
                <Input
                  id="billingDate"
                  type="date"
                  value={formData.billingDate}
                  onChange={(e) =>
                    setFormData({ ...formData, billingDate: e.target.value })
                  }
                />
              </div>

              {/* Payment Due Date */}
              <div>
                <Label htmlFor="paymentDueDate">Payment Due Date</Label>
                <Input
                  id="paymentDueDate"
                  type="date"
                  value={formData.paymentDueDate}
                  onChange={(e) =>
                    setFormData({ ...formData, paymentDueDate: e.target.value })
                  }
                />
              </div>

              {/* Payment Received Date */}
              <div>
                <Label htmlFor="paymentReceivedDate">
                  Payment Received Date
                </Label>
                <Input
                  id="paymentReceivedDate"
                  type="date"
                  value={formData.paymentReceivedDate}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      paymentReceivedDate: e.target.value,
                    })
                  }
                />
              </div>

              {/* Billing Notes */}
              <div className="md:col-span-2">
                <Label htmlFor="billingNotes">Billing Notes</Label>
                <Textarea
                  id="billingNotes"
                  value={formData.billingNotes}
                  onChange={(e) =>
                    setFormData({ ...formData, billingNotes: e.target.value })
                  }
                  placeholder="Payment via check #1234, partial payment arrangements, etc..."
                  rows={3}
                />
              </div>
            </div>
          </div>

          {/* Recurrence */}
          <div className="pt-4 border-t">
            <h3 className="flex items-center gap-1.5 text-lg font-semibold mb-4">
              Recurrence
              <HelpHint
                learnMore={{ category: "recurring", article: "repeats" }}
              >
                Set a “Repeats” rule and Project Ops materializes the next
                instance automatically — for recurring engagements like a
                monthly retainer.
              </HelpHint>
            </h3>
            <RecurrencePicker
              value={recurrenceRule}
              onChange={setRecurrenceRule}
              idPrefix="edit-project-recurrence"
            />
          </div>

          {/* Custom fields — workspace-defined PROJECT attributes. Bare inputs +
              an owned heading so we can hang a hint on it; hidden when none. */}
          <div className={hasCustomFields ? "" : "hidden"}>
            {hasCustomFields && (
              <h3 className="flex items-center gap-1.5 text-lg font-semibold mb-4">
                Custom Fields
                <HelpHint
                  learnMore={{
                    category: "custom-fields",
                    article: "custom-fields-overview",
                  }}
                >
                  Workspace-specific attributes an admin added to projects — a
                  matter number, an engagement type, a target date. Fill in the
                  values as you go.
                </HelpHint>
              </h3>
            )}
            <CustomFieldInputs
              entity={CustomFieldEntity.PROJECT}
              values={customFields}
              onChange={setCustomFields}
              onDefinitionsLoaded={(defs) =>
                setHasCustomFields(defs.length > 0)
              }
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-primary hover:bg-primary/90"
              disabled={loading}
            >
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
