"use client";

import { Building2, Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/workspace-provider";

/**
 * Header control for switching the active workspace (tenant). Reads from
 * WorkspaceProvider; persists the selection (which updates the `X-Workspace-Id`
 * header sent on every API request). Renders nothing until there is more than
 * one workspace to choose from — a single-tenant user gets no chooser noise.
 */
export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspace, switchWorkspace } = useWorkspace();

  if (workspaces.length < 2) {
    return null;
  }

  const label = activeWorkspace?.displayName ?? "Select workspace";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex max-w-[12rem] items-center gap-2 px-2"
          aria-label="Switch workspace"
        >
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{label}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((ws) => {
          const isActive = ws.workspaceId === activeWorkspace?.workspaceId;
          return (
            <DropdownMenuItem
              key={ws.workspaceId}
              onSelect={() => switchWorkspace(ws.workspaceId)}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{ws.displayName}</span>
                <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                  {ws.role}
                </span>
              </span>
              {isActive && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
