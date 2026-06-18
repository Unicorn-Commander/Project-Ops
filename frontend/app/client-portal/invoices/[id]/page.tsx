"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  ArrowLeft,
  Receipt,
  CreditCard,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useHydrated } from "@/lib/use-hydrated";
import { paymentStatusBadgeClass } from "@/lib/badge-styles";
import { format } from "date-fns";
import Link from "next/link";
import { getInvoice, type PortalInvoice } from "@/lib/portal-api";

function money(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const hydrated = useHydrated();
  const [loading, setLoading] = useState(true);
  const [invoice, setInvoice] = useState<PortalInvoice | null>(null);

  const invoiceId = params?.id as string;

  useEffect(() => {
    if (invoiceId) loadInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  const loadInvoice = async () => {
    try {
      setLoading(true);
      const data = await getInvoice(invoiceId);
      setInvoice(data);
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.response?.data?.message || "Failed to load invoice",
        variant: "destructive",
      });
      router.push("/client-portal/invoices");
    } finally {
      setLoading(false);
    }
  };

  // Deep-link ONLY — opens the checkout (relative app route or absolute URL).
  // No in-app payment is ever executed here.
  const handlePay = () => {
    if (!invoice?.payUrl) return;
    const isAbsolute = /^https?:\/\//i.test(invoice.payUrl);
    if (isAbsolute) {
      window.open(invoice.payUrl, "_blank", "noopener,noreferrer");
    } else {
      router.push(invoice.payUrl);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!invoice) return null;

  const isAbsolutePayUrl =
    !!invoice.payUrl && /^https?:\/\//i.test(invoice.payUrl);

  const fields: Array<{ label: string; value: string }> = [
    { label: "Invoice number", value: invoice.invoiceNumber || "Draft invoice" },
    {
      label: "Project",
      value: `${invoice.projectTitle} (#${invoice.projectNumber})`,
    },
  ];
  if (hydrated && invoice.billingDate) {
    fields.push({
      label: "Issued",
      value: format(new Date(invoice.billingDate), "MMM d, yyyy"),
    });
  }
  if (hydrated && invoice.paymentDueDate) {
    fields.push({
      label: "Due",
      value: format(new Date(invoice.paymentDueDate), "MMM d, yyyy"),
    });
  }
  if (hydrated && invoice.paymentReceivedDate) {
    fields.push({
      label: "Paid on",
      value: format(new Date(invoice.paymentReceivedDate), "MMM d, yyyy"),
    });
  }

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link href="/client-portal/invoices">
        <Button variant="ghost" className="text-primary hover:text-primary/90">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Invoices
        </Button>
      </Link>

      {/* Invoice header */}
      <Card className="p-6 bg-card border-border">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Receipt className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {invoice.invoiceNumber || "Draft invoice"}
              </h1>
              <Link
                href={`/client-portal/projects/${invoice.projectId}`}
                className="text-sm text-muted-foreground hover:text-primary hover:underline"
              >
                {invoice.projectTitle}{" "}
                <span className="font-mono text-xs">#{invoice.projectNumber}</span>
              </Link>
            </div>
          </div>
          {invoice.paymentStatus && (
            <Badge className={paymentStatusBadgeClass(invoice.paymentStatus)}>
              {invoice.paymentStatus.replace(/_/g, " ")}
            </Badge>
          )}
        </div>

        {/* Amount breakdown */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4 border-y border-border">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Total amount</p>
            <p className="text-lg font-semibold text-foreground">
              {money(invoice.billingAmount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Amount paid</p>
            <p className="text-lg font-semibold text-foreground">
              {money(invoice.amountPaid)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Balance due</p>
            <p className="text-lg font-semibold text-foreground">
              {money(invoice.balanceDue)}
            </p>
          </div>
        </div>

        {/* Detail fields */}
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
          {fields.map((f) => (
            <div key={f.label}>
              <dt className="text-xs text-muted-foreground mb-1">{f.label}</dt>
              <dd className="text-sm font-medium text-foreground">{f.value}</dd>
            </div>
          ))}
        </dl>

        {/* Pay — deep-link only (shown only when there's an open balance) */}
        {invoice.payUrl && (
          <div className="mt-6 pt-6 border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {money(invoice.balanceDue)} is outstanding on this invoice.
            </p>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={handlePay}
            >
              <CreditCard className="w-4 h-4 mr-2" />
              Pay invoice
              {isAbsolutePayUrl && <ExternalLink className="w-4 h-4 ml-2" />}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
