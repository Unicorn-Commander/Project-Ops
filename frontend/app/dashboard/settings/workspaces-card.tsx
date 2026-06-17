"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/components/workspace-provider";
import { iconWellClass, roleBadgeClass } from "@/lib/badge-styles";
import type { WorkspaceMembership } from "@/lib/workspace";
import {
  addWorkspaceMember,
  createWorkspace,
  getWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  type AddMemberResult,
  type WorkspaceMember,
  type WorkspaceRole,
} from "@/lib/workspaces-api";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Loader2,
  Plus,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";

// Suite role ranking (mirrors backend WorkspacesService.ROLE_RANK).
const ROLE_RANK: Record<WorkspaceRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  MANAGER: 2,
  ADMIN: 3,
  OWNER: 4,
};

// Roles assignable when inviting/sharing (OWNER is granted via role-change only).
const ASSIGNABLE_ROLES: WorkspaceRole[] = [
  "VIEWER",
  "MEMBER",
  "MANAGER",
  "ADMIN",
];
// All roles selectable in the change-role control (an OWNER may add co-owners).
const ALL_ROLES: WorkspaceRole[] = ["VIEWER", "MEMBER", "MANAGER", "ADMIN", "OWNER"];

/**
 * "Workspaces" settings card — the in-app surface for the workspace & member
 * management ("easy sharing") feature.
 *
 *   - Lists MY workspaces (from WorkspaceProvider) with my role + active flag.
 *   - Create workspace (name → POST /workspaces → optimistic switcher insert +
 *     refresh, with an offer to switch to it).
 *   - Per-workspace Members panel: list members + roles, invite by email+role,
 *     change role, remove. Owner/admin-only controls are hidden for others.
 *
 * Authority is the caller's WorkspaceRole IN THAT workspace (from the provider's
 * membership list) — not the global app role. The backend re-enforces it.
 */
export function WorkspacesCard() {
  const { toast } = useToast();
  const { workspaces, activeWorkspaceId, switchWorkspace, refreshWorkspaces, addWorkspace } =
    useWorkspace();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <>
      <Card className="p-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass(
                "violet",
              )}`}
            >
              <Building2 className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Workspaces</h2>
              <p className="text-xs text-muted-foreground">
                Each workspace is an isolated tenant. Create one and invite
                teammates or clients to share its projects, tasks, and time.
              </p>
            </div>
          </div>
          <Button onClick={() => setShowCreate(true)} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            New workspace
          </Button>
        </div>

        {workspaces.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center">
            <p className="mb-3 text-sm text-muted-foreground">
              You don&apos;t belong to any workspace yet. Create one to start
              sharing.
            </p>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first workspace
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {workspaces.map((ws) => (
              <WorkspaceRow
                key={ws.workspaceId}
                workspace={ws}
                isActive={ws.workspaceId === activeWorkspaceId}
                isExpanded={expandedId === ws.workspaceId}
                onToggle={() =>
                  setExpandedId((cur) =>
                    cur === ws.workspaceId ? null : ws.workspaceId,
                  )
                }
                onSwitch={() => {
                  switchWorkspace(ws.workspaceId);
                  toast({
                    title: "Workspace switched",
                    description: `Now viewing ${ws.displayName}.`,
                  });
                }}
              />
            ))}
          </ul>
        )}
      </Card>

      {showCreate && (
        <CreateWorkspaceModal
          onClose={() => setShowCreate(false)}
          onCreated={async (created) => {
            setShowCreate(false);
            addWorkspace(created); // optimistic — appears in the switcher now
            await refreshWorkspaces(); // reconcile with the server
            toast({
              title: "Workspace created",
              description: `${created.displayName} is ready. You're its owner.`,
            });
            // Auto-expand the new workspace's members panel so the next step
            // (inviting people) is one click away.
            setExpandedId(created.workspaceId);
          }}
          onSwitchTo={(created) => switchWorkspace(created.workspaceId)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// One workspace row + its (collapsible) members panel
// ---------------------------------------------------------------------------

function WorkspaceRow({
  workspace,
  isActive,
  isExpanded,
  onToggle,
  onSwitch,
}: {
  workspace: WorkspaceMembership;
  isActive: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onSwitch: () => void;
}) {
  const myRole = workspace.role as WorkspaceRole;

  return (
    <li className="rounded-md border">
      <div className="flex items-center justify-between gap-3 p-4">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">
                {workspace.displayName}
              </span>
              {isActive && (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  Active
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {workspace.slug}
            </span>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <Badge className={roleBadgeClass(myRole)}>{myRole}</Badge>
          {!isActive && (
            <Button variant="outline" size="sm" onClick={onSwitch}>
              Switch
            </Button>
          )}
        </div>
      </div>

      {isExpanded && (
        <MembersPanel workspace={workspace} myRole={myRole} />
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Members panel (list + invite + change role + remove)
// ---------------------------------------------------------------------------

function MembersPanel({
  workspace,
  myRole,
}: {
  workspace: WorkspaceMembership;
  myRole: WorkspaceRole;
}) {
  const { toast } = useToast();
  const workspaceId = workspace.workspaceId;
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<WorkspaceMember | null>(
    null,
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const canManageMembers = ROLE_RANK[myRole] >= ROLE_RANK.ADMIN; // invite/share
  const isOwner = myRole === "OWNER"; // change role / remove

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMembers(await getWorkspaceMembers(workspaceId));
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(
        e?.response?.data?.message ??
          "Couldn't load members. Refresh and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ownerCount =
    members?.filter((m) => m.role === "OWNER" && m.status === "ACTIVE").length ??
    0;

  async function handleChangeRole(member: WorkspaceMember, role: WorkspaceRole) {
    if (role === member.role) return;
    setBusyKey(member.userKey);
    try {
      await updateWorkspaceMemberRole(workspaceId, member.userKey, role);
      toast({ title: "Role updated" });
      await refresh();
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast({
        title: "Couldn't change role",
        description: e?.response?.data?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRemove(member: WorkspaceMember) {
    setBusyKey(member.userKey);
    try {
      await removeWorkspaceMember(workspaceId, member.userKey);
      toast({
        title: member.pending ? "Invite revoked" : "Member removed",
      });
      setPendingRemove(null);
      await refresh();
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast({
        title: "Couldn't remove",
        description: e?.response?.data?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="border-t bg-muted/20 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Users className="h-4 w-4 text-muted-foreground" />
          Members
        </div>
        {canManageMembers && (
          <Button size="sm" variant="outline" onClick={() => setShowInvite(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading members…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          {error}
        </div>
      ) : !members || members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <div className="overflow-hidden rounded-md border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Member</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                // The sole active owner cannot be demoted or removed.
                const isLastOwner =
                  m.role === "OWNER" &&
                  m.status === "ACTIVE" &&
                  ownerCount <= 1;
                const rowBusy = busyKey === m.userKey;
                return (
                  <tr key={m.userKey} className="border-t">
                    <td className="px-3 py-3">
                      {m.pending ? (
                        <div>
                          <div className="font-medium">Pending invite</div>
                          <div className="text-xs text-muted-foreground">
                            Awaiting sign-up
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="font-medium">
                            {m.user?.name ?? m.userKey}
                          </div>
                          {m.user?.email && (
                            <div className="text-xs text-muted-foreground">
                              {m.user.email}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {isOwner && !isLastOwner ? (
                        <Select
                          value={m.role}
                          onValueChange={(v) =>
                            handleChangeRole(m, v as WorkspaceRole)
                          }
                          disabled={rowBusy}
                        >
                          <SelectTrigger className="h-8 w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ALL_ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge className={roleBadgeClass(m.role)}>
                          {m.role}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {isOwner && !isLastOwner ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={rowBusy}
                          onClick={() => setPendingRemove(m)}
                        >
                          {rowBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Trash2 className="mr-1 h-4 w-4" />
                              {m.pending ? "Revoke" : "Remove"}
                            </>
                          )}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {isLastOwner ? "Sole owner" : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showInvite && (
        <InviteMemberModal
          workspaceName={workspace.displayName}
          onClose={() => setShowInvite(false)}
          onInvited={async () => {
            setShowInvite(false);
            await refresh();
          }}
          invite={(email, role) =>
            addWorkspaceMember(workspaceId, { email, role })
          }
        />
      )}

      {pendingRemove && (
        <ConfirmRemoveModal
          member={pendingRemove}
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => handleRemove(pendingRemove)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create workspace modal
// ---------------------------------------------------------------------------

function CreateWorkspaceModal({
  onClose,
  onCreated,
  onSwitchTo,
}: {
  onClose: () => void;
  onCreated: (created: WorkspaceMembership) => void | Promise<void>;
  onSwitchTo: (created: WorkspaceMembership) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({
        title: "Name is required",
        description: "Give the workspace a name.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const created = await createWorkspace(trimmed);
      // Offer to switch immediately (non-blocking, before the await chain).
      onSwitchTo(created);
      await onCreated(created);
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast({
        title: "Couldn't create workspace",
        description: e?.response?.data?.message ?? "Try again.",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={submitting ? undefined : onClose}>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">Create workspace</h3>
          <p className="text-xs text-muted-foreground">
            You&apos;ll be its owner. You can invite people once it&apos;s
            created.
          </p>
        </div>
        <button
          aria-label="Close"
          onClick={onClose}
          disabled={submitting}
          className="text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ws-name">Workspace name</Label>
          <Input
            id="ws-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Consulting"
            maxLength={120}
            disabled={submitting}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !submitting) handleSubmit();
            }}
          />
        </div>
      </div>
      <div className="mt-6 flex items-center justify-end gap-2">
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
            "Create workspace"
          )}
        </Button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Invite member modal (email + role; surfaces an invite link for new people)
// ---------------------------------------------------------------------------

function InviteMemberModal({
  workspaceName,
  onClose,
  onInvited,
  invite,
}: {
  workspaceName: string;
  onClose: () => void;
  onInvited: () => void | Promise<void>;
  invite: (email: string, role: WorkspaceRole) => Promise<AddMemberResult>;
}) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("MEMBER");
  const [submitting, setSubmitting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit() {
    const trimmed = email.trim();
    if (!trimmed) {
      toast({
        title: "Email is required",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const result = await invite(trimmed, role);
      if (result.kind === "invite") {
        // No account yet — surface the shareable link instead of closing.
        setInviteLink(result.inviteUrl);
        toast({
          title: "Invite created",
          description: `Share the link with ${result.email} so they can join.`,
        });
        await onInvited();
      } else {
        toast({
          title: "Member added",
          description: `${result.email} now has ${result.role} access to ${workspaceName}.`,
        });
        await onInvited();
        onClose();
      }
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast({
        title: "Couldn't add member",
        description: e?.response?.data?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast({ title: "Link copied" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Couldn't copy automatically",
        description: "Select the link and copy it manually.",
        variant: "destructive",
      });
    }
  }

  return (
    <ModalShell onClose={submitting ? undefined : onClose}>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">Invite to {workspaceName}</h3>
          <p className="text-xs text-muted-foreground">
            If they already have an account, access is immediate. Otherwise
            we&apos;ll generate a sign-up link to share.
          </p>
        </div>
        <button
          aria-label="Close"
          onClick={onClose}
          disabled={submitting}
          className="text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {inviteLink ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Share this link so they can create an account and join with the
            chosen role. It can only be used once.
          </p>
          <div className="select-all break-all rounded-md border bg-muted/40 p-3 font-mono text-xs">
            {inviteLink}
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
                Copy link
              </>
            )}
          </Button>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
                maxLength={255}
                disabled={submitting}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as WorkspaceRole)}
                disabled={submitting}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Viewer reads only; Member contributes; Manager runs projects;
                Admin can also invite. Ownership is transferred separately.
              </p>
            </div>
          </div>
          <div className="mt-6 flex items-center justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding…
                </>
              ) : (
                "Add member"
              )}
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Confirm-remove modal
// ---------------------------------------------------------------------------

function ConfirmRemoveModal({
  member,
  onCancel,
  onConfirm,
}: {
  member: WorkspaceMember;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const label = member.pending
    ? "this pending invite"
    : (member.user?.name ?? member.user?.email ?? "this member");
  return (
    <ModalShell onClose={onCancel}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold">
          {member.pending ? "Revoke invite?" : "Remove member?"}
        </h3>
        <p className="text-sm text-muted-foreground">
          {member.pending ? (
            <>
              The invite link for{" "}
              <span className="font-medium text-foreground">{label}</span> will
              stop working. This cannot be undone.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{label}</span> will
              lose access to this workspace immediately. This cannot be undone.
            </>
          )}
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm}>
          {member.pending ? "Revoke invite" : "Remove member"}
        </Button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Shared modal shell (mirrors api-tokens-card.tsx)
// ---------------------------------------------------------------------------

function ModalShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg">
        {children}
      </div>
    </div>
  );
}
