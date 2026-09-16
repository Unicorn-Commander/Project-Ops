import { AcceptWorkspaceInvitation } from "@/components/workspace-invitations";
import Link from "next/link";
export default function WorkspaceInvitationPage() {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Join a workspace</h1>
      <p>
        Use the exact email invited by the workspace owner. Sign in first, then
        return here with the token.
      </p>
      <Link href="/auth/login" className="underline">
        Sign in
      </Link>
      <AcceptWorkspaceInvitation />
      <Link href="/dashboard" className="underline">
        Open dashboard
      </Link>
    </main>
  );
}
