import api from './api';

export interface EmailConfig {
  id?: string;
  provider: 'microsoft365' | 'google' | 'custom';
  smtpHost: string;
  smtpPort: number;
  useTLS: boolean;
  email: string;
  password: string;
  fromName: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastTestStatus?: 'success' | 'failed';
  lastTestAt?: string;
}

export interface EmailConfigResponse {
  id: string;
  provider: string;
  smtpHost: string;
  smtpPort: number;
  useTLS: boolean;
  email: string;
  password: string; // Masked on server
  fromName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastTestStatus?: 'success' | 'failed';
  lastTestAt?: string;
}

export interface TestEmailRequest {
  recipientEmail: string;
}

export interface TestEmailResponse {
  success: boolean;
  message: string;
  sentAt?: string;
}

// Get email configuration
export const getEmailConfig = async (): Promise<EmailConfigResponse | null> => {
  try {
    const response = await api.get<EmailConfigResponse>('/email/config');
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null; // No config exists
    }
    throw error;
  }
};

// Create or update email configuration
export const updateEmailConfig = async (
  config: Omit<EmailConfig, 'id' | 'createdAt' | 'updatedAt' | 'lastTestStatus' | 'lastTestAt'>
): Promise<EmailConfigResponse> => {
  const response = await api.post<EmailConfigResponse>('/email/config', config);
  return response.data;
};

// Send test email
export const sendTestEmail = async (recipientEmail: string): Promise<TestEmailResponse> => {
  const response = await api.post<TestEmailResponse>('/email/test', {
    recipientEmail,
  });
  return response.data;
};

// Delete email configuration
export const deleteEmailConfig = async (): Promise<void> => {
  await api.delete('/email/config');
};

// SMTP Provider presets
export const SMTP_PROVIDERS = {
  microsoft365: {
    name: 'Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    useTLS: true,
    setupUrl: 'https://support.microsoft.com/en-us/account-billing/using-app-passwords-with-apps-that-don-t-support-two-step-verification-5896ed9b-4263-e681-128a-a6f2979a7944',
  },
  google: {
    name: 'Google Workspace',
    host: 'smtp.gmail.com',
    port: 587,
    useTLS: true,
    setupUrl: 'https://support.google.com/accounts/answer/185833',
  },
  custom: {
    name: 'Custom SMTP',
    host: '',
    port: 587,
    useTLS: true,
    setupUrl: '',
  },
};
