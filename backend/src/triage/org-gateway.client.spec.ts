import { OpsCenterOrgGatewayKeyProvider } from './org-gateway.client';

describe('OpsCenterOrgGatewayKeyProvider', () => {
  it('fetches an app-scoped org key and caches it for the ten-minute window', async () => {
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            OPS_CENTER_INTERNAL_URL: 'https://ops-center.fictional.example',
            OPS_CENTER_SERVICE_TOKEN: 'fictional-service-token',
          })[key],
      ),
    } as any;
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ key: 'fictional-org-key', expiresAt: Date.now() + 60_000 }),
    } as Response);

    try {
      const provider = new OpsCenterOrgGatewayKeyProvider(config);
      const first = await provider.getKey('org/fictional');
      const second = await provider.getKey('org/fictional');

      expect(first).toEqual(second);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://ops-center.fictional.example/api/v1/internal/orgs/org%2Ffictional/gateway-key',
      );
      expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
        Accept: 'application/json',
        Authorization: 'Bearer fictional-service-token',
      });
    } finally {
      fetchMock.mockRestore();
    }
  });
});
