"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Capability bodies/results remain in memory; do not route through error logging
// interceptors or put tokens in URLs, browser storage or console output.
async function request(path: string, method = "GET", body?: unknown) {
  const bearer = localStorage.getItem("access_token");
  if (!bearer) throw new Error("Sign in through SSO first.");
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || "/api/v1"}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "A verified SSO session and the required workspace role are needed."
        : "Invitation request refused. Check the email, expiry and workspace status.",
    );
  return response.json();
}
export function AcceptWorkspaceInvitation() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    setMessage("");
    try {
      const joined = await request("/workspace-invitations/accept", "POST", {
        token,
      });
      setToken("");
      setMessage(
        `Joined ${joined.displayName}. Open or refresh your dashboard to select it.`,
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="space-y-3 rounded-md border p-4"
      aria-label="Accept workspace invitation"
    >
      <h3 className="font-semibold">Accept a workspace invitation</h3>
      <p className="text-sm text-muted-foreground">
        Sign in with the invited, verified SSO email, then paste the one-time
        token. This joins only the invited workspace.
      </p>
      <Input
        aria-label="Invitation token"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <Button disabled={busy || token.length !== 43} onClick={accept}>
        Accept invitation
      </Button>
      <p role="status" className="text-sm">
        {message}
      </p>
    </section>
  );
}
export function ManualWorkspaceInvitation({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<
    Array<{ id: string; email: string; role: string; expiresAt: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(
    async () =>
      setPending(await request(`/workspaces/${workspaceId}/invitations`)),
    [workspaceId],
  );
  useEffect(() => {
    setToken("");
    refresh().catch(() => setMessage("Could not load pending invitations."));
  }, [refresh]);
  async function create() {
    setBusy(true);
    setToken("");
    setMessage("");
    try {
      const result = await request(
        `/workspaces/${workspaceId}/invitations`,
        "POST",
        { email, role },
      );
      setToken(result.token);
      setMessage(
        `Expires ${new Date(result.expiresAt).toLocaleString()}. No email was sent.`,
      );
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    try {
      await request(`/workspaces/${workspaceId}/invitations/${id}`, "DELETE");
      setToken("");
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="space-y-3 rounded-md border p-4"
      aria-label="Manual workspace invitation"
    >
      <h3 className="font-semibold">Invite by one-time token</h3>
      <p className="text-sm text-muted-foreground">
        Owner only. Send the token yourself through a private channel. The
        invited person signs in and opens /auth/workspace-invitation. Tokens
        expire in 24 hours; no email is sent.
      </p>
      <Input
        aria-label="Invited email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <select
        aria-label="Invitation role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="rounded border bg-background p-2"
      >
        {["VIEWER", "MEMBER", "MANAGER", "ADMIN"].map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
      <Button disabled={busy || !email.includes("@")} onClick={create}>
        Create invitation token
      </Button>
      {token && (
        <div className="space-y-2">
          <Input
            aria-label="One-time invitation token"
            type="password"
            readOnly
            value={token}
          />
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(token);
                setMessage(
                  "Token copied. Share it privately; it is shown only during this visit.",
                );
              } catch {
                setMessage(
                  "Clipboard unavailable. Select the token field and copy it manually.",
                );
              }
            }}
          >
            Copy token
          </Button>
        </div>
      )}
      <p role="status" className="text-sm">
        {message}
      </p>
      <ul>
        {pending.map((invite) => (
          <li
            key={invite.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2"
          >
            <span>
              {invite.email} · {invite.role} · expires{" "}
              {new Date(invite.expiresAt).toLocaleString()}
            </span>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => revoke(invite.id)}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
