import { QuotePanelService } from './quote-panel.service';
import { QUOTE_TAX_NOTE } from './quote-summary';

/**
 * The panel builder: linked/not, live vs cached (degrade-clean), the CLIENT
 * mask on BOTH paths, and the A15 rule that the read-through always carries the
 * Project-Ops project id.
 */
const META = {
  quote: {
    customer_ops_quote_id: 'q-0001',
    number: 'Q-2026-0001',
    version: 1,
    share_url: 'https://customers.example.dev/q/tok_synthetic',
    schedule_ids: ['sched-deposit'],
  },
  quoteSummary: {
    title: 'Order Pad for the apparel client',
    currency: 'USD',
    status: 'accepted',
    totals: { one_time_total_cents: 140000, milestone_total_cents: 290000, recurring_monthly_cents: 35000 },
  },
  customFields: { tier: 'gold' },
};

const LIVE = {
  customer_ops_quote_id: 'q-0001',
  number: 'Q-2026-0001',
  version: 1,
  title: 'Order Pad for the apparel client (live)',
  status: 'accepted',
  totals: {
    currency: 'USD',
    one_time_total_cents: 140000,
    milestone_total_cents: 290000,
    recurring_monthly_cents: 35000,
    one_time_plus_milestones_cents: 430000,
    hourly_rate_cents: 15000,
    deposit_cents: 215000,
  },
  share_url: 'https://customers.example.dev/q/tok_synthetic',
  accepted_at: '2026-09-12T18:04:00Z',
  federated: { project_ops_project_id: 'p1' },
};

function make(port: { configured: boolean; result: any }) {
  const customerOps = {
    isConfigured: jest.fn(() => port.configured),
    getQuoteSummary: jest.fn(async () => port.result),
  };
  return { svc: new QuotePanelService(customerOps as any), customerOps };
}

describe('QuotePanelService.buildPanel', () => {
  it('is not linked when the project did not come from a quote (and never calls Customer-Ops)', async () => {
    const { svc, customerOps } = make({ configured: true, result: { ok: true, summary: LIVE } });
    expect(await svc.buildPanel({ id: 'p1', metadata: { customFields: {} } }, 'staff', { workspaceId: 'ws-1' })).toEqual({ linked: false });
    expect(customerOps.getQuoteSummary).not.toHaveBeenCalled();
  });

  it('always reads through WITH the Project-Ops project id (A15), never a bare quote id', async () => {
    const { svc, customerOps } = make({ configured: true, result: { ok: true, summary: LIVE } });
    await svc.buildPanel({ id: 'p1', metadata: META }, 'staff', { workspaceId: 'ws-1' });
    expect(customerOps.getQuoteSummary).toHaveBeenCalledWith({
      quoteId: 'q-0001',
      projectOpsProjectId: 'p1',
      workspaceId: 'ws-1',
    });
  });

  it('staff: live summary, source customer-ops, schedule ids, tax note', async () => {
    const { svc } = make({ configured: true, result: { ok: true, summary: LIVE } });
    const panel = await svc.buildPanel({ id: 'p1', metadata: META }, 'staff', { workspaceId: 'ws-1' });
    expect(panel).toEqual({
      linked: true,
      source: 'customer-ops',
      configured: true,
      degraded: null,
      tax_note: QUOTE_TAX_NOTE,
      quote: LIVE,
      schedule_ids: ['sched-deposit'],
    });
    expect(QUOTE_TAX_NOTE).toMatch(/Amounts exclude tax/);
  });

  it('staff, unconfigured: degrades clean to the cached summary with a "connect Customer-Ops" note naming the env vars', async () => {
    const { svc } = make({
      configured: false,
      result: { ok: false, reason: 'UNCONFIGURED', message: 'Connect Customer-Ops: set CUSTOMER_OPS_BASE_URL and CUSTOMER_OPS_SERVICE_TOKEN to read live quote status.' },
    });
    const panel = await svc.buildPanel({ id: 'p1', metadata: META }, 'staff', { workspaceId: 'ws-1' });
    expect(panel.linked).toBe(true);
    expect(panel.source).toBe('cached');
    expect(panel.configured).toBe(false);
    expect(panel.degraded).toEqual({ reason: 'UNCONFIGURED', message: expect.stringContaining('CUSTOMER_OPS_BASE_URL') });
    expect(panel.quote).toMatchObject({
      number: 'Q-2026-0001',
      version: 1,
      title: 'Order Pad for the apparel client',
      status: 'accepted',
      share_url: 'https://customers.example.dev/q/tok_synthetic',
      totals: { one_time_plus_milestones_cents: 430000, currency: 'USD' },
    });
  });

  it('staff, configured but unreachable: cached summary + the failure reason', async () => {
    const { svc } = make({ configured: true, result: { ok: false, reason: 'UNREACHABLE', message: 'Customer-Ops is unreachable right now.' } });
    const panel = await svc.buildPanel({ id: 'p1', metadata: META }, 'staff', { workspaceId: 'ws-1' });
    expect(panel.source).toBe('cached');
    expect(panel.degraded).toEqual({ reason: 'UNREACHABLE', message: 'Customer-Ops is unreachable right now.' });
  });

  it('client: the live summary is masked to number/title/totals/status/share link; no schedule ids, no configured flag', async () => {
    const { svc } = make({ configured: true, result: { ok: true, summary: { ...LIVE, internal_notes_md: 'never', accepted_by: { email: 'x@y' } } } });
    const panel = await svc.buildPanel({ id: 'p1', metadata: META }, 'client', { workspaceId: 'ws-1' });
    expect(panel).toEqual({
      linked: true,
      source: 'customer-ops',
      degraded: null,
      tax_note: QUOTE_TAX_NOTE,
      quote: {
        number: 'Q-2026-0001',
        version: 1,
        title: 'Order Pad for the apparel client (live)',
        status: 'accepted',
        totals: {
          currency: 'USD',
          one_time_total_cents: 140000,
          milestone_total_cents: 290000,
          recurring_monthly_cents: 35000,
          one_time_plus_milestones_cents: 430000,
        },
        share_url: 'https://customers.example.dev/q/tok_synthetic',
      },
    });
    const json = JSON.stringify(panel);
    for (const needle of ['hourly', 'deposit', 'accepted_by', 'internal', 'federated', 'schedule', 'customer_ops_quote_id', 'x@y']) {
      expect(json).not.toContain(needle);
    }
  });

  it('client, degraded: masked cached summary and a generic message that never names env vars', async () => {
    const { svc } = make({
      configured: false,
      result: { ok: false, reason: 'UNCONFIGURED', message: 'Connect Customer-Ops: set CUSTOMER_OPS_BASE_URL …' },
    });
    const panel = await svc.buildPanel({ id: 'p1', metadata: META }, 'client', { workspaceId: 'ws-1' });
    expect(panel.source).toBe('cached');
    expect(panel.degraded!.message).not.toMatch(/CUSTOMER_OPS|env/);
    expect(Object.keys(panel.quote as object).sort()).toEqual(['number', 'share_url', 'status', 'title', 'totals', 'version']);
    expect((panel as any).schedule_ids).toBeUndefined();
    expect((panel as any).configured).toBeUndefined();
  });
});
