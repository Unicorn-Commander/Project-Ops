import { ValidationPipe } from '@nestjs/common';
import { BulkTriageProposalsDto, TriageAction } from './triage-proposals.dto';

describe('BulkTriageProposalsDto validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const metadata = { type: 'body' as const, metatype: BulkTriageProposalsDto };
  const proposalId = '4d5d3b2e-3f6d-4f2a-8b15-2c6d4c4b1f10';

  it('accepts a valid bulk rejection and preserves the reason metadata', async () => {
    const result = await pipe.transform(
      {
        proposalIds: [proposalId],
        action: TriageAction.REJECT,
        reasonPreset: 'duplicate',
        reason: 'Already tracked.',
        duplicateOfTaskId: '1d5d3b2e-3f6d-4f2a-8b15-2c6d4c4b1f10',
      },
      metadata,
    );

    expect(result).toMatchObject({
      proposalIds: [proposalId],
      action: 'reject',
      reasonPreset: 'duplicate',
    });
  });

  it.each([
    { proposalIds: ['not-a-uuid'], action: 'approve' },
    { proposalIds: [proposalId], action: 'archive' },
    { proposalIds: [proposalId], action: 'reject', reasonPreset: 'made_up' },
    { proposalIds: [proposalId], action: 'reject', unknown: true },
  ])('rejects garbage payload %# with HTTP 400', async (payload) => {
    await expect(pipe.transform(payload, metadata)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects more than 200 proposal ids with HTTP 400', async () => {
    const tooMany = Array.from(
      { length: 201 },
      (_, i) => `4d5d3b2e-3f6d-4f2a-8b15-${String(i).padStart(12, '0')}`,
    );
    await expect(
      pipe.transform({ proposalIds: tooMany, action: 'approve' }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });
});
