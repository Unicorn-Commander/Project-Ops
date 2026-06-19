"use client";

/**
 * PortalWelcome — the client's first-run welcome, shown on the portal
 * dashboard. It's a thin, friendly wrapper around the guidance kit's generic
 * <OnboardingChecklist>: it supplies portal-specific, jargon-free steps that
 * deep-link to the real portal routes, and persists its own dismissal via the
 * guidance store (storageKey "client-portal.first-run"), so it never returns
 * once the client has waved it away or worked through it.
 *
 * Steps can reflect real state: pass `hasProjects` / `hasApprovals` /
 * `hasInvoices` and the matching rows render as "done" (checked, struck
 * through) — a quiet sign of progress without nagging.
 *
 * Hydration + the tooltips master-switch are handled inside OnboardingChecklist;
 * this component adds no client-only render branches of its own.
 */

import { OnboardingChecklist } from "@/components/guidance";

export interface PortalWelcomeProps {
  /** Whether the client already has at least one project. */
  hasProjects?: boolean;
  /** Whether anything is waiting on the client's approval. */
  hasPendingApprovals?: boolean;
  /** Whether the client has any invoices. */
  hasInvoices?: boolean;
}

const STORAGE_KEY = "client-portal.first-run";

export function PortalWelcome({
  hasProjects = false,
  hasPendingApprovals = false,
  hasInvoices = false,
}: PortalWelcomeProps) {
  return (
    <OnboardingChecklist
      storageKey={STORAGE_KEY}
      title="Welcome to your portal"
      subtitle="A calm home for everything we're working on together. Here's how to get the most from it."
      doneLabel="Got it"
      steps={[
        {
          id: "projects",
          label: "Review your projects",
          description: "See what's in progress and track every milestone.",
          href: "/client-portal/projects",
          done: hasProjects,
        },
        {
          id: "approvals",
          label: "Approve deliverables when they're ready",
          description:
            "We'll send work here for your sign-off — approve, or ask for changes.",
          href: "/client-portal/approvals",
          done: hasPendingApprovals ? false : hasProjects,
        },
        {
          id: "message",
          label: "Message your team",
          description: "Open any project to start a conversation with us.",
          href: "/client-portal/projects",
          done: false,
        },
        {
          id: "invoices",
          label: "View & pay invoices",
          description: "Check balances and settle up securely, anytime.",
          href: "/client-portal/invoices",
          done: hasInvoices,
        },
      ]}
    />
  );
}
