import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateEmailConfigDto, UpdateEmailConfigDto } from './email-config.dto';

const createConfig = (overrides: Record<string, unknown> = {}) =>
  plainToInstance(CreateEmailConfigDto, {
    smtpHost: 'smtp.example.test',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: 'postmark-server-token',
    smtpPassword: 'smtp-secret',
    fromName: 'Project Ops',
    fromEmail: 'notifications@example.test',
    ...overrides,
  });

describe('email config SMTP credentials validation', () => {
  it('accepts a token-style smtpUser on create', async () => {
    const errors = await validate(createConfig());

    expect(errors).toEqual([]);
  });

  it('accepts a token-style smtpUser on update', async () => {
    const dto = plainToInstance(UpdateEmailConfigDto, {
      smtpUser: 'sendgrid-api-token',
    });

    expect(await validate(dto)).toEqual([]);
  });

  it.each([
    ['create', createConfig({ smtpUser: '' })],
    ['update', plainToInstance(UpdateEmailConfigDto, { smtpUser: '' })],
  ])('rejects an empty smtpUser on %s', async (_label, dto) => {
    const errors = await validate(dto);

    expect(errors.find((error) => error.property === 'smtpUser')?.constraints).toHaveProperty(
      'minLength',
    );
  });

  it('accepts a token-style smtpUser through the email alias', async () => {
    const dto = createConfig({ smtpUser: undefined, email: 'postmark-server-token' });

    expect(dto.smtpUser).toBe('postmark-server-token');
    expect(await validate(dto)).toEqual([]);
  });

  it.each([
    ['create', createConfig({ fromEmail: 'not-an-email' })],
    ['update', plainToInstance(UpdateEmailConfigDto, { fromEmail: 'not-an-email' })],
  ])('still rejects a non-email fromEmail on %s', async (_label, dto) => {
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'fromEmail')).toBe(true);
  });
});
