import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { QuoteAcceptedDto } from './quote-accepted.dto';

/**
 * The wire contract at the boundary (QUOTES-CONTRACT-v1 §3 + Amendment 01).
 *
 * These run the payload through the SAME ValidationPipe options main.ts
 * installs globally (whitelist + forbidNonWhitelisted + transform), so what
 * passes here is exactly what Customer-Ops may send — and what is rejected
 * here can never reach the adapter. Fixtures are synthetic; the customer is
 * "the apparel client".
 */
describe('QuoteAcceptedDto — the quote.accepted wire contract', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const meta: ArgumentMetadata = { type: 'body', metatype: QuoteAcceptedDto, data: '' };

  const base = () => ({
    customer_ops_quote_id: 'q-0001',
    number: 'Q-2026-0001',
    version: 1,
    title: 'Order Pad for the apparel client',
    share_url: 'https://customers.example.dev/q/tok_synthetic',
    client_name: 'The apparel client',
    contact_id: 'contact-1',
    currency: 'USD',
    billing: {
      one_time_total_cents: 140000,
      milestone_total_cents: 290000,
      deposit_cents: 215000,
      recurring: [
        { interval: 'month', amount_cents: 35000, label: 'Managed hosting' },
        { interval: 'year', amount_cents: 12000, label: 'AI allowance' },
      ],
      hourly_rate_cents: 15000,
      schedule_text: '50% on acceptance, 50% per milestone; hosting monthly in advance.',
    },
    lines: [
      {
        kind: 'one_time',
        label: 'Discovery + setup',
        acceptance_criteria_md: 'Setup criteria',
        estimated_hours: 8,
        position: 1,
      },
      {
        kind: 'milestone',
        label: 'Milestone 1 — pilot',
        acceptance_criteria_md: 'M1 criteria',
        weeks: 2,
        position: 2,
      },
    ],
    pdf: {
      url: 'https://customers.example.dev/api/quotes/q-0001/versions/1/pdf',
      file_name: 'Q-2026-0001-v1.pdf',
    },
    schedule_ids: ['sched-hosting'],
  });

  const run = (body: unknown) => pipe.transform(body, meta);

  it('accepts the contract payload: billing.recurring[] + deposit_cents', async () => {
    const dto = (await run(base())) as QuoteAcceptedDto;
    expect(dto.billing.deposit_cents).toBe(215000);
    expect(dto.billing.recurring).toEqual([
      { interval: 'month', amount_cents: 35000, label: 'Managed hosting' },
      { interval: 'year', amount_cents: 12000, label: 'AI allowance' },
    ]);
    expect(dto.lines).toHaveLength(2);
    expect(dto.schedule_ids).toEqual(['sched-hosting']);
  });

  it('accepts a sender that has only the pre-blended monthly figure', async () => {
    const body: any = base();
    delete body.billing.recurring;
    delete body.billing.deposit_cents;
    body.billing.recurring_monthly_cents = 36000;
    const dto = (await run(body)) as QuoteAcceptedDto;
    expect(dto.billing.recurring).toBeUndefined();
    expect(dto.billing.recurring_monthly_cents).toBe(36000);
  });

  it('accepts a quote with no recurring commitment at all', async () => {
    const body: any = base();
    delete body.billing.recurring;
    await expect(run(body)).resolves.toBeDefined();
  });

  it('rejects an interval outside month | quarter | year', async () => {
    const body: any = base();
    body.billing.recurring = [{ interval: 'week', amount_cents: 1000 }];
    await expect(run(body)).rejects.toThrow();
  });

  it('rejects a negative or fractional recurring amount (integer cents only)', async () => {
    for (const amount of [-1, 350.5]) {
      const body: any = base();
      body.billing.recurring = [{ interval: 'month', amount_cents: amount }];
      await expect(run(body)).rejects.toThrow();
    }
  });

  it.each([
    ['internal_notes_md', { internal_notes_md: 'margin is thin on M2' }],
    ['split_rule', { split_rule: { kind: 'percent_net', percent: 50 } }],
    ['costs', { costs: [{ label: 'hosting', amount_cents: 35000 }] }],
    ['accepted_by', { accepted_by: { name: 'A. Person', email: 'a@example.test' } }],
  ])(
    'rejects the payload when %s rides along (§2.6, A3 — it can never reach Project-Ops)',
    async (_name, extra) => {
      await expect(run({ ...base(), ...extra })).rejects.toThrow();
    },
  );

  it('rejects an unknown key inside the billing block too', async () => {
    const body: any = base();
    body.billing.direct_costs_total_cents = 90000;
    await expect(run(body)).rejects.toThrow();
  });

  it('accepts the A20/A5 money fields on a line so ONE projection serves both seams (M4)', async () => {
    const body: any = base();
    body.lines[1].amount_cents = 200000;
    body.lines[1].payment_split = [50, 50];
    body.lines[1].payment_parts = [100000, 100000];
    const dto = (await run(body)) as any;
    expect(dto.lines[1].amount_cents).toBe(200000);
    expect(dto.lines[1].payment_split).toEqual([50, 50]);
    expect(dto.lines[1].payment_parts).toEqual([100000, 100000]);
  });

  it('takes A20 exact remainder parts as given and never re-rounds them', async () => {
    // The amendment's own example: a $3.33 line on [50,50] is 167 + 166.
    const body: any = base();
    body.lines[1].amount_cents = 333;
    body.lines[1].payment_split = [50, 50];
    body.lines[1].payment_parts = [167, 166];
    const dto = (await run(body)) as any;
    expect(dto.lines[1].payment_parts).toEqual([167, 166]);
  });

  it('still refuses a payment_split that does not sum to 100 (A20)', async () => {
    for (const split of [[50, 40], [60, 60], [50.5, 49.5], []]) {
      const body: any = base();
      body.lines[1].payment_split = split;
      await expect(run(body)).rejects.toThrow();
    }
  });

  it('pdf requires exactly one of url | base64 (L8)', async () => {
    const both: any = base();
    both.pdf = {
      url: 'https://customers.example.dev/q.pdf',
      base64: 'JVBERi0=',
      file_name: 'q.pdf',
    };
    await expect(run(both)).rejects.toThrow();

    const neither: any = base();
    neither.pdf = { file_name: 'q.pdf' };
    await expect(run(neither)).rejects.toThrow();

    const onlyUrl: any = base();
    onlyUrl.pdf = { url: 'https://customers.example.dev/q.pdf', file_name: 'q.pdf' };
    await expect(run(onlyUrl)).resolves.toBeDefined();

    const onlyB64: any = base();
    onlyB64.pdf = { base64: 'JVBERi0=', file_name: 'q.pdf' };
    await expect(run(onlyB64)).resolves.toBeDefined();
  });

  it('requires the fields the adapter cannot work without', async () => {
    for (const key of [
      'customer_ops_quote_id',
      'number',
      'version',
      'title',
      'share_url',
      'client_name',
      'currency',
      'billing',
      'lines',
    ]) {
      const body: any = base();
      delete body[key];
      await expect(run(body)).rejects.toThrow();
    }
  });
});
