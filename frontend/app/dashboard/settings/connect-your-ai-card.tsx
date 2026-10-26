"use client";

import { useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { iconWellClass } from "@/lib/badge-styles";
import { MCP_URL } from "@/lib/mcp-url";
import { Check, Copy, Sparkles } from "lucide-react";

const TOKEN_PLACEHOLDER = "<token>";

const TABS = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop / claude.ai" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "other", label: "Cursor / Codex / other" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const CLAUDE_OAUTH_COMMAND = `claude mcp add --transport http project-ops ${MCP_URL}`;
const CLAUDE_TOKEN_COMMAND = `${CLAUDE_OAUTH_COMMAND} --header "Authorization: Bearer ${TOKEN_PLACEHOLDER}"`;

const MCP_JSON = JSON.stringify(
  {
    mcpServers: {
      "project-ops": {
        type: "http",
        url: MCP_URL,
      },
    },
  },
  null,
  2,
);

const MCP_JSON_WITH_TOKEN = JSON.stringify(
  {
    mcpServers: {
      "project-ops": {
        type: "http",
        url: MCP_URL,
        headers: {
          Authorization: `Bearer ${TOKEN_PLACEHOLDER}`,
        },
      },
    },
  },
  null,
  2,
);

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopy}
      aria-label={copied ? `${label} copied` : label}
      className="shrink-0"
    >
      {copied ? <Check className="text-emerald-500" /> : <Copy />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function CodeSnippet({
  label,
  code,
  copyLabel = label,
}: {
  label: string;
  code: string;
  copyLabel?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <CopyButton value={code} label={`Copy ${copyLabel}`} />
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed">
        <code className="font-mono whitespace-pre-wrap break-words text-foreground/90">
          {code}
        </code>
      </pre>
    </div>
  );
}

function TabContent({ tab }: { tab: TabId }): ReactNode {
  switch (tab) {
    case "claude-code":
      return (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Sign in with Claude Code</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Run this command. A browser window asks you to sign in, then
              Claude Code can use Project Ops with your account permissions.
            </p>
          </div>
          <CodeSnippet label="OAuth sign-in" code={CLAUDE_OAUTH_COMMAND} />
          <CodeSnippet label="or paste a token" code={CLAUDE_TOKEN_COMMAND} />
        </div>
      );
    case "claude-desktop":
      return (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Add a custom connector</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              In Claude Desktop or claude.ai, open Settings → Connectors → Add
              custom connector → paste the URL. Sign-in appears when you
              connect.
            </p>
          </div>
          <CodeSnippet label="MCP URL" code={MCP_URL} copyLabel="MCP URL" />
        </div>
      );
    case "chatgpt":
      return (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Add a developer connector</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              In ChatGPT, open Settings → Connectors → Advanced → Developer
              mode → New connector → URL, then paste the endpoint below.
            </p>
          </div>
          <CodeSnippet label="MCP URL" code={MCP_URL} copyLabel="MCP URL" />
        </div>
      );
    case "other":
      return (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Add an HTTP server</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Add one of these entries to your <code className="font-mono">mcp.json</code>.
              Choose the token variant only when you are using a Personal
              Access Token.
            </p>
          </div>
          <CodeSnippet label="OAuth sign-in" code={MCP_JSON} copyLabel="mcp.json" />
          <CodeSnippet
            label="or paste a token"
            code={MCP_JSON_WITH_TOKEN}
            copyLabel="mcp.json with token header"
          />
        </div>
      );
  }
}

export function ConnectYourAiCard() {
  const [activeTab, setActiveTab] = useState<TabId>("claude-code");
  const activePanelId = `connect-your-ai-panel-${activeTab}`;

  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <div
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${iconWellClass("blue")}`}
        >
          <Sparkles className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Connect your AI</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Use your preferred AI client with Project Ops over MCP. Choose a
            setup below, then connect using the endpoint for this environment.
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              MCP URL
            </p>
            <code className="mt-1 block break-all font-mono text-sm text-foreground">
              {MCP_URL}
            </code>
          </div>
          <CopyButton value={MCP_URL} label="Copy MCP URL" />
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Connect your AI clients"
        className="mt-5 grid grid-cols-1 gap-1 rounded-lg border border-border bg-muted/40 p-1 sm:grid-cols-2 lg:grid-cols-4"
      >
        {TABS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`connect-your-ai-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`connect-your-ai-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-9 rounded-md px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        id={activePanelId}
        role="tabpanel"
        aria-labelledby={`connect-your-ai-tab-${activeTab}`}
        className="mt-5"
      >
        <TabContent tab={activeTab} />
      </div>

      <p className="mt-5 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm leading-relaxed text-foreground/90">
        Your AI signs in as you and works in your workspaces. Revoke any token
        below.
      </p>
    </Card>
  );
}
