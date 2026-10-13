import { Decimal } from '@prisma/client/runtime/library';
import { buildInvoicePresentation, selectFixedFeesForScope } from './fixed-fee';

const project = {
  id: 'p1',
  title: 'Weekend',
  flatFeeAmount: new Decimal('2500.00'),
  flatFeeInvoicedAt: null,
};

describe('selectFixedFeesForScope', () => {
  it('bills the project flat fee when no task has one', () => {
    const out = selectFixedFeesForScope(
      [project],
      [{ id: 't1', projectId: 'p1', title: 'Notes', fixedAmount: null }],
    );
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].kind).toBe('fixed_project');
    expect(out.lines[0].sourceId).toBe('fixed-project:p1');
    expect(out.lines[0].amount.toString()).toBe('2500');
    expect(out.excludedTaskIds).toEqual([]);
  });

  it('bills uninvoiced task fees and suppresses the project fee', () => {
    const out = selectFixedFeesForScope(
      [project],
      [
        {
          id: 't1',
          projectId: 'p1',
          title: 'Setup',
          description: 'Quotes\n- One page',
          fixedAmount: '1500.00',
        },
        {
          id: 't2',
          projectId: 'p1',
          title: 'Already billed',
          fixedAmount: '1000',
          invoicedAt: new Date('2026-09-01'),
        },
      ],
    );
    expect(out.lines.map((l) => l.sourceId)).toEqual(['fixed-task:t1']);
    expect(out.lines[0].deliverables).toEqual(['Quotes', 'One page']);
    expect(out.excludedTaskIds.sort()).toEqual(['t1', 't2']);
  });

  it('does not bill a project fee that was already invoiced, or a zero amount', () => {
    const out = selectFixedFeesForScope(
      [{ ...project, flatFeeInvoicedAt: new Date(), flatFeeAmount: '0' }],
      [],
    );
    expect(out.lines).toEqual([]);
  });

  it('keeps a second project’s flat fee when only the first has task fees', () => {
    const out = selectFixedFeesForScope(
      [project, { id: 'p2', title: 'Other', flatFeeAmount: '40.00', flatFeeInvoicedAt: null }],
      [{ id: 't1', projectId: 'p1', title: 'Setup', fixedAmount: 10 }],
    );
    expect(out.lines.map((l) => l.sourceId).sort()).toEqual(['fixed-project:p2', 'fixed-task:t1']);
  });
});

describe('buildInvoicePresentation', () => {
  it('describes one flat fee and stays quiet for a mixed draft', () => {
    const { lines } = selectFixedFeesForScope([project], []);
    const one = buildInvoicePresentation(lines, 0);
    expect(one).toMatchObject({
      headline: 'Weekend',
      due_label: 'on receipt',
      product_name: 'Magic Unicorn',
      product_line: 'Special Projects',
    });
    expect(buildInvoicePresentation(lines, 2)).toBeNull();
  });
});
