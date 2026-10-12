import { UserRole } from '@prisma/client';
import {
  CLIENT_MASKED_PROJECT_FIELDS,
  CLIENT_MASKED_TASK_FIELDS,
  maskTaskMetadataForClient,
  withProjectQuote,
  withTaskMetadataForRole,
} from './client-metadata';

const PROJECT_META = {
  quote: {
    customer_ops_quote_id: 'q-0001',
    number: 'Q-2026-0001',
    version: 1,
    share_url: 'https://customers.example.dev/q/tok',
    schedule_ids: ['sched-deposit'],
  },
  quoteSummary: { title: 'Order Pad', currency: 'USD', status: 'accepted' },
  customFields: { tier: 'gold' },
};

const TASK_META = {
  quote: {
    customer_ops_quote_id: 'q-0001',
    number: 'Q-2026-0001',
    version: 1,
    line_kind: 'milestone',
    position: 2,
    weeks: 3,
    customer_ops_line_id: 'line-99',
    option_group: 'hosting',
  },
  customFields: { score: 1 },
  customer_ops_quote_id: 'q-leaked-at-root',
};

describe('withProjectQuote — per-role', () => {
  it('staff: quote mirrors metadata.quote including foreign ids', () => {
    const out = withProjectQuote(
      { metadata: PROJECT_META, defaultBillRate: '150' },
      {
        role: UserRole.STAFF,
      },
    );
    expect(out.quote).toEqual(PROJECT_META.quote);
    expect(out.metadata).toEqual(PROJECT_META);
    expect(out.defaultBillRate).toBe('150');
  });

  it('CLIENT: strips customer_ops_quote_id + schedule_ids and commercial columns', () => {
    const out: any = withProjectQuote(
      {
        metadata: PROJECT_META,
        defaultBillRate: '150.0000',
        budgetAmount: '4300',
        billingNotes: 'Quote Q-2026-0001 v1',
        flatFeeAmount: '4300.00',
        flatFeeInvoicedAt: new Date('2026-09-30T12:00:00Z'),
        customerOpsCustomerId: 'cust-private',
        contactOpsContactId: 'contact-private',
      },
      { role: UserRole.CLIENT },
    );
    const masked = {
      number: 'Q-2026-0001',
      version: 1,
      share_url: 'https://customers.example.dev/q/tok',
    };
    expect(out.quote).toEqual(masked);
    expect(out.metadata.quote).toEqual(masked);
    expect(out.metadata.customFields).toEqual({ tier: 'gold' });
    for (const field of CLIENT_MASKED_PROJECT_FIELDS) {
      expect(out).not.toHaveProperty(field);
    }
    const wire = JSON.stringify(out);
    expect(wire).not.toContain('customer_ops_quote_id');
    expect(wire).not.toContain('sched-deposit');
    expect(wire).not.toContain('150.0000');
  });
});

describe('withTaskMetadataForRole — per-role', () => {
  it('staff keep quote line ids', () => {
    const out = withTaskMetadataForRole(
      { id: 't1', metadata: TASK_META },
      { role: UserRole.ADMIN },
    );
    expect(out.metadata).toEqual(TASK_META);
  });

  it('CLIENT: strips quote/internal ids from get_task-shaped metadata', () => {
    const out: any = withTaskMetadataForRole(
      {
        id: 't1',
        metadata: TASK_META,
        fixedAmount: '1500.00',
        invoicedAt: new Date('2026-09-30T12:00:00Z'),
        invoiceExternalRef: 'ao-private',
      },
      { role: UserRole.CLIENT },
    );
    expect(out.metadata.quote).toEqual({
      number: 'Q-2026-0001',
      version: 1,
      line_kind: 'milestone',
      position: 2,
      weeks: 3,
    });
    expect(out.metadata.customFields).toEqual({ score: 1 });
    for (const field of CLIENT_MASKED_TASK_FIELDS) {
      expect(out).not.toHaveProperty(field);
    }
    const wire = JSON.stringify(out);
    expect(wire).not.toContain('customer_ops_quote_id');
    expect(wire).not.toContain('customer_ops_line_id');
    expect(wire).not.toContain('line-99');
    expect(wire).not.toContain('q-leaked-at-root');
    expect(wire).not.toContain('option_group');
  });

  it('maskTaskMetadataForClient is a no-op on null / non-objects', () => {
    expect(maskTaskMetadataForClient(null)).toBeNull();
    expect(maskTaskMetadataForClient(undefined)).toBeUndefined();
    expect(maskTaskMetadataForClient('x')).toBe('x');
  });

  it('maskTaskMetadataForClient recurses: strips foreign ids at ANY depth (incl. arrays)', () => {
    const meta = {
      customFields: { score: 1 },
      nested: {
        keep: 'yes',
        customer_ops_line_id: 'line-deep',
        items: [
          { customer_ops_quote_id: 'q-deep', ok: 'keep' },
          { schedule_ids: ['sched-deep'], ok: 2 },
        ],
      },
    };
    const out: any = maskTaskMetadataForClient(meta);
    expect(out.customFields).toEqual({ score: 1 });
    expect(out.nested.keep).toBe('yes');
    expect(out.nested.customer_ops_line_id).toBeUndefined();
    expect(out.nested.items[0].customer_ops_quote_id).toBeUndefined();
    expect(out.nested.items[0].ok).toBe('keep');
    expect(out.nested.items[1].schedule_ids).toBeUndefined();
    expect(out.nested.items[1].ok).toBe(2);
    expect(JSON.stringify(out)).not.toContain('line-deep');
    expect(JSON.stringify(out)).not.toContain('q-deep');
    expect(JSON.stringify(out)).not.toContain('sched-deep');
  });

  it('withProjectQuote strips the budgetSummary list rollup for a CLIENT, keeps taskStats', () => {
    const out: any = withProjectQuote(
      {
        metadata: {},
        budgetSummary: { budgetHours: 10, budgetAmount: '4300', loggedHours: 2, pctHours: 0.2 },
        taskStats: { total: 3, completed: 1 },
      },
      { role: UserRole.CLIENT },
    );
    expect(out.budgetSummary).toBeUndefined();
    expect(out.taskStats).toEqual({ total: 3, completed: 1 });
  });

  it('withProjectQuote keeps budgetSummary for a STAFF caller', () => {
    const out: any = withProjectQuote(
      {
        metadata: {},
        budgetSummary: { budgetHours: 10, budgetAmount: '4300', loggedHours: 2, pctHours: 0.2 },
      },
      { role: UserRole.STAFF },
    );
    expect(out.budgetSummary.budgetAmount).toBe('4300');
  });
});
