"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Check, Copy, ShieldAlert } from "lucide-react";
import type { CreatedWebhookEndpoint } from "@/lib/webhooks-api";

/**
 * Show-once signing-secret reveal — shown after a create or a secret rotation.
 *
 * Mirrors the PAT card's reveal contract: the plaintext `whsec_…` secret is
 * displayed EXACTLY once (the backend never returns it again), with a copy box,
 * a hard "save this now" warning, and an explicit acknowledge step (the dialog
 * deliberately can't be dismissed by overlay/escape/X until the user confirms
 * they've saved it). It also documents the HMAC verification scheme so an
 * integrator can wire signature checking immediately.
 */
export function WebhookSecretDialog({
  endpoint,
  rotated = false,
  onAcknowledge,
}: {
  /** The create/rotate response carrying the one-time `secret`. */
  endpoint: CreatedWebhookEndpoint;
  /** True when this came from a rotate (vs an initial create) — tunes the copy. */
  rotated?: boolean;
  onAcknowledge: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ title: `${label} copied to clipboard` });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Couldn't copy automatically",
        description: "Select the text manually and copy it.",
        variant: "destructive",
      });
    }
  }

  // Example verification snippet — uses the real header name + scheme so an
  // integrator can paste it and adapt. Kept framework-agnostic (Node crypto).
  const verifySnippet = `// Verify X-ProjectOps-Signature on each delivery (Node.js)
import { createHmac, timingSafeEqual } from "crypto";

function isValid(rawBody, signatureHeader, secret) {
  // signatureHeader looks like: "sha256=<hex>"
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader || "");
  return a.length === b.length && timingSafeEqual(a, b);
}`;

  return (
    // Controlled open + no overlay/escape/X dismissal: the user MUST acknowledge.
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        className="max-w-lg"
        hideCloseButton
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="h-5 w-5 text-emerald-500" />
            {rotated ? "Signing secret rotated" : "Webhook created"}
          </DialogTitle>
          <DialogDescription>
            {rotated
              ? "The old secret is now invalid. Update your receiver with the new secret below."
              : "Copy your signing secret now."}{" "}
            <strong className="text-foreground">It will never be shown again.</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Endpoint URL, for confirmation */}
          <div className="text-xs text-muted-foreground break-all">
            Endpoint: <span className="font-mono text-foreground">{endpoint.url}</span>
          </div>

          {/* The secret */}
          <div className="space-y-2">
            <div className="rounded-md border bg-muted/40 p-3 font-mono text-sm break-all select-all">
              {endpoint.secret}
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => copy(endpoint.secret, "Signing secret")}
            >
              {copied ? (
                <>
                  <Check className="mr-2 h-4 w-4 text-emerald-500" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy signing secret
                </>
              )}
            </Button>
          </div>

          {/* Save-now warning */}
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-amber-700 dark:text-amber-300">
                Save this secret somewhere safe now.
              </p>
              <p className="text-muted-foreground">
                It is your HMAC signing key. We store only a hashed hint and
                can&apos;t show it again. If you lose it, rotate the secret to get
                a new one.
              </p>
            </div>
          </div>

          {/* Verification scheme explainer */}
          <div className="rounded-md border p-3 space-y-2">
            <p className="text-xs font-medium text-foreground">
              How to verify deliveries
            </p>
            <p className="text-xs text-muted-foreground">
              Every delivery is POSTed with an{" "}
              <span className="font-mono">X-ProjectOps-Signature</span> header of
              the form{" "}
              <span className="font-mono">sha256=&lt;hex&gt;</span>, where the hex
              is the HMAC-SHA256 of the <strong>raw request body</strong> keyed by
              this secret. Recompute it over the exact bytes you receive and
              compare in constant time. The{" "}
              <span className="font-mono">X-ProjectOps-Event</span> and{" "}
              <span className="font-mono">X-ProjectOps-Delivery</span> headers
              carry the event name and a delivery id (useful for routing and
              deduping retries).
            </p>
            <div className="relative">
              <pre className="rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed overflow-x-auto font-mono">
                {verifySnippet}
              </pre>
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1.5 top-1.5 h-7 px-2"
                onClick={() => copy(verifySnippet, "Verification snippet")}
                aria-label="Copy verification snippet"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm pt-1">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I&apos;ve saved the signing secret somewhere safe.
          </label>
        </div>

        <DialogFooter>
          <Button onClick={onAcknowledge} disabled={!acknowledged}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
