import { UserRole } from '@prisma/client';
import { withTaskMetadataForRole } from './client-metadata';

describe('CLIENT task metadata nested quote values', () => {
  it('removes foreign IDs even inside an allowlisted quote field without mutating staff data', () => {
    const task = { metadata: { quote: {
      number: 'Q-1',
      weeks: [{ schedule_ids: ['private-schedule'], label: 'week one' }],
      position: { customer_ops_line_id: 'private-line', rank: 1 },
    } } };
    const client = withTaskMetadataForRole(task, { role: UserRole.CLIENT });
    expect(JSON.stringify(client)).not.toContain('private-schedule');
    expect(JSON.stringify(client)).not.toContain('private-line');
    expect(client.metadata.quote.number).toBe('Q-1');
    expect(client.metadata.quote.weeks).toEqual([{ label: 'week one' }]);
    expect(withTaskMetadataForRole(task, { role: UserRole.STAFF })).toBe(task);
    expect(task.metadata.quote.position.customer_ops_line_id).toBe('private-line');
  });
});
