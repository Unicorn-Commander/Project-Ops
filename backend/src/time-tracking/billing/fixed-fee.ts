import { Decimal } from '@prisma/client/runtime/library';

/**
 * Which uninvoiced flat fees belong on the next invoice.
 *
 * A task fee (fixedAmount > 0, invoicedAt null) is a line. Any task that has a
 * flat fee — already invoiced or not — keeps its time entries off the hourly
 * rollup, and suppresses the project flat fee so a quote that carries both
 * line amounts and a committed total is not billed twice. The project flat
 * fee is used only when no task on that project has a flat fee.
 */

export type FixedFeeKind = 'fixed_task' | 'fixed_project';

export interface FixedFeeTaskInput {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  fixedAmount: Decimal | string | number | null;
  invoicedAt?: Date | string | null;
}

export interface FixedFeeProjectInput {
  id: string;
  title: string;
  flatFeeAmount: Decimal | string | number | null;
  flatFeeInvoicedAt?: Date | string | null;
}

export interface FixedFeeLine {
  kind: FixedFeeKind;
  /** Stable id. Hashed into the Accounting-Ops external_ref. */
  sourceId: string;
  taskId: string | null;
  projectId: string;
  title: string;
  amount: Decimal;
  deliverables: string[];
}

export interface FixedFeeSelection {
  lines: FixedFeeLine[];
  /** Every task with a flat fee, invoiced or not. Their hours are not billed. */
  excludedTaskIds: string[];
}

function money(value: Decimal | string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  let raw: Decimal;
  try {
    raw = value instanceof Decimal ? value : new Decimal(value as Decimal.Value);
  } catch {
    return null;
  }
  if (!raw.isFinite() || raw.lte(0)) return null;
  return raw.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function deliverablesFrom(description: string | null | undefined): string[] {
  if (!description) return [];
  return description
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function selectFixedFeesForScope(
  projects: FixedFeeProjectInput[],
  tasks: FixedFeeTaskInput[],
): FixedFeeSelection {
  const byProject = new Map<string, FixedFeeTaskInput[]>();
  for (const task of tasks) {
    const list = byProject.get(task.projectId) ?? [];
    list.push(task);
    byProject.set(task.projectId, list);
  }

  const lines: FixedFeeLine[] = [];
  const excludedTaskIds: string[] = [];

  for (const project of projects) {
    const projectTasks = byProject.get(project.id) ?? [];
    const uninvoiced: FixedFeeLine[] = [];
    let projectHasTaskFee = false;

    for (const task of projectTasks) {
      const amount = money(task.fixedAmount);
      if (!amount) continue;
      projectHasTaskFee = true;
      excludedTaskIds.push(task.id);
      if (task.invoicedAt) continue;
      uninvoiced.push({
        kind: 'fixed_task',
        sourceId: `fixed-task:${task.id}`,
        taskId: task.id,
        projectId: project.id,
        title: task.title,
        amount,
        deliverables: deliverablesFrom(task.description),
      });
    }

    if (!projectHasTaskFee && !project.flatFeeInvoicedAt) {
      const amount = money(project.flatFeeAmount);
      if (amount) {
        uninvoiced.push({
          kind: 'fixed_project',
          sourceId: `fixed-project:${project.id}`,
          taskId: null,
          projectId: project.id,
          title: project.title,
          amount,
          deliverables: [],
        });
      }
    }

    lines.push(...uninvoiced);
  }

  return { lines, excludedTaskIds };
}

/** Presentation for a single flat-fee invoice. Null when the draft is mixed. */
export function buildInvoicePresentation(
  lines: FixedFeeLine[],
  hourlyCount: number,
): Record<string, unknown> | null {
  if (hourlyCount !== 0 || lines.length !== 1) return null;
  const line = lines[0];
  const presentation: Record<string, unknown> = {
    headline: line.title,
    due_label: 'on receipt',
    product_name: 'Magic Unicorn',
    product_line: 'Special Projects',
  };
  if (line.deliverables.length) presentation.deliverables = line.deliverables;
  if (JSON.stringify(presentation).length > 8000) {
    delete presentation.deliverables;
  }
  return presentation;
}
