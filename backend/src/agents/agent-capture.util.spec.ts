import { deriveToolTarget, resolveMcpActor } from './agent-capture.util';
import { AgentActorKind } from '@prisma/client';

const user = { id: 'u1', firstName: 'Aaron', lastName: 'S', email: 'aaron@x.io' } as any;

describe('resolveMcpActor', () => {
  it('classifies a federation actor as FEDERATED, keyed by its uchub sub', () => {
    const fed = {
      ...user,
      __isFederationActor: true,
      __federationActor: 'meeting-ops',
      __ucUid: 'sub-123',
    };
    expect(resolveMcpActor(fed)).toEqual({
      actorKind: AgentActorKind.FEDERATED,
      actorKey: 'sub-123',
      actorLabel: 'Federated agent (meeting-ops)',
    });
  });

  it('classifies a PAT call (id+name provided) as PAT keyed by the PAT id', () => {
    expect(
      resolveMcpActor(user, { id: 'pat-9', name: "Claude Code on Aaron's Mac" }, true),
    ).toEqual({
      actorKind: AgentActorKind.PAT,
      actorKey: 'pat-9',
      actorLabel: "Claude Code on Aaron's Mac",
    });
  });

  it('degrades a PAT-auth call with no id to a stable per-user PAT key', () => {
    expect(resolveMcpActor(user, null, true)).toEqual({
      actorKind: AgentActorKind.PAT,
      actorKey: 'pat:u1',
      actorLabel: 'Personal Access Token (Aaron S)',
    });
  });

  it('classifies a bare session/JWT caller as USER keyed by the user id', () => {
    expect(resolveMcpActor(user, null, false)).toEqual({
      actorKind: AgentActorKind.USER,
      actorKey: 'u1',
      actorLabel: 'Aaron S',
    });
  });
});

describe('deriveToolTarget', () => {
  it('create_task: pulls task id from result.task.id and project id from result.task.project.id', () => {
    const result = { task: { id: 't1', project: { id: 'p1' } }, projectNumber: 'PROJ-1' };
    expect(deriveToolTarget('create_task', { projectNumber: 'PROJ-1' }, result)).toEqual({
      taskId: 't1',
      projectId: 'p1',
      resource: 'task',
      resourceId: 't1',
    });
  });

  it('update_project: pulls project id from a top-level result id', () => {
    expect(
      deriveToolTarget(
        'update_project',
        { projectNumber: 'PROJ-2' },
        { id: 'p2', projectNumber: 'PROJ-2' },
      ),
    ).toEqual({
      taskId: null,
      projectId: 'p2',
      resource: 'project',
      resourceId: 'p2',
    });
  });

  it('add_task_comment: resource=comment, taskId from args, resourceId from result.comment.id', () => {
    const out = deriveToolTarget(
      'add_task_comment',
      { taskId: 't5' },
      { comment: { id: 'c9' }, workspaceId: 'ws' },
    );
    expect(out).toEqual({ taskId: 't5', projectId: null, resource: 'comment', resourceId: 'c9' });
  });

  it('update_task_comment / delete_task_comment: resource=comment from commentId', () => {
    expect(
      deriveToolTarget('update_task_comment', { commentId: 'c2' }, { id: 'c2', taskId: 't9' }),
    ).toEqual({ taskId: 't9', projectId: null, resource: 'comment', resourceId: 'c2' });
    expect(
      deriveToolTarget(
        'delete_task_comment',
        { commentId: 'c3' },
        { deleted: true, commentId: 'c3', taskId: 't1' },
      ),
    ).toEqual({ taskId: 't1', projectId: null, resource: 'comment', resourceId: 'c3' });
  });

  it('falls back to args projectId and never throws on a null/odd result', () => {
    expect(deriveToolTarget('get_project', { id: 'p3' }, null)).toMatchObject({
      resource: 'project',
    });
    expect(() => deriveToolTarget('search_projects', undefined, undefined)).not.toThrow();
  });
});
