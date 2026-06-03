import { Decimal } from '@prisma/client/runtime/library';
import { BillableDraftAssembler, BillableSource } from './billable-draft.assembler';
import { BillableGroupBy } from '../dto/create-billable-draft.dto';

function src(over: Partial<BillableSource>): BillableSource {
  return {
    id: 'e1',
    date: new Date('2026-06-01T10:00:00Z'),
    description: 'work',
    quantityHours: new Decimal(1),
    unitRate: new Decimal(100),
    amount: new Decimal(100),
    currency: 'USD',
    taskId: 't1',
    taskTitle: 'Build feature',
    role: 'STAFF',
    userId: 'u1',
    ...over,
  };
}

describe('BillableDraftAssembler', () => {
  const a = new BillableDraftAssembler();

  it('merges same-task, same-rate entries into one line and sums qty + amount', () => {
    const draft = a.assemble(
      [
        src({ id: 'e1', quantityHours: new Decimal(2), amount: new Decimal(200) }),
        src({ id: 'e2', quantityHours: new Decimal(1.5), amount: new Decimal(150) }),
      ],
      BillableGroupBy.TASK,
    );
    expect(draft.lineItems).toHaveLength(1);
    expect(draft.lineItems[0].quantity).toBe('3.5');
    expect(draft.lineItems[0].amount).toBe('350');
    expect(draft.lineItems[0].sourceRefs).toEqual(['e1', 'e2']);
    expect(draft.total).toBe('350');
    expect(draft.entryCount).toBe(2);
  });

  it('splits one task into separate lines when rates differ', () => {
    const draft = a.assemble(
      [
        src({ id: 'e1', unitRate: new Decimal(100), amount: new Decimal(100) }),
        src({ id: 'e2', unitRate: new Decimal(150), amount: new Decimal(150) }),
      ],
      BillableGroupBy.TASK,
    );
    expect(draft.lineItems).toHaveLength(2);
    expect(draft.total).toBe('250');
  });

  it('NONE grouping emits one line per source', () => {
    const draft = a.assemble(
      [src({ id: 'e1' }), src({ id: 'e2' }), src({ id: 'e3' })],
      BillableGroupBy.NONE,
    );
    expect(draft.lineItems).toHaveLength(3);
  });

  it('refuses to mix currencies in one invoice', () => {
    expect(() =>
      a.assemble([src({ id: 'e1', currency: 'USD' }), src({ id: 'e2', currency: 'EUR' })]),
    ).toThrow(/multiple currencies/i);
  });

  it('throws on an empty source set', () => {
    expect(() => a.assemble([])).toThrow(/no billable/i);
  });
});
