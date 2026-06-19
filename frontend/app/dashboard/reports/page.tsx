"use client";

/**
 * Reports — the Project-Ops analytics suite. Three report surfaces behind a
 * segmented tab control:
 *
 *   - Portfolio     — project health, budget burn, status mix.
 *   - Profitability — margin, realization, cost recovery (money-gated).
 *   - Throughput    — completed-tasks/projects velocity over time.
 *
 * Each section owns its own data fetch + loading/empty/error states, so
 * switching tabs only mounts (and fetches) the active surface. The default
 * tab is a static literal ("portfolio"), so the server render and the first
 * client render agree — no hydration mismatch (React #418).
 *
 * Recharts usage in the sections mirrors
 * `components/dashboard/project-charts.tsx`: numeric ResponsiveContainer
 * heights, isAnimationActive={false} on every series, numeric pie radii.
 */

import { useState } from "react";
import { SegmentedTabs } from "@/components/reporting/shared";
import { PortfolioSection } from "@/components/reporting/portfolio-section";
import { ProfitabilitySection } from "@/components/reporting/profitability-section";
import { ThroughputSection } from "@/components/reporting/throughput-section";
import { HelpHint } from "@/components/guidance";
import { FolderKanban, TrendingUp, Activity } from "lucide-react";

type Tab = "portfolio" | "profitability" | "throughput";

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "portfolio", label: "Portfolio", icon: FolderKanban },
  { key: "profitability", label: "Profitability", icon: TrendingUp },
  { key: "throughput", label: "Throughput", icon: Activity },
];

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("portfolio");

  return (
    <div className="po-page-enter space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            Reports
            <HelpHint
              icon="info"
              side="bottom"
              learnMore={{ category: "reports", article: "reports-overview" }}
            >
              Three views of how the business is doing, each a chart plus a table:{" "}
              <span className="font-semibold">Portfolio</span> (project health — budget vs
              logged, over-budget),{" "}
              <span className="font-semibold">Profitability</span> (margin &amp; realization —
              managers only), and <span className="font-semibold">Throughput</span> (completed
              work over time).
            </HelpHint>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Portfolio health, profitability, and delivery throughput across your
            workspace.
          </p>
        </div>
        <SegmentedTabs
          options={TABS}
          value={tab}
          onChange={setTab}
          ariaLabel="Report"
        />
      </div>

      {tab === "portfolio" && <PortfolioSection />}
      {tab === "profitability" && <ProfitabilitySection />}
      {tab === "throughput" && <ThroughputSection />}
    </div>
  );
}
