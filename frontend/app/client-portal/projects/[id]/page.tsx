"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  ArrowLeft,
  FolderOpen,
  Calendar,
  User,
  MessageSquare,
  Receipt,
  Send,
  FileText,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useHydrated } from "@/lib/use-hydrated";
import api from "@/lib/api";
import { QuotePanel } from "@/components/project/quote-panel";
import {
  statusBadgeClass,
  priorityBadgeClass,
  paymentStatusBadgeClass,
} from "@/lib/badge-styles";
import {
  getProjectComments,
  postProjectComment,
  type PortalComment,
} from "@/lib/portal-api";
import { format } from "date-fns";
import { formatDateOnly } from "@/lib/date-only";
import Link from "next/link";
import { PortalEmpty, money, formatFileSize } from "@/components/portal";

interface ProjectDetails {
  id: string;
  projectNumber: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  invoiceNumber: string | null;
  billingAmount: number | null;
  amountPaid: number | null;
  paymentStatus: string | null;
  billingDate: string | null;
  paymentDueDate: string | null;
  paymentReceivedDate: string | null;
  billingNotes: string | null;
  assignedTo: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  documents: Array<{
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    status: string;
    uploadedAt: string;
    uploadedBy: {
      firstName: string;
      lastName: string;
    };
  }>;
  comments: Array<{
    id: string;
    content: string;
    createdAt: string;
    author: {
      firstName: string;
      lastName: string;
    };
  }>;
}

export default function ProjectDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const hydrated = useHydrated();
  const [loading, setLoading] = useState(true);
  const [projectData, setProjectData] = useState<ProjectDetails | null>(null);

  // Comments are driven by the dedicated two-way endpoint (read + post) rather
  // than the snapshot embedded in the project payload, so a newly posted
  // comment shows immediately and carries the author's role.
  const [comments, setComments] = useState<PortalComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  const projectId = params?.id as string;

  useEffect(() => {
    if (projectId) {
      loadProject();
      loadComments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const loadProject = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/client-portal/projects/${projectId}`);
      setProjectData(response.data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to load project details",
        variant: "destructive",
      });
      router.push("/client-portal/projects");
    } finally {
      setLoading(false);
    }
  };

  const loadComments = async () => {
    try {
      const data = await getProjectComments(projectId);
      setComments(data);
    } catch {
      // Non-fatal: the project itself still renders. Leave the thread empty.
    }
  };

  const handlePostComment = async () => {
    const content = commentDraft.trim();
    if (!content || postingComment) return;
    setPostingComment(true);
    try {
      const created = await postProjectComment(projectId, content);
      // Prepend — the list is ordered newest-first.
      setComments((prev) => [created, ...prev]);
      setCommentDraft("");
    } catch (error: any) {
      toast({
        title: "Could not post comment",
        description:
          error.response?.data?.message || "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setPostingComment(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!projectData) {
    return null;
  }

  const outstanding =
    projectData.billingAmount != null
      ? projectData.billingAmount - (projectData.amountPaid || 0)
      : null;

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link href="/client-portal/projects">
        <Button variant="ghost" className="-ml-2 text-muted-foreground hover:text-foreground no-print">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to projects
        </Button>
      </Link>

      {/* Project header */}
      <Card className="overflow-hidden bg-card">
        <div className="bg-gradient-to-br from-primary/[0.06] to-transparent p-6">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">
                #{projectData.projectNumber}
              </span>
              <Badge className={statusBadgeClass(projectData.status)}>
                {projectData.status.replace("_", " ")}
              </Badge>
              <Badge className={priorityBadgeClass(projectData.priority)}>
                {projectData.priority}
              </Badge>
            </div>
            {hydrated && (
              <span className="text-sm text-muted-foreground">
                Started {format(new Date(projectData.createdAt), "MMM d, yyyy")}
              </span>
            )}
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {projectData.title}
          </h1>

          {projectData.description && (
            <p className="mt-2 max-w-2xl leading-relaxed text-muted-foreground">
              {projectData.description}
            </p>
          )}
        </div>

        {(projectData.assignedTo || projectData.dueDate) && (
          <div className="grid grid-cols-1 gap-4 border-t border-border p-6 sm:grid-cols-2">
            {projectData.assignedTo && (
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <User className="h-5 w-5" strokeWidth={1.9} />
                </span>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Your point of contact
                  </p>
                  <p className="text-sm font-medium text-foreground">
                    {projectData.assignedTo.firstName} {projectData.assignedTo.lastName}
                  </p>
                </div>
              </div>
            )}
            {projectData.dueDate && hydrated && (
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-300">
                  <Calendar className="h-5 w-5" strokeWidth={1.9} />
                </span>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Target date
                  </p>
                  <p className="text-sm font-medium text-foreground">
                    {formatDateOnly(projectData.dueDate)}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Quote — number, title, totals, status and the share link only
          (the backend masks everything else for the CLIENT role). */}
      <QuotePanel endpoint={`/client-portal/projects/${projectId}/quote`} variant="portal" />

      {/* Billing */}
      {projectData.billingAmount != null && (
        <Card className="overflow-hidden bg-card">
          <div className="flex items-center gap-2 border-b border-border px-6 py-4">
            <Receipt className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">Billing</h2>
          </div>

          <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
            <div className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {money(projectData.billingAmount)}
              </p>
            </div>
            <div className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Paid
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {money(projectData.amountPaid || 0)}
              </p>
            </div>
            <div className="p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Balance
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {money(outstanding)}
              </p>
            </div>
            <div className="flex flex-col justify-center p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Status
              </p>
              <div className="mt-1.5">
                {projectData.paymentStatus ? (
                  <Badge className={paymentStatusBadgeClass(projectData.paymentStatus)}>
                    {projectData.paymentStatus.replace("_", " ")}
                  </Badge>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
            </div>
          </div>

          {(projectData.invoiceNumber ||
            (projectData.paymentDueDate && hydrated) ||
            projectData.billingNotes) && (
            <div className="space-y-3 border-t border-border px-6 py-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {projectData.invoiceNumber && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Invoice number
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {projectData.invoiceNumber}
                    </p>
                  </div>
                )}
                {projectData.paymentDueDate && hydrated && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Payment due
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {formatDateOnly(projectData.paymentDueDate)}
                    </p>
                  </div>
                )}
              </div>
              {projectData.billingNotes && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Notes
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    {projectData.billingNotes}
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Documents */}
      <Card className="overflow-hidden bg-card">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <FolderOpen className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">
            Documents{" "}
            <span className="font-normal text-muted-foreground">
              ({projectData.documents.length})
            </span>
          </h2>
        </div>

        {projectData.documents.length === 0 ? (
          <div className="p-6">
            <PortalEmpty
              icon={FolderOpen}
              title="No documents yet"
              body="Files your team shares on this project will show up here."
              className="border-dashed"
            />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {projectData.documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-start justify-between gap-4 px-6 py-4 transition-colors hover:bg-muted/30"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3.5">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-500/15 text-zinc-600 dark:text-zinc-300">
                    <FileText className="h-5 w-5" strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {doc.fileName}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {formatFileSize(doc.fileSize)} · {doc.uploadedBy.firstName}{" "}
                      {doc.uploadedBy.lastName}
                      {hydrated && (
                        <> · {format(new Date(doc.uploadedAt), "MMM d, yyyy")}</>
                      )}
                    </p>
                  </div>
                </div>
                <Badge className={statusBadgeClass(doc.status)}>{doc.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Discussion — two-way conversation */}
      <Card className="overflow-hidden bg-card">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">
            Discussion{" "}
            <span className="font-normal text-muted-foreground">
              ({comments.length})
            </span>
          </h2>
        </div>

        {/* Composer */}
        <div className="space-y-3 border-b border-border p-5">
          <Textarea
            aria-label="Write a message to your team"
            placeholder="Write a message to your team…"
            value={commentDraft}
            onChange={(e) => setCommentDraft(e.target.value)}
            disabled={postingComment}
            rows={3}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter posts, matching the app's other composers.
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handlePostComment();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Press ⌘/Ctrl + Enter to send
            </span>
            <Button
              onClick={handlePostComment}
              disabled={postingComment || !commentDraft.trim()}
              className="bg-primary hover:bg-primary/90"
            >
              {postingComment ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send message
            </Button>
          </div>
        </div>

        {comments.length === 0 ? (
          <div className="p-6">
            <PortalEmpty
              icon={MessageSquare}
              title="Start the conversation"
              body="Questions, feedback, or just a hello — your team will see your message and reply right here."
              className="border-dashed"
            />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {comments.map((comment) => {
              const isYou = comment.author?.role === "CLIENT";
              const name = comment.author?.name ?? "Unknown";
              const initials =
                name
                  .split(" ")
                  .map((p) => p.charAt(0))
                  .slice(0, 2)
                  .join("")
                  .toUpperCase() || "·";
              return (
                <div key={comment.id} className="flex gap-3.5 p-5">
                  <span
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      isYou
                        ? "bg-primary/15 text-primary"
                        : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300"
                    }`}
                  >
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{name}</span>
                      {isYou && (
                        <Badge className="bg-primary/15 text-primary">You</Badge>
                      )}
                      {hydrated && (
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(comment.createdAt), "MMM d, yyyy · h:mm a")}
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed text-foreground">
                      {comment.content}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
