import { buildExternalRef } from './external-ref.util';

describe('buildExternalRef (idempotency key)', () => {
  const ws = 'ws-1';

  it('is deterministic and order-independent for the same set of source ids', () => {
    const a = buildExternalRef(ws, { projectId: 'p1' }, ['e3', 'e1', 'e2']);
    const b = buildExternalRef(ws, { projectId: 'p1' }, ['e1', 'e2', 'e3']);
    expect(a).toBe(b);
  });

  it('changes when the billable set changes (new work → new invoice)', () => {
    const a = buildExternalRef(ws, { projectId: 'p1' }, ['e1', 'e2']);
    const b = buildExternalRef(ws, { projectId: 'p1' }, ['e1', 'e2', 'e3']);
    expect(a).not.toBe(b);
  });

  it('namespaces by workspace and scope', () => {
    const project = buildExternalRef(ws, { projectId: 'p1' }, ['e1']);
    const client = buildExternalRef(ws, { clientId: 'c1' }, ['e1']);
    const otherWs = buildExternalRef('ws-2', { projectId: 'p1' }, ['e1']);
    expect(project).toMatch(/^po:ws-1:p-p1:/);
    expect(client).toMatch(/^po:ws-1:c-c1:/);
    expect(project).not.toBe(client);
    expect(project).not.toBe(otherWs);
  });
});
