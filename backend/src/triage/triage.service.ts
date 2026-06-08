/**
 * Project-Ops Triage Agent (PO-owned; registers in Brigade via the MCP manifest).
 *
 * Ingests candidate action items (from Meeting-Ops or ANY source), routes each to
 * the best-fitting project, dedups, and writes a TriageProposal for human review.
 * Items with no good project home get proposedProjectId = null -> the
 * "Unassigned / needs a project" inbox, from which a user assigns them to an
 * existing project or creates a new one (createProjectFromUnassigned).
 *
 * Inference runs ENTIRELY on local hardware, reached from the PO backend on
 * bigboy over the LAN:
 *   - embeddings + rerank: Infinity (bge-m3 / bge-reranker-v2-m3) on midboy2
 *   - reasoning: Qwen3.6-35B-A3B-Vision on midboy1
 * Thinking stays ON (it materially improves the keep/route judgment); per-item
 * calls keep the token budget bounded so the answer is never starved.
 *
 * Nothing is created in Project-Ops until a human approves a proposal.
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TaskPriority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';

export type CandidateItem = {
  text: string;
  owner?: string | null;
  sourceType?: string;
  /** stable id from the source (e.g. meeting-ops action_items.id) for idempotency */
  sourceActionItemId?: string;
  sourceRef?: Record<string, any>;
};

type ProjIndexEntry = {
  id: string;
  number: string;
  title: string;
  vec: number[];
};

@Injectable()
export class TriageService {
  private readonly logger = new Logger(TriageService.name);
  private projIndex: ProjIndexEntry[] | null = null;
  private projIndexAt = 0;
  private static readonly INDEX_TTL_MS = 10 * 60 * 1000;
  private static readonly DEDUP_THRESHOLD = 0.82; // within-batch near-dup backstop

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly tasks: TasksService,
  ) {}

  // ---------- config (env with LAN defaults) ----------
  private get embedUrl() {
    return this.config.get<string>(
      'INFINITY_EMBEDDINGS_URL',
      'http://192.168.10.14:8082',
    );
  }
  private get rerankUrl() {
    return this.config.get<string>(
      'INFINITY_RERANK_URL',
      'http://192.168.10.14:8083',
    );
  }
  private get qwenUrl() {
    return this.config.get<string>(
      'QWEN_URL',
      'http://192.168.10.68:8088/v1/chat/completions',
    );
  }
  private get qwenModel() {
    return this.config.get<string>('QWEN_MODEL', 'Qwen3.6-35B-A3B-Vision');
  }
  private get embedModel() {
    return this.config.get<string>('INFINITY_EMBED_MODEL', 'BAAI/bge-m3');
  }
  private get rerankModel() {
    return this.config.get<string>(
      'INFINITY_RERANK_MODEL',
      'BAAI/bge-reranker-v2-m3',
    );
  }

  // ---------- inference helpers ----------
  private async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.embedUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.embedModel, input: texts }),
    });
    if (!res.ok) throw new Error(`Infinity embeddings ${res.status}`);
    const data: any = await res.json();
    return (data.data ?? []).map((d: any) => d.embedding as number[]);
  }

  private async rerank(
    query: string,
    docs: string[],
    topN: number,
  ): Promise<{ index: number; score: number }[]> {
    const res = await fetch(`${this.rerankUrl}/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.rerankModel,
        query,
        documents: docs,
        top_n: topN,
      }),
    });
    if (!res.ok) throw new Error(`Infinity rerank ${res.status}`);
    const data: any = await res.json();
    return (data.results ?? []).map((r: any) => ({
      index: r.index,
      score: r.relevance_score ?? 0,
    }));
  }

  private async qwenDecide(userMsg: string): Promise<any | null> {
    const res = await fetch(this.qwenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.qwenModel,
        messages: [
          { role: 'system', content: TriageService.SYSTEM },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.1,
        max_tokens: 1800,
      }),
    });
    if (!res.ok) throw new Error(`Qwen ${res.status}`);
    const data: any = await res.json();
    const msg = data?.choices?.[0]?.message ?? {};
    // content holds the answer; reasoning_content is the (discarded) thinking trace
    const text: string = msg.content || msg.reasoning_content || '';
    return this.firstJsonObject(text);
  }

  /** Extract the first balanced {...} that has a "keep" key (tolerates prose/think text around it). */
  private firstJsonObject(s: string): any | null {
    for (let st = 0; st < s.length; st++) {
      if (s[st] !== '{') continue;
      let depth = 0;
      for (let e = st; e < s.length; e++) {
        if (s[e] === '{') depth++;
        else if (s[e] === '}') {
          depth--;
          if (depth === 0) {
            try {
              const v = JSON.parse(s.slice(st, e + 1));
              if (v && typeof v === 'object' && 'keep' in v) return v;
            } catch {
              /* keep scanning */
            }
            break;
          }
        }
      }
    }
    return null;
  }

  private cosine(a: number[], b: number[]): number {
    let s = 0,
      na = 0,
      nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      s += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return s / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  }

  // ---------- cached project embedding index ----------
  private async getProjectIndex(): Promise<ProjIndexEntry[]> {
    if (
      this.projIndex &&
      Date.now() - this.projIndexAt < TriageService.INDEX_TTL_MS
    ) {
      return this.projIndex;
    }
    const rows = await this.prisma.project.findMany({
      select: {
        id: true,
        projectNumber: true,
        title: true,
        description: true,
      },
    });
    const texts = rows.map(
      (r) =>
        `${r.projectNumber}: ${r.title}. ${(r.description ?? '')
          .replace(/\s+/g, ' ')
          .slice(0, 500)}`,
    );
    const vecs = texts.length ? await this.embed(texts) : [];
    this.projIndex = rows.map((r, i) => ({
      id: r.id,
      number: r.projectNumber,
      title: r.title,
      vec: vecs[i] ?? [],
    }));
    this.projIndexAt = Date.now();
    this.logger.log(`triage: project index built (${this.projIndex.length})`);
    return this.projIndex;
  }

  private static readonly SYSTEM = [
    'You triage ONE meeting action item into Project-Ops. You get the item, candidate projects (most-relevant first), and similar existing tasks.',
    'keep: true if it is a real trackable task; false ONLY for pure device/computer steps, in-call logistics, chit-chat, or vague non-actionable notes.',
    'project: choose the candidate project NUMBER whose SUBJECT genuinely covers this task. Use "NONE" if none is a real topical home. Do NOT force-fit a task onto a project just because they share a generic word like "meeting", "call", "contact", or "data" (a networking lunch or hotel sales call is NOT a software project -> NONE). But DO route a clear topical match.',
    'dup_of_existing: text of a similar_existing_task it clearly duplicates, else null.',
    'title: clean imperative. pri: LOW|MEDIUM|HIGH|URGENT. Owners are diarized speaker labels; never assign.',
    'Return ONLY a JSON object: {"keep":true,"project":"P-00042","dup_of_existing":null,"title":"...","pri":"HIGH"}',
  ].join('\n');

  private toPriority(p: any): TaskPriority {
    const v = String(p ?? '').toUpperCase();
    if (v === 'MED') return TaskPriority.MEDIUM;
    return (['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(v)
      ? v
      : 'MEDIUM') as TaskPriority;
  }

  /**
   * Ingest candidate action items -> create TriageProposal rows.
   * Propose-only: no tasks/projects are created here. Idempotent on
   * (sourceType, sourceActionItemId).
   */
  async ingestCandidates(items: CandidateItem[], userId: string) {
    if (!items?.length) return { created: 0, skipped: 0, proposals: [] as any[] };
    const index = await this.getProjectIndex();
    const itemVecs = await this.embed(items.map((it) => it.text));
    const created: any[] = [];
    let skipped = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.sourceActionItemId) {
        const existing = await this.prisma.triageProposal.findFirst({
          where: {
            sourceType: it.sourceType ?? 'MANUAL',
            sourceActionItemId: it.sourceActionItemId,
          },
          select: { id: true },
        });
        if (existing) {
          skipped++;
          continue;
        }
      }

      const vec = itemVecs[i] ?? [];
      const scored = index
        .map((p) => ({ p, c: this.cosine(vec, p.vec) }))
        .sort((a, b) => b.c - a.c)
        .slice(0, 8);
      let order = scored.map((s) => s.p);
      try {
        const rr = await this.rerank(
          it.text,
          scored.map((s) => `${s.p.number}: ${s.p.title}`),
          Math.min(4, scored.length),
        );
        order = rr.map((r) => scored[r.index].p);
      } catch {
        order = scored.slice(0, 4).map((s) => s.p);
      }

      const userMsg = JSON.stringify({
        action_item: it.text.slice(0, 300),
        candidate_projects: order.map((p) => `${p.number}: ${p.title}`),
        similar_existing_tasks: [] as string[], // existing-task dedup wired in a follow-up
      });

      let decision: any = null;
      try {
        decision = await this.qwenDecide(userMsg);
      } catch (e) {
        this.logger.warn(
          `triage qwen failed for item ${i}: ${(e as Error).message}`,
        );
      }

      const keep = decision ? decision.keep !== false : true;
      const projNumber: string | null =
        decision?.project && decision.project !== 'NONE'
          ? decision.project
          : null;
      const proj = projNumber
        ? index.find((p) => p.number === projNumber)
        : null;
      const top = order[0];

      const proposal = await this.prisma.triageProposal.create({
        data: {
          rawText: it.text,
          owner: it.owner ?? null,
          sourceType: it.sourceType ?? 'MANUAL',
          sourceActionItemId: it.sourceActionItemId ?? null,
          sourceRef: (it.sourceRef ?? null) as any,
          agentKeep: keep,
          proposedProjectId: proj?.id ?? null,
          proposedTitle: decision?.title ?? it.text.slice(0, 120),
          proposedPriority: this.toPriority(decision?.pri),
          dedupeNote: decision?.dup_of_existing ?? null,
          matchScore: top ? Number(this.cosine(vec, top.vec).toFixed(4)) : null,
          alternatives: order.map((p) => ({
            number: p.number,
            title: p.title,
          })) as any,
          reasoning: decision?.reason ?? null,
          status: 'PENDING_REVIEW',
          createdById: userId,
        },
      });
      created.push(proposal);
    }

    this.logger.log(
      `triage: ${created.length} proposals (${skipped} skipped) user=${userId}`,
    );
    return { created: created.length, skipped, proposals: created };
  }

  /** The "Unassigned / needs a project" inbox: kept, no project, not a dup, still pending. */
  listInbox() {
    return this.prisma.triageProposal.findMany({
      where: {
        status: 'PENDING_REVIEW',
        agentKeep: true,
        proposedProjectId: null,
        dedupeNote: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  listPending() {
    return this.prisma.triageProposal.findMany({
      where: { status: 'PENDING_REVIEW' },
      orderBy: { createdAt: 'desc' },
      include: {
        proposedProject: { select: { projectNumber: true, title: true } },
      },
    });
  }

  async approve(proposalId: string, userId: string, overrideProjectId?: string) {
    const p = await this.prisma.triageProposal.findUnique({
      where: { id: proposalId },
    });
    if (!p) throw new NotFoundException('proposal not found');
    if (p.status !== 'PENDING_REVIEW')
      throw new BadRequestException(`proposal is ${p.status}`);
    const projectId = overrideProjectId ?? p.proposedProjectId;
    if (!projectId)
      throw new BadRequestException(
        'no project resolved: assign one or use create-project-from-unassigned',
      );
    const task = await this.tasks.create(
      {
        projectId,
        title: p.proposedTitle,
        description: p.rawText,
        priority: p.proposedPriority,
      } as any,
      userId,
    );
    return this.prisma.triageProposal.update({
      where: { id: proposalId },
      data: {
        status: 'APPLIED',
        appliedAt: new Date(),
        reviewedById: userId,
        proposedProjectId: projectId,
        createdTaskId: task.id,
      },
    });
  }

  async reject(proposalId: string, userId: string, reason?: string) {
    return this.prisma.triageProposal.update({
      where: { id: proposalId },
      data: {
        status: 'REJECTED',
        reviewedById: userId,
        rejectionReason: reason ?? null,
      },
    });
  }

  /** Create a NEW project from a set of unassigned proposals, then apply them as its tasks. */
  async createProjectFromUnassigned(
    proposalIds: string[],
    projectInput: {
      title: string;
      clientName: string;
      description?: string;
      priority?: string;
    },
    userId: string,
  ) {
    const project = await this.projects.create(projectInput as any, userId);
    const applied: string[] = [];
    for (const id of proposalIds) {
      try {
        await this.approve(id, userId, project.id);
        applied.push(id);
      } catch (e) {
        this.logger.warn(
          `apply ${id} -> new project failed: ${(e as Error).message}`,
        );
      }
    }
    return {
      projectId: project.id,
      projectNumber: (project as any).projectNumber,
      applied: applied.length,
    };
  }
}
