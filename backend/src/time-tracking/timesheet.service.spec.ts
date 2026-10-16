import { TimesheetService } from './timesheet.service';

describe('TimesheetService business week grouping', () => {
  it('groups a Sunday evening New York anchor into the Monday Oct 12 week', () => {
    const service = new TimesheetService(
      {} as any,
      {} as any,
      {} as any,
      { get: (_key: string, fallback: string) => fallback } as any,
      {} as any,
    );

    const bounds = (service as any).weekBounds(new Date('2026-10-19T01:30:00.000Z'));

    expect(bounds.periodStart.toISOString()).toBe('2026-10-12T04:00:00.000Z');
    expect(bounds.periodEnd.toISOString()).toBe('2026-10-19T03:59:59.999Z');
  });
});
