import { resolveClientIp, PrincipalThrottlerGuard } from './principal-throttler.guard';

describe('PrincipalThrottlerGuard', () => {
  const tracker = (request: Record<string, any>) =>
    (PrincipalThrottlerGuard.prototype as any).getTracker(request) as Promise<string>;

  afterEach(() => {
    delete process.env.TRUSTED_PROXY_CIDRS;
  });

  it('gives two authenticated users behind one proxy independent buckets', async () => {
    await expect(tracker({ user: { id: 'user-a' } })).resolves.toBe('user:user-a');
    await expect(tracker({ user: { id: 'user-b' } })).resolves.toBe('user:user-b');
  });

  it('keeps a PAT distinct from its JWT user bucket', async () => {
    await expect(tracker({ user: { id: 'user-a' }, pat: { id: 'pat-a' } })).resolves.toBe(
      'pat:pat-a',
    );
    await expect(tracker({ user: { id: 'user-a' } })).resolves.toBe('user:user-a');
  });

  it('uses CF-Connecting-IP for an unauthenticated request through a trusted proxy', async () => {
    await expect(
      tracker({
        socket: { remoteAddress: '172.18.0.2' },
        headers: { 'cf-connecting-ip': '198.51.100.23' },
      }),
    ).resolves.toBe('ip:198.51.100.23');
  });

  it('ignores spoofed forwarding headers from a non-proxy peer', () => {
    expect(
      resolveClientIp({
        socket: { remoteAddress: '198.51.100.7' },
        headers: {
          'cf-connecting-ip': '203.0.113.9',
          'x-forwarded-for': '203.0.113.10',
        },
        ip: '198.51.100.7',
      }),
    ).toBe('198.51.100.7');
  });

  it('uses the first X-Forwarded-For address when the peer is trusted', () => {
    expect(
      resolveClientIp({
        socket: { remoteAddress: '10.4.0.9' },
        headers: { 'x-forwarded-for': '198.51.100.24, 10.4.0.8' },
      }),
    ).toBe('198.51.100.24');
  });
});
