import { CustomFieldsService } from './custom-fields.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CustomFieldEntity, CustomFieldType, Prisma } from '@prisma/client';

/**
 * Unit tests for CustomFieldsService.
 *
 * Focus is the load-bearing logic that a fake-session integration test can't
 * see: key derivation/validation, options rules, the unique-collision -> 409
 * mapping, and — the shared helper the tasks/projects modules depend on —
 * `validateValues` (every type, required, unknown-key strip, SELECT/MULTISELECT
 * option enforcement). Mirrors the saved-views/comments spec mocking style: a
 * fake `tx` whose model methods are jest.fn, with runForUser invoking the
 * callback with that tx.
 */

const user = { id: 'u1', email: 'a@x.co', keycloakId: 'kc1' } as any;

function makeService(tx: any) {
  const workspaceContext = {
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
  };
  const audit = { log: jest.fn(async () => null) };
  const svc = new CustomFieldsService({} as any, workspaceContext as any, audit as any);
  return { svc, audit };
}

const def = (over: Partial<any> = {}) => ({
  id: 'd1',
  workspaceId: 'ws1',
  entity: CustomFieldEntity.TASK,
  key: 'priority_tier',
  label: 'Priority Tier',
  type: CustomFieldType.TEXT,
  options: null,
  required: false,
  position: 0,
  createdById: 'u1',
  createdAt: new Date('2026-06-17T00:00:00Z'),
  updatedAt: new Date('2026-06-17T00:00:00Z'),
  ...over,
});

// Build a fake tx whose customFieldDefinition.findMany returns the given defs.
function txWithDefs(defs: any[]) {
  return { customFieldDefinition: { findMany: jest.fn(async () => defs) } };
}

describe('CustomFieldsService.findAllForEntity', () => {
  it('orders by position then label, filtered by entity, inside the workspace tx', async () => {
    const findMany = jest.fn(async (_args: any) => [def()]);
    const { svc } = makeService({ customFieldDefinition: { findMany } });

    await svc.findAllForEntity('ws1', user, CustomFieldEntity.TASK);

    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ entity: CustomFieldEntity.TASK });
    expect(args.orderBy).toEqual([{ position: 'asc' }, { label: 'asc' }]);
  });
});

describe('CustomFieldsService.create', () => {
  it('derives a slug key from the label when key omitted, stamps workspaceId + createdById', async () => {
    const create = jest.fn(async (a: any) => def({ ...a.data, id: 'd9' }));
    const { svc, audit } = makeService({ customFieldDefinition: { create } });

    await svc.create('ws1', user, {
      entity: CustomFieldEntity.TASK,
      label: 'Priority Tier!',
      type: CustomFieldType.TEXT,
    } as any);

    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      workspaceId: 'ws1',
      createdById: 'u1',
      entity: CustomFieldEntity.TASK,
      key: 'priority_tier',
      label: 'Priority Tier!',
      type: CustomFieldType.TEXT,
      required: false,
      position: 0,
    });
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('accepts an explicit valid key', async () => {
    const create = jest.fn(async (a: any) => def(a.data));
    const { svc } = makeService({ customFieldDefinition: { create } });

    await svc.create('ws1', user, {
      entity: CustomFieldEntity.PROJECT,
      key: 'budget_code',
      label: 'Budget Code',
      type: CustomFieldType.TEXT,
    } as any);

    expect(create.mock.calls[0][0].data.key).toBe('budget_code');
  });

  it('rejects an invalid explicit key (uppercase/spaces) with 400', async () => {
    const create = jest.fn();
    const { svc } = makeService({ customFieldDefinition: { create } });

    await expect(
      svc.create('ws1', user, {
        entity: CustomFieldEntity.TASK,
        key: 'Bad Key',
        label: 'X',
        type: CustomFieldType.TEXT,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('requires non-empty options for SELECT', async () => {
    const create = jest.fn();
    const { svc } = makeService({ customFieldDefinition: { create } });

    await expect(
      svc.create('ws1', user, {
        entity: CustomFieldEntity.TASK,
        label: 'Tier',
        type: CustomFieldType.SELECT,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('normalizes + dedupes options for SELECT and clears options for non-option types', async () => {
    const create = jest.fn(async (a: any) => def(a.data));
    const { svc } = makeService({ customFieldDefinition: { create } });

    await svc.create('ws1', user, {
      entity: CustomFieldEntity.TASK,
      label: 'Tier',
      type: CustomFieldType.SELECT,
      options: ['Low', 'Low', ' High '],
    } as any);
    expect(create.mock.calls[0][0].data.options).toEqual(['Low', 'High']);

    create.mockClear();
    await svc.create('ws1', user, {
      entity: CustomFieldEntity.TASK,
      label: 'Notes',
      type: CustomFieldType.TEXT,
      options: ['ignored'],
    } as any);
    // non-option type -> options cleared to Prisma DbNull
    expect(create.mock.calls[0][0].data.options).toBe(Prisma.DbNull);
  });

  it('maps a unique(workspaceId, entity, key) collision (P2002) to 409', async () => {
    const create = jest.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      });
    });
    const { svc } = makeService({ customFieldDefinition: { create } });

    await expect(
      svc.create('ws1', user, {
        entity: CustomFieldEntity.TASK,
        key: 'priority_tier',
        label: 'Priority Tier',
        type: CustomFieldType.TEXT,
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CustomFieldsService.update', () => {
  it('updates only provided fields; key/entity not in DTO so never written', async () => {
    const findUnique = jest.fn(async () => def());
    const update = jest.fn(async (a: any) => def(a.data));
    const { svc } = makeService({ customFieldDefinition: { findUnique, update } });

    await svc.update('ws1', user, 'd1', { label: 'Renamed', position: 3 } as any);

    const data = update.mock.calls[0][0].data;
    expect(data).toMatchObject({ label: 'Renamed', position: 3 });
    expect(data.key).toBeUndefined();
    expect(data.entity).toBeUndefined();
    // type/options untouched when neither provided
    expect(data.type).toBeUndefined();
    expect(data.options).toBeUndefined();
  });

  it('re-derives options when switching type to SELECT (and requires them)', async () => {
    const findUnique = jest.fn(async () => def({ type: CustomFieldType.TEXT, options: null }));
    const update = jest.fn();
    const { svc } = makeService({ customFieldDefinition: { findUnique, update } });

    await expect(
      svc.update('ws1', user, 'd1', { type: CustomFieldType.SELECT } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('clears options when switching away from SELECT to TEXT', async () => {
    const findUnique = jest.fn(async () =>
      def({ type: CustomFieldType.SELECT, options: ['A', 'B'] }),
    );
    const update = jest.fn(async (a: any) => def(a.data));
    const { svc } = makeService({ customFieldDefinition: { findUnique, update } });

    await svc.update('ws1', user, 'd1', { type: CustomFieldType.TEXT } as any);

    expect(update.mock.calls[0][0].data.options).toBe(Prisma.DbNull);
  });

  it('404s when the definition does not exist (or is outside the workspace)', async () => {
    const findUnique = jest.fn(async () => null);
    const update = jest.fn();
    const { svc } = makeService({ customFieldDefinition: { findUnique, update } });

    await expect(svc.update('ws1', user, 'missing', { label: 'X' } as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('CustomFieldsService.remove', () => {
  it('deletes when the definition exists in the workspace', async () => {
    const findUnique = jest.fn(async () => def());
    const del = jest.fn(async () => def());
    const { svc, audit } = makeService({
      customFieldDefinition: { findUnique, delete: del },
    });

    await svc.remove('ws1', user, 'd1');

    expect(del).toHaveBeenCalledWith({ where: { id: 'd1' } });
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('404s when the definition is absent', async () => {
    const findUnique = jest.fn(async () => null);
    const del = jest.fn();
    const { svc } = makeService({ customFieldDefinition: { findUnique, delete: del } });

    await expect(svc.remove('ws1', user, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(del).not.toHaveBeenCalled();
  });
});

describe('CustomFieldsService.validateValues', () => {
  it('coerces each type and returns the normalized object', async () => {
    const tx = txWithDefs([
      def({ key: 'name', type: CustomFieldType.TEXT }),
      def({ key: 'count', type: CustomFieldType.NUMBER }),
      def({ key: 'due', type: CustomFieldType.DATE }),
      def({ key: 'done', type: CustomFieldType.BOOLEAN }),
      def({ key: 'tier', type: CustomFieldType.SELECT, options: ['Low', 'High'] }),
      def({ key: 'tags', type: CustomFieldType.MULTISELECT, options: ['a', 'b', 'c'] }),
    ]);
    const { svc } = makeService(tx);

    const out = await svc.validateValues(tx as any, 'ws1', CustomFieldEntity.TASK, {
      name: 'hello',
      count: '42', // numeric string -> number
      due: '2026-06-17',
      done: 'true', // string -> bool
      tier: 'High',
      tags: ['a', 'a', 'c'], // dedupe -> subset
    });

    expect(out.name).toBe('hello');
    expect(out.count).toBe(42);
    expect(out.due).toBe(new Date('2026-06-17').toISOString());
    expect(out.done).toBe(true);
    expect(out.tier).toBe('High');
    expect(out.tags).toEqual(['a', 'c']);
  });

  it('strips unknown keys (no matching definition)', async () => {
    const tx = txWithDefs([def({ key: 'name', type: CustomFieldType.TEXT })]);
    const { svc } = makeService(tx);

    const out = await svc.validateValues(tx as any, 'ws1', CustomFieldEntity.TASK, {
      name: 'keep',
      bogus: 'drop',
    });

    expect(out).toEqual({ name: 'keep' });
    expect(out).not.toHaveProperty('bogus');
  });

  it('throws 400 when a required field is missing or empty', async () => {
    const tx = txWithDefs([
      def({ key: 'name', type: CustomFieldType.TEXT, required: true, label: 'Name' }),
    ]);
    const { svc } = makeService(tx);

    await expect(
      svc.validateValues(tx as any, 'ws1', CustomFieldEntity.TASK, {}),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      svc.validateValues(tx as any, 'ws1', CustomFieldEntity.TASK, { name: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('omits cleared/absent optional fields from the result', async () => {
    const tx = txWithDefs([
      def({ key: 'name', type: CustomFieldType.TEXT, required: false }),
      def({ key: 'count', type: CustomFieldType.NUMBER, required: false }),
    ]);
    const { svc } = makeService(tx);

    const out = await svc.validateValues(tx as any, 'ws1', CustomFieldEntity.TASK, {
      name: '',
      count: null,
    });

    expect(out).toEqual({});
  });

  it('treats false and 0 as present (not empty)', async () => {
    const tx = txWithDefs([
      def({ key: 'done', type: CustomFieldType.BOOLEAN, required: true }),
      def({ key: 'count', type: CustomFieldType.NUMBER, required: true }),
    ]);
    const { svc } = makeService(tx);

    const out = await svc.validateValues(tx as any, 'ws1', CustomFieldEntity.TASK, {
      done: false,
      count: 0,
    });

    expect(out).toEqual({ done: false, count: 0 });
  });

  it('enforces SELECT membership (value not in options -> 400)', async () => {
    const tx = txWithDefs([
      def({ key: 'tier', type: CustomFieldType.SELECT, options: ['Low', 'High'] }),
    ]);
    const { svc } = makeService(tx);

    await expect(
      svc.validateValues(tx as any, 'ws1', CustomFieldEntity.TASK, { tier: 'Medium' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces MULTISELECT subset (a value outside options -> 400)', async () => {
    const tx = txWithDefs([
      def({ key: 'tags', type: CustomFieldType.MULTISELECT, options: ['a', 'b'] }),
    ]);
    const { svc } = makeService(tx);

    await expect(
      svc.validateValues(tx as any, 'ws1', CustomFieldEntity.TASK, { tags: ['a', 'z'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-numeric NUMBER and an invalid DATE', async () => {
    const txNum = txWithDefs([def({ key: 'count', type: CustomFieldType.NUMBER })]);
    const { svc: svcNum } = makeService(txNum);
    await expect(
      svcNum.validateValues(txNum as any, 'ws1', CustomFieldEntity.TASK, { count: 'abc' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const txDate = txWithDefs([def({ key: 'due', type: CustomFieldType.DATE })]);
    const { svc: svcDate } = makeService(txDate);
    await expect(
      svcDate.validateValues(txDate as any, 'ws1', CustomFieldEntity.TASK, { due: 'not-a-date' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('handles null/undefined incoming as an empty map', async () => {
    const tx = txWithDefs([def({ key: 'name', type: CustomFieldType.TEXT, required: false })]);
    const { svc } = makeService(tx);

    await expect(
      svc.validateValues(tx as any, 'ws1', CustomFieldEntity.TASK, null),
    ).resolves.toEqual({});
  });
});
