"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  createProjectFromProposals,
  type TriageProposal,
  type TriagePriority,
} from "@/lib/triage-api";
import { Loader2, FolderPlus } from "lucide-react";

const PRIORITIES: { value: TriagePriority; label: string; color: string }[] = [
  { value: "LOW", label: "Low", color: "text-zinc-500 dark:text-zinc-400" },
  { value: "MEDIUM", label: "Medium", color: "text-blue-600 dark:text-blue-400" },
  { value: "HIGH", label: "High", color: "text-orange-600 dark:text-orange-400" },
  { value: "URGENT", label: "Urgent", color: "text-rose-600 dark:text-rose-400" },
];

interface CreateProjectFromProposalsModalProps {
  isOpen: boolean;
  onClose: () => void;
  // The proposals selected on the "Needs a project" section — applied as the
  // new project's tasks once it's created.
  proposals: TriageProposal[];
  // Called with the new project number after a successful create so the parent
  // can refetch + surface a confirmation.
  onSuccess: (result: { projectId: string; projectNumber: string; applied: number }) => void;
}

export function CreateProjectFromProposalsModal({
  isOpen,
  onClose,
  proposals,
  onSuccess,
}: CreateProjectFromProposalsModalProps) {
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TriagePriority>("MEDIUM");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // Reset the form each time the modal opens so a prior draft never leaks into
  // a new selection.
  useEffect(() => {
    if (isOpen) {
      setTitle("");
      setClientName("");
      setDescription("");
      setPriority("MEDIUM");
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast({
        title: "Title required",
        description: "Give the new project a title.",
        variant: "destructive",
      });
      return;
    }
    if (!clientName.trim()) {
      toast({
        title: "Client required",
        description: "Enter the client this project is for.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const result = await createProjectFromProposals({
        proposalIds: proposals.map((p) => p.id),
        title: title.trim(),
        clientName: clientName.trim(),
        description: description.trim() || undefined,
        priority,
      });

      toast({
        title: "Project created",
        description: `${result.projectNumber} created with ${result.applied} task${
          result.applied === 1 ? "" : "s"
        }.`,
      });

      onSuccess(result);
      onClose();
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.response?.data?.message || "Failed to create project. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-primary" />
            Create project from {proposals.length} item
            {proposals.length === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            A new project will be created and these approved items will be added as its
            tasks.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <Label htmlFor="triage-project-title">
              Project Title <span className="text-red-500">*</span>
            </Label>
            <Input
              id="triage-project-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Q3 Website Refresh"
              autoFocus
            />
          </div>

          {/* Client Name */}
          <div>
            <Label htmlFor="triage-project-client">
              Client Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="triage-project-client"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Enter client name"
            />
          </div>

          {/* Priority */}
          <div>
            <Label htmlFor="triage-project-priority">Priority</Label>
            <Select
              value={priority}
              onValueChange={(value) => setPriority(value as TriagePriority)}
            >
              <SelectTrigger id="triage-project-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    <span className={level.color}>{level.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="triage-project-description">Description</Label>
            <Textarea
              id="triage-project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional context for the new project…"
              rows={3}
            />
          </div>

          {/* Selected items preview */}
          <div className="rounded-lg border border-border/70 bg-muted/40 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Items to add ({proposals.length})
            </div>
            <ul className="max-h-32 space-y-1 overflow-y-auto">
              {proposals.map((p) => (
                <li
                  key={p.id}
                  className="flex items-start gap-2 text-sm text-foreground"
                >
                  <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                  <span className="line-clamp-1">{p.proposedTitle || p.rawText}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create project"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
