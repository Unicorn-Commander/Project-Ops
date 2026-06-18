"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Receipt } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useHydrated } from "@/lib/use-hydrated";
import { paymentStatusBadgeClass, iconWellClass } from "@/lib/badge-styles";
import { format } from "date-fns";
import Link from "next/link";
import { getInvoices, type PortalInvoice } from "@/lib/portal-api";

/** Format a nullable money amount as USD; "—" when absent. */
function money(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Invoices</h1>
        <p className="text-muted-foreground mt-1">
          View your invoices and outstanding balances
        </p>
      </div>

      {/* Summary */}
      {invoices.length > 0 && (
        <Card className="p-6 bg-card border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div
                className={`w-12 h-12 rounded-lg flex items-center justify-center ${iconWellClass(
                  "primary"
                )}`}
              >
                <Receipt className="w-6 h-6" />
              </div>
              <div>
                <p className="text-3xl font-bold text-foreground">
                  {invoices.length}
                </p>
                <p className="text-sm text-muted-foreground">
                  {invoices.length === 1 ? "Invoice" : "Invoices"}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Outstanding balance</p>
              <p className="text-lg font-semibold text-foreground">
                {money(totalOutstanding)}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Invoice list */}
      {invoices.length === 0 ? (
        <Card className="p-12 text-center bg-card border-border">
          <Receipt className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No invoices yet</p>
        </Card>
      ) : (
        <Card className="bg-card border-border overflow-hidden">
          {/* Column header — hidden on small screens, where each row stacks. */}
          <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-3 border-b border-border bg-muted/30 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <div className="col-span-4">Invoice</div>
            <div className="col-span-2 text-right">Amount</div>
            <div className="col-span-2 text-right">Paid</div>
            <div className="col-span-2 text-right">Balance</div>
            <div className="col-span-2 text-right">Status</div>
          </div>

          <div className="divide-y divide-border">
            {invoices.map((inv) => (
              <Link
                key={inv.id}
                href={`/client-portal/invoices/${inv.id}`}
                className="block px-6 py-4 hover:bg-muted/30 transition-colors"
              >
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 md:items-center">
                  {/* Invoice + project */}
                  <div className="md:col-span-4">
                    <p className="font-medium text-foreground">
                      {inv.invoiceNumber || "Draft invoice"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {inv.projectTitle}{" "}
                      <span className="font-mono text-xs">
                        #{inv.projectNumber}
                      </span>
                    </p>
                    {hydrated && inv.billingDate && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Issued {format(new Date(inv.billingDate), "MMM d, yyyy")}
                      </p>
                    )}
                  </div>

                  {/* Amounts */}
                  <div className="md:col-span-2 flex justify-between md:block md:text-right">
                    <span className="text-xs text-muted-foreground md:hidden">
                      Amount
                    </span>
                    <span className="text-sm text-foreground">
                      {money(inv.billingAmount)}
                    </span>
                  </div>
                  <div className="md:col-span-2 flex justify-between md:block md:text-right">
                    <span className="text-xs text-muted-foreground md:hidden">
                      Paid
                    </span>
                    <span className="text-sm text-foreground">
                      {money(inv.amountPaid)}
                    </span>
                  </div>
                  <div className="md:col-span-2 flex justify-between md:block md:text-right">
                    <span className="text-xs text-muted-foreground md:hidden">
                      Balance
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {money(inv.balanceDue)}
                    </span>
                  </div>

                  {/* Status */}
                  <div className="md:col-span-2 flex justify-between md:justify-end md:items-center">
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
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
