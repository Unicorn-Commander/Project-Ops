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
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useHydrated } from "@/lib/use-hydrated";
import { paymentStatusBadgeClass } from "@/lib/badge-styles";
import { cn } from "@/lib/utils";
import { formatDateOnly } from "@/lib/date-only";
import Link from "next/link";
import { money } from "@/components/portal";
import { getInvoice, type PortalInvoice } from "@/lib/portal-api";

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
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!invoice) return null;

  const isAbsolutePayUrl =
    !!invoice.payUrl && /^https?:\/\//i.test(invoice.payUrl);
  const balance = invoice.balanceDue ?? 0;
  const fullyPaid = balance <= 0;

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
      value: formatDateOnly(invoice.billingDate),
    });
  }
  if (hydrated && invoice.paymentDueDate) {
    fields.push({
      label: "Due",
      value: formatDateOnly(invoice.paymentDueDate),
    });
  }
  if (hydrated && invoice.paymentReceivedDate) {
    fields.push({
      label: "Paid on",
      value: formatDateOnly(invoice.paymentReceivedDate),
    });
  }

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link href="/client-portal/invoices">
        <Button variant="ghost" className="-ml-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to invoices
        </Button>
      </Link>

      {/* Invoice header */}
      <Card className="overflow-hidden bg-card">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-gradient-to-br from-primary/[0.06] to-transparent p-6">
          <div className="flex items-center gap-3.5">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Receipt className="h-6 w-6" strokeWidth={1.9} />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
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
            <Badge className={cn("text-sm", paymentStatusBadgeClass(invoice.paymentStatus))}>
              {invoice.paymentStatus.replace(/_/g, " ")}
            </Badge>
          )}
        </div>

        {/* Amount breakdown — the balance is the hero figure. */}
        <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total amount
            </p>
            <p className="mt-1.5 text-xl font-semibold text-foreground">
              {money(invoice.billingAmount)}
            </p>
          </div>
          <div className="p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Amount paid
            </p>
            <p className="mt-1.5 text-xl font-semibold text-foreground">
              {money(invoice.amountPaid)}
            </p>
          </div>
          <div className={cn("p-6", !fullyPaid && "bg-amber-500/[0.06]")}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Balance due
            </p>
            <p
              className={cn(
                "mt-1.5 text-xl font-bold",
                fullyPaid
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-foreground",
              )}
            >
              {fullyPaid ? money(0) : money(balance)}
            </p>
          </div>
        </div>

        {/* Detail fields */}
        <dl className="grid grid-cols-1 gap-4 border-t border-border p-6 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {f.label}
              </dt>
              <dd className="mt-1 text-sm font-medium text-foreground">{f.value}</dd>
            </div>
          ))}
        </dl>

        {/* Pay — deep-link only (shown only when there's an open balance). */}
        {invoice.payUrl ? (
          <div className="flex flex-col gap-3 border-t border-border bg-muted/30 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <p>
                <span className="font-semibold text-foreground">
                  {money(balance)}
                </span>{" "}
                is outstanding. You'll be taken to a secure checkout to pay — we
                never store your card details.
              </p>
            </div>
            <Button
              size="lg"
              className="bg-primary shadow-sm hover:bg-primary/90"
              onClick={handlePay}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Pay invoice
              {isAbsolutePayUrl && <ExternalLink className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        ) : (
          fullyPaid && (
            <div className="flex items-center gap-2.5 border-t border-border bg-emerald-500/[0.06] p-6 text-sm">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <p className="font-medium text-foreground">
                This invoice is fully paid — thank you!
              </p>
            </div>
          )
        )}
      </Card>
    </div>
  );
}
