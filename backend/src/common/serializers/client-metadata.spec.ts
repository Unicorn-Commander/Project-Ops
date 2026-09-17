import { UserRole } from '@prisma/client';
import {
  CLIENT_MASKED_PROJECT_FIELDS,
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
      { id: 't1', metadata: TASK_META },
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
});
