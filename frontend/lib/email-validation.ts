import { z } from 'zod';

export const emailConfigSchema = z.object({
  provider: z.enum(['microsoft365', 'google', 'custom'], {
    message: 'Please select an email provider',
  }),
  smtpHost: z.string().min(1, 'SMTP host is required'),
  smtpPort: z.number().min(1).max(65535, 'Port must be between 1 and 65535'),
  useTLS: z.boolean(),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'App password is required'),
  fromName: z.string().min(1, 'From name is required'),
  enabled: z.boolean(),
});

export type EmailConfigFormData = z.infer<typeof emailConfigSchema>;

export const testEmailSchema = z.object({
  recipientEmail: z.string().email('Please enter a valid email address'),
});

export type TestEmailFormData = z.infer<typeof testEmailSchema>;
