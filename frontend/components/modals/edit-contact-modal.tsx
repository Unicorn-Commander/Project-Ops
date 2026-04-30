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
import { updateContact, type Contact } from "@/lib/contacts-api";
import { getOrganizations, type Organization } from "@/lib/organizations-api";
import { X, Loader2 } from "lucide-react";

const editClientSchema = z.object({
  firstName: z
    .string()
    .min(1, "First name is required")
    .max(100, "First name must not exceed 100 characters"),
  lastName: z
    .string()
    .min(1, "Last name is required")
    .max(100, "Last name must not exceed 100 characters"),
  email: z
    .string()
    .email("Invalid email address")
    .max(255, "Email must not exceed 255 characters"),
  phone: z.string().max(20, "Phone must not exceed 20 characters").optional(),
  company: z.string().max(255, "Company must not exceed 255 characters").optional(),
  address: z.string().max(500, "Address must not exceed 500 characters").optional(),
  city: z.string().max(100, "City must not exceed 100 characters").optional(),
  state: z.string().max(2, "State must be 2 characters").optional(),
  zipCode: z.string().max(10, "ZIP code must not exceed 10 characters").optional(),
  taxId: z.string().max(50, "Tax ID must not exceed 50 characters").optional(),
  notes: z.string().max(1000, "Notes must not exceed 1000 characters").optional(),
});

type EditContactFormData = z.infer<typeof editClientSchema>;

interface EditContactModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  contact: Contact;
}

export function EditContactModal({
  open,
  onClose,
  onSuccess,
  contact,
}: EditContactModalProps) {
  const [loading, setLoading] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const { toast } = useToast();

  // Fetch organizations on mount
  useEffect(() => {
    if (!open || !contact) return;
    const fetchOrganizations = async () => {
      try {
        const orgs = await getOrganizations({ isActive: true });
        setOrganizations(orgs);
      } catch (error) {
        console.error("Failed to fetch organizations:", error);
      }
    };
    if (open) {
      fetchOrganizations();
    }
  }, [open]);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<EditContactFormData>({
    resolver: zodResolver(editClientSchema),
    defaultValues: {
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone || "",
      company: contact.company || "",
      address: contact.address || "",
      city: contact.city || "",
      state: contact.state || "",
      zipCode: contact.zipCode || "",
      taxId: contact.taxId || "",
      notes: contact.notes || "",
    },
  });

  useEffect(() => {
    if (!open || !contact) return;
    if (contact) {
      reset({
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone || "",
        company: contact.company || "",
        address: contact.address || "",
        city: contact.city || "",
        state: contact.state || "",
        zipCode: contact.zipCode || "",
        taxId: contact.taxId || "",
        notes: contact.notes || "",
      });
      // Set organization if client has one
      setSelectedOrgId(contact.organization?.id || "");
    }
  }, [contact, reset]);

  const onSubmit = async (data: EditContactFormData) => {
    try {
      setLoading(true);
      await updateContact(contact.id, {
        ...data,
        organizationId: selectedOrgId || undefined,
      });
      toast({
        title: "Success",
        description: "Contact updated successfully",
      });
      onSuccess();
      onClose();
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.response?.data?.message || "Failed to update contact",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-card">
        {/* Header */}
        <div className="sticky top-0 bg-popover border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold text-foreground">Edit Client</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          {/* Personal Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Personal Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">
                  First Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="firstName"
                  {...register("firstName")}
                  placeholder="John"
                  className=""
                />
                {errors.firstName && (
                  <p className="text-sm text-red-600">{errors.firstName.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="lastName">
                  Last Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="lastName"
                  {...register("lastName")}
                  placeholder="Doe"
                  className=""
                />
                {errors.lastName && (
                  <p className="text-sm text-red-600">{errors.lastName.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Contact Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Contact Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">
                  Email <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  {...register("email")}
                  placeholder="john.doe@example.com"
                  className=""
                />
                {errors.email && (
                  <p className="text-sm text-red-600">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  {...register("phone")}
                  placeholder="555-123-4567"
                  className=""
                />
                {errors.phone && (
                  <p className="text-sm text-red-600">{errors.phone.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Business Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Business Information
            </h3>
            <div className="space-y-2">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                {...register("company")}
                placeholder="Acme Corporation"
                className=""
              />
              {errors.company && (
                <p className="text-sm text-red-600">{errors.company.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="organization">Organization (Optional)</Label>
              <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                <SelectTrigger className="">
                  <SelectValue placeholder="Select organization..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None (Individual)</SelectItem>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name} ({org.type.replace(/_/g, " ")})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Link this contact to an organization for better management
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="taxId">Tax ID (SSN/EIN)</Label>
              <Input
                id="taxId"
                {...register("taxId")}
                placeholder="12-3456789"
                className=""
              />
              {errors.taxId && (
                <p className="text-sm text-red-600">{errors.taxId.message}</p>
              )}
            </div>
          </div>

          {/* Address */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Address</h3>
            <div className="space-y-2">
              <Label htmlFor="address">Street Address</Label>
              <Input
                id="address"
                {...register("address")}
                placeholder="123 Main St, Suite 100"
                className=""
              />
              {errors.address && (
                <p className="text-sm text-red-600">{errors.address.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  {...register("city")}
                  placeholder="New York"
                  className=""
                />
                {errors.city && (
                  <p className="text-sm text-red-600">{errors.city.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  {...register("state")}
                  placeholder="NY"
                  maxLength={2}
                  className=""
                />
                {errors.state && (
                  <p className="text-sm text-red-600">{errors.state.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="zipCode">ZIP Code</Label>
                <Input
                  id="zipCode"
                  {...register("zipCode")}
                  placeholder="10001"
                  className=""
                />
                {errors.zipCode && (
                  <p className="text-sm text-red-600">{errors.zipCode.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Notes</h3>
            <div className="space-y-2">
              <Label htmlFor="notes">Contact Notes</Label>
              <Textarea
                id="notes"
                {...register("notes")}
                placeholder="Any additional information about the contact..."
                rows={4}
                className=""
              />
              {errors.notes && (
                <p className="text-sm text-red-600">{errors.notes.message}</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-primary hover:bg-primary/90 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update Contact"
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
