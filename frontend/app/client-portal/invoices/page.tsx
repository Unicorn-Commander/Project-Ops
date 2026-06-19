"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Receipt, FileText, Wallet, ArrowRight } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useHydrated } from "@/lib/use-hydrated";
import { paymentStatusBadgeClass } from "@/lib/badge-styles";
import { format } from "date-fns";
import Link from "next/link";
import { HelpHint } from "@/components/guidance";
import { PortalPageHeader, StatCard, PortalEmpty, money } from "@/components/portal";
import { getInvoices, type PortalInvoice } from "@/lib/portal-api";

export default function ClientInvoicesPage() {
  const { toast } = useToast();
  const hydrated = useHydrated();
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);

  useEffect(() => {
    loadInvoices();
  }, []);

  const loadInvoices = async () => {
    try {
      setLoading(true);
      const data = await getInvoices();
      setInvoices(data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to load invoices",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const totalOutstanding = invoices.reduce(
    (sum, inv) => sum + (inv.balanceDue ?? 0),
    0
  );
  const owesNothing = totalOutstanding <= 0;

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PortalPageHeader
        icon={Receipt}
        title="Invoices"
        subtitle="Every invoice and balance in one trustworthy place. Open any invoice to see the detail and settle securely."
      />

      {/* Summary */}
      {invoices.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <StatCard
            icon={FileText}
            tone="primary"
            label="Total invoices"
            value={invoices.length}
            hint={invoices.length === 1 ? "On your account" : "On your account"}
          />
          <StatCard
            icon={Wallet}
            tone={owesNothing ? "emerald" : "amber"}
            label="Outstanding balance"
            value={money(totalOutstanding)}
            hint={
              owesNothing
                ? "You're all paid up — thank you!"
                : "Across your open invoices"
            }
          />
        </div>
      )}

      {/* Invoice list */}
      {invoices.length === 0 ? (
        <PortalEmpty
          icon={Receipt}
          title="No invoices yet"
          body="When we issue an invoice, it'll appear here with a clear breakdown and a secure way to pay. Nothing to do for now."
        />
      ) : (
        <Card className="overflow-hidden bg-card">
          {/* Column header — hidden on small screens, where each row stacks. */}
          <div className="hidden grid-cols-12 gap-4 border-b border-border bg-muted/40 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
            <div className="col-span-4">Invoice</div>
            <div className="col-span-2 text-right">Amount</div>
            <div className="col-span-2 text-right">Paid</div>
            <div className="col-span-2 flex items-center justify-end gap-1 text-right">
              Balance
              <HelpHint side="top">
                What's still owed on this invoice after any payments.
              </HelpHint>
            </div>
            <div className="col-span-2 text-right">Status</div>
          </div>

          <div className="divide-y divide-border">
            {invoices.map((inv) => {
              const open = (inv.balanceDue ?? 0) > 0;
              return (
                <Link
                  key={inv.id}
                  href={`/client-portal/invoices/${inv.id}`}
                  className="group block px-6 py-4 transition-colors hover:bg-muted/40"
                >
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-12 md:items-center md:gap-4">
                    {/* Invoice + project */}
                    <div className="md:col-span-4">
                      <p className="flex items-center gap-2 font-semibold text-foreground transition-colors group-hover:text-primary">
                        {inv.invoiceNumber || "Draft invoice"}
                        <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {inv.projectTitle}{" "}
                        <span className="font-mono text-xs">
                          #{inv.projectNumber}
                        </span>
                      </p>
                      {hydrated && inv.billingDate && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Issued {format(new Date(inv.billingDate), "MMM d, yyyy")}
                        </p>
                      )}
                    </div>

                    {/* Amounts */}
                    <div className="flex justify-between md:col-span-2 md:block md:text-right">
                      <span className="text-xs text-muted-foreground md:hidden">
                        Amount
                      </span>
                      <span className="text-sm text-foreground">
                        {money(inv.billingAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between md:col-span-2 md:block md:text-right">
                      <span className="text-xs text-muted-foreground md:hidden">
                        Paid
                      </span>
                      <span className="text-sm text-foreground">
                        {money(inv.amountPaid)}
                      </span>
                    </div>
                    <div className="flex justify-between md:col-span-2 md:block md:text-right">
                      <span className="text-xs text-muted-foreground md:hidden">
                        Balance
                      </span>
                      <span
                        className={
                          open
                            ? "text-sm font-semibold text-foreground"
                            : "text-sm font-medium text-emerald-600 dark:text-emerald-400"
                        }
                      >
                        {open ? money(inv.balanceDue) : money(0)}
                      </span>
                    </div>

                    {/* Status */}
                    <div className="flex justify-between md:col-span-2 md:items-center md:justify-end">
                      <span className="text-xs text-muted-foreground md:hidden">
                        Status
                      </span>
                      {inv.paymentStatus ? (
                        <Badge className={paymentStatusBadgeClass(inv.paymentStatus)}>
                          {inv.paymentStatus.replace(/_/g, " ")}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
