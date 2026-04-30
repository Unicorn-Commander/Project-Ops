"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useParams, usePathname } from "next/navigation";
import { Sparkles, X, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import api from "@/lib/api";
import { logger } from "@/lib/logger";

type Role = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  pending?: boolean;
}

const SUGGESTIONS = [
  "What projects do I have right now?",
  "What's on my plate this week?",
  "Catch me up on what's changed lately.",
  "Break this scope into 5 tasks I can assign.",
];

function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const params = useParams();
  const pathname = usePathname();
  const projectId =
    pathname?.startsWith("/dashboard/projects/") &&
    typeof params?.id === "string"
      ? (params.id as string)
      : undefined;

  useEffect(() => {
    if (!open || !scrollRef.current) return;
    if (messages.length === 0) {
      // First-open with welcome state — scroll to top so the user sees the
      // header copy and suggestion chips, not the bottom of the panel.
      scrollRef.current.scrollTop = 0;
    } else {
      // Active chat — keep the latest message in view.
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, messages]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);

    const userMsg: ChatMessage = { id: genId(), role: "user", content: trimmed };
    const pendingMsg: ChatMessage = {
      id: genId(),
      role: "assistant",
      content: "",
      pending: true,
    };
    setMessages((prev) => [...prev, userMsg, pendingMsg]);
    setInput("");
    setLoading(true);

    try {
      const history = messages
        .filter((m) => !m.pending && m.content)
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await api.post("/assistant/chat", {
        message: trimmed,
        history,
        projectId,
      });
      const data = res.data ?? {};
      if (data.error) {
        throw new Error(data.error);
      }
      const reply = (data.content ?? "").trim();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsg.id
            ? { ...m, content: reply || "(empty reply)", pending: false }
            : m,
        ),
      );
    } catch (err) {
      const message =
        (err as any)?.response?.data?.error ||
        (err as Error)?.message ||
        "Something went wrong reaching the assistant.";
      logger.warn("assistant error: " + message);
      setError(message);
      setMessages((prev) => prev.filter((m) => m.id !== pendingMsg.id));
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <>
      {/* Trigger — small pill with the assistant's mascot avatar so the
          entry point reads as "ask Project Ops" rather than a generic
          sparkle icon. */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Ask Project Ops Assistant"
        title="Ask the assistant"
        className="group inline-flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground/80 transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        <span className="inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-border">
          <Image src="/projectops-mascot.png" alt="" width={20} height={20} />
        </span>
        <span className="hidden sm:inline">Ask</span>
        <Sparkles className="h-3.5 w-3.5 text-foreground/55 transition-colors group-hover:text-foreground/80" />
      </button>

      {/* Panel */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <aside
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-2xl sm:max-w-lg"
            role="dialog"
            aria-label="Project Ops assistant"
          >
            {/* Header */}
            <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-border">
                  <Image src="/projectops-mascot.png" alt="" width={36} height={36} />
                </span>
                <div className="leading-tight">
                  <div className="text-sm font-semibold tracking-tight">
                    Project Ops Assistant
                  </div>
                  <div className="text-[11px] text-foreground/55">
                    Powered by Unicorn Brigade
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
              >
                <X className="h-5 w-5" />
              </Button>
            </header>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
              {messages.length === 0 ? (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-base font-semibold">
                      How can I help today?
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-foreground/65">
                      I can read your projects, tasks, and recent activity
                      directly — just ask. I can also draft status updates,
                      break scopes into tasks, and summarize context you
                      paste in.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground/55">
                      Try
                    </div>
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => sendMessage(s)}
                        className="block w-full rounded-md border border-border bg-card px-3 py-2 text-left text-sm text-foreground/80 transition-colors hover:border-foreground/30 hover:bg-muted/50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={
                        m.role === "user"
                          ? "ml-auto max-w-[85%] rounded-lg bg-foreground px-3 py-2 text-sm text-background"
                          : "mr-auto max-w-[90%] rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                      }
                    >
                      {m.pending ? (
                        <span className="inline-flex items-center gap-2 text-foreground/60">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Thinking…
                        </span>
                      ) : (
                        <span className="whitespace-pre-wrap leading-relaxed">
                          {m.content}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {error && (
                <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
            </div>

            {/* Composer */}
            <form
              onSubmit={handleSubmit}
              className="border-t border-border bg-background px-4 py-3"
            >
              <div className="flex items-end gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage(input);
                    }
                  }}
                  placeholder="Ask the assistant…"
                  rows={2}
                  className="min-h-[60px] resize-none"
                  disabled={loading}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={loading || !input.trim()}
                  aria-label="Send"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <div className="mt-2 text-[11px] text-foreground/50">
                Enter to send · Shift+Enter for new line
              </div>
            </form>
          </aside>
        </>
      )}
    </>
  );
}
