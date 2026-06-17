"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { iconWellClass } from "@/lib/badge-styles";
import api from "@/lib/api";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";

interface PatMetadata {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface CreatePatResult extends PatMetadata {
  plaintext: string;
}

const FALLBACK_SCOPES = [
  "read:projects",
  "write:projects",
  "read:tasks",
  "write:tasks",
  "read:documents",
  "write:documents",
  "read:activity",
  "read:organizations",
  "write:organizations",
  "write:billing",
];

const EXPIRY_OPTIONS = [
  { label: "30 days", days: 30 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
  { label: "180 days", days: 180 },
  { label: "1 year", days: 365 },
  { label: "Never", days: null },
];

/**
 * "API tokens" settings card.
 *
 * Three states sit on top of the same list:
 *   - list (default): empty-state CTA or table of existing PATs
 *   - create modal: name + scope picker + expiry, submits to POST
 *   - reveal modal: shows the plaintext token EXACTLY once with a
 *     copy-to-clipboard button and an explicit acknowledge step
 *
 * The reveal modal is intentionally hard to dismiss without
 * acknowledging — the user must explicitly click "I've copied it"
 * before it closes. We can't show the plaintext again.
 */
export function ApiTokensCard() {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<PatMetadata[] | null>(null);
  const [scopes, setScopes] = useState<string[]>(FALLBACK_SCOPES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [revealed, setRevealed] = useState<CreatePatResult | null>(null);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [list, scopeList] = await Promise.all([
        api.get<PatMetadata[]>("/auth/pats"),
        api.get<{ scopes: string[] }>("/auth/pats/scopes").catch(() => null),
      ]);
      setTokens(list.data);
      if (scopeList?.data?.scopes?.length) {
        setScopes(scopeList.data.scopes);
      }
    } catch (err: any) {
      setError(
        err?.response?.data?.message ??
          "Couldn't load API tokens. Refresh the page or try again later.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRevoke(id: string) {
    try {
      await api.delete(`/auth/pats/${id}`);
      toast({ title: "Token revoked", description: "It can no longer be used to access Project-Ops." });
      setPendingRevokeId(null);
      refresh();
    } catch (err: any) {
      toast({
        title: "Couldn't revoke token",
        description: err?.response?.data?.message ?? "Try again or refresh the page.",
        variant: "destructive",
      });
    }
  }

  const visibleTokens = useMemo(
    () => tokens?.filter((t) => !t.revokedAt) ?? [],
    [tokens],
  );

  return (
    <>
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass("emerald")}`}
          >
            <KeyRound className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-xl font-semibold">API tokens</h2>
            <p className="text-xs text-muted-foreground">
              Personal Access Tokens let your own MCP client (Claude Code,
              ChatGPT, custom integrations) talk to Project-Ops directly,
              alongside the Unicorn Commander Suite federation.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tokens…
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            {error}
          </div>
        ) : visibleTokens.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              No tokens yet. Create one to use Project-Ops from your own MCP
              client.
            </p>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first token
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Name</th>
                    <th className="text-left px-4 py-2">Scopes</th>
                    <th className="text-left px-4 py-2">Last used</th>
                    <th className="text-left px-4 py-2">Expires</th>
                    <th className="text-right px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTokens.map((token) => (
                    <tr key={token.id} className="border-t">
                      <td className="px-4 py-3">
                        <div className="font-medium">{token.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {token.prefix}…
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {token.scopes.map((s) => (
                            <span
                              key={s}
                              className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {token.lastUsedAt
                          ? new Date(token.lastUsedAt).toLocaleString()
                          : "Never"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {token.expiresAt
                          ? new Date(token.expiresAt).toLocaleDateString()
                          : "Never"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPendingRevokeId(token.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Revoke
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create token
            </Button>
          </div>
        )}
      </Card>

      {showCreate && (
        <CreateTokenModal
          availableScopes={scopes}
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            setShowCreate(false);
            setRevealed(created);
            refresh();
          }}
        />
      )}

      {revealed && (
        <RevealTokenModal
          token={revealed}
          onAcknowledge={() => setRevealed(null)}
        />
      )}

      {pendingRevokeId && (
        <RevokeConfirmModal
          token={visibleTokens.find((t) => t.id === pendingRevokeId)}
          onCancel={() => setPendingRevokeId(null)}
          onConfirm={() => handleRevoke(pendingRevokeId)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Create modal
// ---------------------------------------------------------------------------

function CreateTokenModal({
  availableScopes,
  onClose,
  onCreated,
}: {
  availableScopes: string[];
  onClose: () => void;
  onCreated: (created: CreatePatResult) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    "read:projects",
    "read:tasks",
  ]);
  const [expiryDays, setExpiryDays] = useState<number | null>(90);
  const [submitting, setSubmitting] = useState(false);

  function toggleScope(scope: string) {
    setSelectedScopes((current) =>
      current.includes(scope)
        ? current.filter((s) => s !== scope)
        : [...current, scope],
    );
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast({
        title: "Name is required",
        description: "Give the token a label so you can identify it later.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        scopes: selectedScopes,
      };
      if (expiryDays !== null) {
        const expiresAt = new Date(Date.now() + expiryDays * 86_400_000);
        body.expiresAt = expiresAt.toISOString();
      }
      const { data } = await api.post<CreatePatResult>("/auth/pats", body);
      onCreated(data);
    } catch (err: any) {
      toast({
        title: "Couldn't create token",
        description:
          err?.response?.data?.message ??
          "The server rejected the request. Check the form and try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={submitting ? undefined : onClose}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Create API token</h3>
          <p className="text-xs text-muted-foreground">
            Pick the scopes the token should be allowed to use, plus an expiry.
          </p>
        </div>
        <button aria-label="Close"
          onClick={onClose}
          disabled={submitting}
          className="text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pat-name">Name</Label>
          <Input
            id="pat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Claude Code on Aaron's Mac"
            disabled={submitting}
            maxLength={100}
          />
        </div>

        <div className="space-y-2">
          <Label>Scopes</Label>
          <div className="rounded-md border p-3 grid grid-cols-2 gap-2 max-h-56 overflow-y-auto">
            {availableScopes.map((scope) => (
              <label
                key={scope}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selectedScopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  disabled={submitting}
                />
                <span className="font-mono">{scope}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Scope rules apply to MCP tool calls. Other Project-Ops endpoints
            still honor the underlying user role.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Expires</Label>
          <div className="flex flex-wrap gap-2">
            {EXPIRY_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setExpiryDays(opt.days)}
                disabled={submitting}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  expiryDays === opt.days
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {expiryDays === null && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" />
              Tokens that never expire are convenient but a long-term audit
              risk. Prefer a finite lifetime.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 mt-6">
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating…
            </>
          ) : (
            "Create token"
          )}
        </Button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Reveal modal — plaintext shown exactly once
// ---------------------------------------------------------------------------

function RevealTokenModal({
  token,
  onAcknowledge,
}: {
  token: CreatePatResult;
  onAcknowledge: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(token.plaintext);
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Couldn't copy automatically",
        description: "Select the token text manually and copy it.",
        variant: "destructive",
      });
    }
  }

  return (
    // Deliberately no close button — the user MUST acknowledge.
    <ModalShell onClose={undefined}>
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Check className="h-5 w-5 text-emerald-500" />
          <h3 className="text-lg font-semibold">Token created</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Copy this token now. <strong>It will never be shown again.</strong>{" "}
          If you lose it, revoke it and create a new one.
        </p>
      </div>

      <div className="space-y-3">
        <div className="rounded-md border bg-muted/40 p-3 font-mono text-sm break-all select-all">
          {token.plaintext}
        </div>

        <Button onClick={handleCopy} variant="outline" className="w-full">
          {copied ? (
            <>
              <Check className="mr-2 h-4 w-4 text-emerald-500" />
              Copied
            </>
          ) : (
            <>
              <Copy className="mr-2 h-4 w-4" />
              Copy to clipboard
            </>
          )}
        </Button>

        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-amber-700 dark:text-amber-300">
              Treat this token like a password.
            </p>
            <p className="text-muted-foreground">
              Anyone with it can act as you against Project-Ops, scoped to:{" "}
              <span className="font-mono">
                {token.scopes.join(", ") || "(no scopes)"}
              </span>
              .
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm pt-1">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          I've copied the token somewhere safe.
        </label>
      </div>

      <div className="flex items-center justify-end gap-2 mt-6">
        <Button onClick={onAcknowledge} disabled={!acknowledged}>
          Done
        </Button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Revoke confirm
// ---------------------------------------------------------------------------

function RevokeConfirmModal({
  token,
  onCancel,
  onConfirm,
}: {
  token: PatMetadata | undefined;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell onClose={onCancel}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold">Revoke token?</h3>
        <p className="text-sm text-muted-foreground">
          {token ? (
            <>
              <span className="font-medium text-foreground">{token.name}</span>{" "}
              will stop working immediately for any MCP client using it. This
              cannot be undone.
            </>
          ) : (
            "This token will stop working immediately. This cannot be undone."
          )}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm}>
          Revoke token
        </Button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Shared modal shell
// ---------------------------------------------------------------------------

function ModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      {/* Overlay click closes only when onClose is provided (the reveal
          modal omits it to force explicit acknowledgement). */}
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative bg-card border rounded-lg shadow-lg max-w-lg w-full p-6">
        {children}
      </div>
    </div>
  );
}
