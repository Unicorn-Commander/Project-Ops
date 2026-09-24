import { ArgumentsHost } from '@nestjs/common';
import { SentryFilter } from './sentry.filter';

describe('SentryFilter', () => {
  it('logs an unhandled 500 with method, path, message, and request id', () => {
    const adapter = { isHeadersSent: () => false, reply: jest.fn() };
    const filter = new SentryFilter({ httpAdapter: adapter } as any);
    const error = new Error('boom');
    const logger = jest.spyOn((filter as any).logger, 'error').mockImplementation();
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const request = {
      method: 'POST',
      originalUrl: '/api/v1/triage/ingest',
      headers: { 'x-request-id': 'req-1' },
    };
    const host = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
      getArgByIndex: (index: number) => (index === 1 ? response : request),
    } as unknown as ArgumentsHost;

    filter.catch(error, host);

    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('POST /api/v1/triage/ingest 500 - boom requestId=req-1'),
      expect.any(String),
    );
  });
});
