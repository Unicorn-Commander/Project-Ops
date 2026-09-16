import { SavedViewsService } from './saved-views.service';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { MAX_SAVED_VIEW_CONFIG_BYTES } from './saved-views.constants';

/**
 * Unit tests for SavedViewsService.
 *
 * Cover the load-bearing behaviors that aren't visible to a fake-session
 * integration test: the visibility filter (own + shared), config validation
 * (object + size cap), and owner-only mutation guards (403 / 404). Mirrors the
 * comments.service.spec mocking style: a fake `tx` whose model methods are
 * jest.fn, with runForUser invoking the callback with that tx.
 */

const user = { id: 'u1', email: 'a@x.co', keycloakId: 'kc1' } as any;

function makeService(tx: any) {
  const workspaceContext = {
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
  };
  const audit = { log: jest.fn(async () => null) };
  const svc = new SavedViewsService(
    {} as any, // prisma (unused; all access via tx)
    workspaceContext as any,
    audit as any,
  );
  return { svc, audit };
}

const rawView = (over: Partial<any> = {}) => ({
  id: 'v1',
  workspaceId: 'ws1',
  userId: 'u1',
  scope: 'projects',
  name: 'Mine',
  config: { filters: {} },
  shared: false,
  createdAt: new Date('2026-06-17T00:00:00Z'),
  updatedAt: new Date('2026-06-17T00:00:00Z'),
  ...over,
});

describe('SavedViewsService.findAllForScope', () => {
  it('filters by scope and (own OR shared) inside the workspace tx', async () => {
    const findMany = jest.fn(async (_args: any) => [rawView()]);
    const { svc } = makeService({ savedView: { findMany } });

    await svc.findAllForScope('ws1', user, 'projects');

    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      scope: 'projects',
      OR: [{ userId: 'u1' }, { shared: true }],
    });
  });
});

describe('SavedViewsService.create', () => {
  it('stamps workspaceId + userId and the validated config', async () => {
    const create = jest.fn(async (a: any) => rawView({ ...a.data, id: 'v9' }));
    const { svc, audit } = makeService({ savedView: { create } });

    await svc.create('ws1', user, {
      scope: 'projects',
      name: 'New',
      config: { columns: ['title'] },
      shared: true,
    } as any);

    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      workspaceId: 'ws1',
      userId: 'u1',
      scope: 'projects',
      name: 'New',
      config: { columns: ['title'] },
      shared: true,
    });
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('defaults shared to false when omitted', async () => {
    const create = jest.fn(async (a: any) => rawView(a.data));
    const { svc } = makeService({ savedView: { create } });

    await svc.create('ws1', user, {
      scope: 'projects',
      name: 'New',
      config: {},
    } as any);

    expect(create.mock.calls[0][0].data.shared).toBe(false);
  });

  it('rejects a non-object config (array) with 400', async () => {
    const create = jest.fn();
    const { svc } = makeService({ savedView: { create } });

    await expect(
      svc.create('ws1', user, {
        scope: 'projects',
        name: 'Bad',
        config: [1, 2, 3] as any,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an oversized config with 400', async () => {
    const create = jest.fn();
    const { svc } = makeService({ savedView: { create } });

    const huge = { blob: 'x'.repeat(MAX_SAVED_VIEW_CONFIG_BYTES + 10) };
    await expect(
      svc.create('ws1', user, {
        scope: 'projects',
        name: 'Big',
        config: huge,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('SavedViewsService.update', () => {
  it('updates only the provided fields when the caller owns the view', async () => {
    const findUnique = jest.fn(async () => rawView());
    const update = jest.fn(async (a: any) => rawView(a.data));
    const { svc } = makeService({ savedView: { findUnique, update } });

    await svc.update('ws1', user, 'v1', { name: 'Renamed' } as any);

    expect(update.mock.calls[0][0]).toMatchObject({
      where: { id: 'v1' },
      data: { name: 'Renamed' },
    });
    // config / shared untouched
    expect(update.mock.calls[0][0].data.config).toBeUndefined();
    expect(update.mock.calls[0][0].data.shared).toBeUndefined();
  });

  it('403s when the caller is not the owner', async () => {
    const findUnique = jest.fn(async () => rawView({ userId: 'someone-else' }));
    const update = jest.fn();
    const { svc } = makeService({ savedView: { findUnique, update } });

    await expect(svc.update('ws1', user, 'v1', { name: 'X' } as any)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('404s when the view does not exist (or is outside the workspace)', async () => {
    const findUnique = jest.fn(async () => null);
    const update = jest.fn();
    const { svc } = makeService({ savedView: { findUnique, update } });

    await expect(svc.update('ws1', user, 'missing', { name: 'X' } as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('validates config on update too', async () => {
    const findUnique = jest.fn(async () => rawView());
    const update = jest.fn();
    const { svc } = makeService({ savedView: { findUnique, update } });

    await expect(
      svc.update('ws1', user, 'v1', { config: [1] as any } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('SavedViewsService.remove', () => {
  it('deletes when the caller owns the view', async () => {
    const findUnique = jest.fn(async () => rawView());
    const del = jest.fn(async () => rawView());
    const { svc, audit } = makeService({
      savedView: { findUnique, delete: del },
    });

    await svc.remove('ws1', user, 'v1');

    expect(del).toHaveBeenCalledWith({ where: { id: 'v1' } });
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('403s when the caller is not the owner', async () => {
    const findUnique = jest.fn(async () => rawView({ userId: 'other' }));
    const del = jest.fn();
    const { svc } = makeService({ savedView: { findUnique, delete: del } });

    await expect(svc.remove('ws1', user, 'v1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(del).not.toHaveBeenCalled();
  });
});
