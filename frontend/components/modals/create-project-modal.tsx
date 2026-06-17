"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import api from "@/lib/api";
import { getContacts, type Contact } from "@/lib/contacts-api";
import { X, Loader2, Plus, Search } from "lucide-react";

// Project types with display names
const PROJECT_TYPES = [
  { value: "GENERAL_PROJECT", label: "General Project" },
  { value: "BUSINESS_PROJECT", label: "Business Project" },
  { value: "AMENDED_PROJECT", label: "Amended Project" },
  { value: "PLANNING", label: "Planning" },
  { value: "EXTERNAL_NOTICE", label: "External Notice Response" },
  { value: "AUDIT", label: "Audit Representation" },
];

// Priority levels with colors
const PRIORITY_LEVELS = [
  { value: "LOW", label: "Low", color: "text-zinc-500 dark:text-zinc-400" },
  { value: "MEDIUM", label: "Medium", color: "text-blue-600 dark:text-blue-400" },
  { value: "HIGH", label: "High", color: "text-orange-600 dark:text-orange-400" },
  { value: "URGENT", label: "Urgent", color: "text-rose-600 dark:text-rose-400" },
];

// Zod validation schema
const createProjectSchema = z.object({
  contactId: z.string().optional().or(z.literal("")),
  clientName: z
    .string()
    .min(2, "Client name must be at least 2 characters")
    .max(100, "Client name must not exceed 100 characters"),
  clientEmail: z
    .string()
    .email("Invalid email address")
    .optional()
    .or(z.literal("")),
  clientPhone: z
    .string()
    .regex(
      /^(\+1\s?)?(\([0-9]{3}\)|[0-9]{3})[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}$/,
      "Invalid phone number format (e.g., (555) 123-4567)"
    )
    .optional()
    .or(z.literal("")),
  projectType: z.string().min(1, "Project type is required"),
  priority: z.string().min(1, "Priority is required"),
  category: z
    .string()
    .max(60, "Category must not exceed 60 characters")
    .optional()
    .or(z.literal("")),
  tags: z.array(z.string()).optional(),
  dueDate: z
    .string()
    .optional()
    .refine(
      (date) => {
        if (!date) return true;
        return new Date(date) > new Date();
      },
      { message: "Due date must be in the future" }
    ),
  description: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(2000, "Description must not exceed 2000 characters"),
  // Billing & Invoicing Fields
  invoiceNumber: z.string().optional().or(z.literal("")),
  billingAmount: z
    .number()
    .positive("Amount must be positive")
    .optional()
    .nullable(),
  amountPaid: z
    .number()
    .min(0, "Amount paid cannot be negative")
    .optional()
    .nullable(),
  paymentStatus: z.string().optional().or(z.literal("")),
  billingDate: z.string().optional().or(z.literal("")),
  paymentDueDate: z.string().optional().or(z.literal("")),
  paymentReceivedDate: z.string().optional().or(z.literal("")),
  billingNotes: z
    .string()
    .max(500, "Notes must not exceed 500 characters")
    .optional()
    .or(z.literal("")),
}).refine(
  (data) => {
    // Validate that amount paid does not exceed billing amount
    if (data.amountPaid && data.billingAmount) {
      return data.amountPaid <= data.billingAmount;
    }
    return true;
  },
  {
    message: "Amount paid cannot exceed billing amount",
    path: ["amountPaid"],
  }
);

type CreateProjectFormData = z.infer<typeof createProjectSchema>;

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  preselectedClientId?: string;
}

export function CreateProjectModal({
  isOpen,
  onClose,
  onSuccess,
  preselectedClientId,
}: CreateProjectModalProps) {
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<Contact[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showClientSelector, setShowClientSelector] = useState(false);
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<CreateProjectFormData>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      contactId: "",
      clientName: "",
      clientEmail: "",
      clientPhone: "",
      projectType: "",
      priority: "MEDIUM",
      category: "",
      tags: [],
      dueDate: "",
      description: "",
      invoiceNumber: "",
      billingAmount: null,
      amountPaid: null,
      paymentStatus: "UNPAID",
      billingDate: "",
      paymentDueDate: "",
      paymentReceivedDate: "",
      billingNotes: "",
    },
  });

  const projectType = watch("projectType");
  const priority = watch("priority");
  const tags = watch("tags") ?? [];
  const [tagDraft, setTagDraft] = useState("");
  const description = watch("description");

  const addTag = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    const current = watch("tags") ?? [];
    // Dedupe case-insensitively, cap length to keep the array sane.
    if (current.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setTagDraft("");
      return;
    }
    setValue("tags", [...current, value].slice(0, 20));
    setTagDraft("");
  };

  const removeTag = (value: string) => {
    setValue(
      "tags",
      (watch("tags") ?? []).filter((t) => t !== value),
    );
  };
  const paymentStatus = watch("paymentStatus");
  const billingNotes = watch("billingNotes");
  const contactId = watch("contactId");

  // Fetch clients on mount
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

  // Auto-select client if preselectedClientId is provided
  useEffect(() => {
    if (preselectedClientId && clients.length > 0 && isOpen) {
      handleClientSelect(preselectedClientId);
    }
  }, [preselectedClientId, clients, isOpen]);

  // Populate fields when a client is selected
  const handleClientSelect = (selectedClientId: string) => {
    const selectedClient = clients.find((c) => c.id === selectedClientId);
    if (selectedClient) {
      setValue("contactId", selectedClient.id);
      setValue("clientName", `${selectedClient.firstName} ${selectedClient.lastName}`);
      setValue("clientEmail", selectedClient.email || "");
      setValue("clientPhone", selectedClient.phone || "");
      setShowClientSelector(false);
      setSearchTerm(""); // Clear search term after selection
    }
  };

  // Filter clients based on search term
  const filteredClients = clients.filter((client) =>
    `${client.firstName} ${client.lastName} ${client.email} ${client.company || ""}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase())
  );

  // Auto-focus first field when modal opens
  useEffect(() => {
    if (isOpen) {
      const firstInput = document.querySelector<HTMLInputElement>(
        '#create-project-modal input[name="clientName"]'
      );
      if (firstInput) {
        setTimeout(() => firstInput.focus(), 100);
      }
    }
  }, [isOpen]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  const onSubmit = async (data: CreateProjectFormData) => {
    setLoading(true);
    try {
      // Auto-generate title from project type and client name
      const projectTypeLabel =
        PROJECT_TYPES.find((t) => t.value === data.projectType)?.label ||
        data.projectType;
      const title = `${projectTypeLabel} - ${data.clientName}`;

      const payload = {
        title,
        contactId: data.contactId || undefined,
        clientName: data.clientName,
        clientEmail: data.clientEmail || undefined,
        clientPhone: data.clientPhone || undefined,
        projectType: data.projectType,
        priority: data.priority,
        category: data.category || undefined,
        // Tags travel as a JSON array of strings (Json column on the model).
        tags: data.tags && data.tags.length > 0 ? data.tags : undefined,
        dueDate: data.dueDate || undefined,
        description: data.description,
        // Billing fields
        invoiceNumber: data.invoiceNumber || undefined,
        billingAmount: data.billingAmount || undefined,
        amountPaid: data.amountPaid || undefined,
        paymentStatus: data.paymentStatus || undefined,
        billingDate: data.billingDate || undefined,
        paymentDueDate: data.paymentDueDate || undefined,
        paymentReceivedDate: data.paymentReceivedDate || undefined,
        billingNotes: data.billingNotes || undefined,
      };

      await api.post("/projects", payload);

      toast({
        title: "Success",
        description: "Project created successfully",
      });

      reset();
      onSuccess();
      onClose();
    } catch (error: any) {
      // Error handling - always show errors
      toast({
        title: "Error",
        description:
          error.response?.data?.message ||
          "Failed to create project. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      id="create-project-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <Card className="w-full max-w-4xl mx-4 p-6 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-foreground">
              Create New Project
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Add a new project to your management system
            </p>
          </div>
          <Button aria-label="Close"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
            type="button"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Client Selector */}
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4 border-b pb-2">
              Select Client
            </h3>
            {!contactId ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowClientSelector(!showClientSelector)}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    Select Existing Client
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowClientSelector(false)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    New Client
                  </Button>
                </div>

                {showClientSelector && (
                  <div className="border rounded-lg p-4 bg-muted/50">
                    <div className="mb-3">
                      <Input
                        placeholder="Search clients by name, email, or company..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-2">
                      {filteredClients.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No clients found
                        </p>
                      ) : (
                        filteredClients.map((client) => (
                          <button
                            key={client.id}
                            type="button"
                            className="w-full text-left p-3 rounded-md hover:bg-background border transition-colors"
                            onClick={() => handleClientSelect(client.id)}
                          >
                            <div className="font-medium text-foreground">
                              {client.firstName} {client.lastName}
                            </div>
                            <div className="text-sm text-muted-foreground">
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
              <div className="flex items-center justify-between p-3 border rounded-lg bg-primary/5">
                <div>
                  <div className="font-medium text-foreground">
                    Selected: {watch("clientName")}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {watch("clientEmail")}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setValue("contactId", "");
                    setValue("clientName", "");
                    setValue("clientEmail", "");
                    setValue("clientPhone", "");
                  }}
                >
                  Change
                </Button>
              </div>
            )}
          </div>

          {/* Client Information Section */}
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4 border-b pb-2">
              Client Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Client Name */}
              <div className="md:col-span-2">
                <Label htmlFor="clientName" className="required">
                  Client Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="clientName"
                  type="text"
                  placeholder="Enter client full name"
                  {...register("clientName")}
                  className={errors.clientName ? "border-red-500" : ""}
                />
                {errors.clientName && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.clientName.message}
                  </p>
                )}
              </div>

              {/* Client Email */}
              <div>
                <Label htmlFor="clientEmail">Client Email</Label>
                <Input
                  id="clientEmail"
                  type="email"
                  placeholder="client@example.com"
                  {...register("clientEmail")}
                  className={errors.clientEmail ? "border-red-500" : ""}
                />
                {errors.clientEmail && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.clientEmail.message}
                  </p>
                )}
              </div>

              {/* Client Phone */}
              <div>
                <Label htmlFor="clientPhone">Client Phone</Label>
                <Input
                  id="clientPhone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  {...register("clientPhone")}
                  className={errors.clientPhone ? "border-red-500" : ""}
                />
                {errors.clientPhone && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.clientPhone.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Project Details Section */}
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4 border-b pb-2">
              Project Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Project Type */}
              <div>
                <Label htmlFor="projectType">
                  Project Type <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={projectType}
                  onValueChange={(value) => setValue("projectType", value)}
                >
                  <SelectTrigger
                    id="projectType"
                    className={errors.projectType ? "border-red-500" : ""}
                  >
                    <SelectValue placeholder="Select project type" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.projectType && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.projectType.message}
                  </p>
                )}
              </div>

              {/* Priority */}
              <div>
                <Label htmlFor="priority">
                  Priority <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={priority}
                  onValueChange={(value) => setValue("priority", value)}
                >
                  <SelectTrigger
                    id="priority"
                    className={errors.priority ? "border-red-500" : ""}
                  >
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_LEVELS.map((level) => (
                      <SelectItem key={level.value} value={level.value}>
                        <span className={level.color}>{level.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.priority && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.priority.message}
                  </p>
                )}
              </div>

              {/* Due Date */}
              <div>
                <Label htmlFor="dueDate">Due Date</Label>
                <Input
                  id="dueDate"
                  type="date"
                  min={new Date().toISOString().split("T")[0]}
                  {...register("dueDate")}
                  className={errors.dueDate ? "border-red-500" : ""}
                />
                {errors.dueDate && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.dueDate.message}
                  </p>
                )}
              </div>

              {/* Category — feeds the "Product" lane on the master schedule. */}
              <div>
                <Label htmlFor="category">Category / Product</Label>
                <Input
                  id="category"
                  type="text"
                  placeholder="e.g., Web, Mobile, Onboarding"
                  {...register("category")}
                  className={errors.category ? "border-red-500" : ""}
                />
                {errors.category && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.category.message}
                  </p>
                )}
              </div>

              {/* Tags — chip input; press Enter or comma to add. */}
              <div className="md:col-span-2">
                <Label htmlFor="tags">Tags</Label>
                <div
                  className={`flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 transition-colors focus-within:border-ring ${
                    errors.tags ? "border-red-500" : ""
                  }`}
                >
                  {tags.map((tag) => (
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
                      } else if (e.key === "Backspace" && !tagDraft && tags.length) {
                        removeTag(tags[tags.length - 1]);
                      }
                    }}
                    onBlur={() => addTag(tagDraft)}
                    placeholder={tags.length ? "Add another…" : "Add tags (press Enter)"}
                    className="flex-1 min-w-[120px] border-0 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Press Enter or comma to add. Tags help filter and group work.
                </p>
              </div>

              {/* Description */}
              <div className="md:col-span-2">
                <Label htmlFor="description">
                  Project Description <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="description"
                  placeholder="Provide detailed information about the project, including any special requirements or notes..."
                  rows={5}
                  {...register("description")}
                  className={errors.description ? "border-red-500" : ""}
                />
                <div className="flex justify-between items-center mt-1">
                  <div>
                    {errors.description && (
                      <p className="text-sm text-red-500">
                        {errors.description.message}
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {description?.length || 0} / 2000 characters
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Billing & Invoicing Section */}
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4 border-b pb-2">
              Billing & Invoicing
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Invoice Number */}
              <div>
                <Label htmlFor="invoiceNumber">Invoice Number</Label>
                <Input
                  id="invoiceNumber"
                  type="text"
                  placeholder="INV-2025-001"
                  {...register("invoiceNumber")}
                  className={errors.invoiceNumber ? "border-red-500" : ""}
                />
                {errors.invoiceNumber && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.invoiceNumber.message}
                  </p>
                )}
              </div>

              {/* Payment Status */}
              <div>
                <Label htmlFor="paymentStatus">Payment Status</Label>
                <Select
                  value={paymentStatus}
                  onValueChange={(value) => setValue("paymentStatus", value)}
                >
                  <SelectTrigger id="paymentStatus">
                    <SelectValue placeholder="Select payment status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UNPAID">Unpaid</SelectItem>
                    <SelectItem value="PARTIALLY_PAID">Partially Paid</SelectItem>
                    <SelectItem value="PAID">Paid</SelectItem>
                    <SelectItem value="OVERDUE">Overdue</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                {errors.paymentStatus && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.paymentStatus.message}
                  </p>
                )}
              </div>

              {/* Billing Amount */}
              <div>
                <Label htmlFor="billingAmount">Billing Amount</Label>
                <Input
                  id="billingAmount"
                  type="number"
                  step="0.01"
                  placeholder="2500.00"
                  {...register("billingAmount", { valueAsNumber: true })}
                  className={errors.billingAmount ? "border-red-500" : ""}
                />
                {errors.billingAmount && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.billingAmount.message}
                  </p>
                )}
              </div>

              {/* Amount Paid */}
              <div>
                <Label htmlFor="amountPaid">Amount Paid</Label>
                <Input
                  id="amountPaid"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  {...register("amountPaid", { valueAsNumber: true })}
                  className={errors.amountPaid ? "border-red-500" : ""}
                />
                {errors.amountPaid && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.amountPaid.message}
                  </p>
                )}
              </div>

              {/* Billing Date */}
              <div>
                <Label htmlFor="billingDate">Billing Date</Label>
                <Input
                  id="billingDate"
                  type="date"
                  {...register("billingDate")}
                  className={errors.billingDate ? "border-red-500" : ""}
                />
                {errors.billingDate && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.billingDate.message}
                  </p>
                )}
              </div>

              {/* Payment Due Date */}
              <div>
                <Label htmlFor="paymentDueDate">Payment Due Date</Label>
                <Input
                  id="paymentDueDate"
                  type="date"
                  {...register("paymentDueDate")}
                  className={errors.paymentDueDate ? "border-red-500" : ""}
                />
                {errors.paymentDueDate && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.paymentDueDate.message}
                  </p>
                )}
              </div>

              {/* Payment Received Date */}
              <div>
                <Label htmlFor="paymentReceivedDate">Payment Received Date</Label>
                <Input
                  id="paymentReceivedDate"
                  type="date"
                  {...register("paymentReceivedDate")}
                  className={errors.paymentReceivedDate ? "border-red-500" : ""}
                />
                {errors.paymentReceivedDate && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.paymentReceivedDate.message}
                  </p>
                )}
              </div>

              {/* Billing Notes */}
              <div className="md:col-span-2">
                <Label htmlFor="billingNotes">Billing Notes</Label>
                <Textarea
                  id="billingNotes"
                  placeholder="Payment via check #1234, partial payment arrangements, etc..."
                  rows={3}
                  {...register("billingNotes")}
                  className={errors.billingNotes ? "border-red-500" : ""}
                />
                <div className="flex justify-between items-center mt-1">
                  <div>
                    {errors.billingNotes && (
                      <p className="text-sm text-red-500">
                        {errors.billingNotes.message}
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {billingNotes?.length || 0} / 500 characters
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
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
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Project"
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
