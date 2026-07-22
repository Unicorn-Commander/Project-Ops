import { ForgejoAdapter } from './forgejo.adapter';
import { GitForgeCredentials, GitForgeNotConfiguredError } from '../types';

describe('ForgejoAdapter (design stub)', () => {
  const adapter = new ForgejoAdapter();

  const validCreds: GitForgeCredentials = {
    provider: 'FORGEJO',
    baseUrl: 'https://git.example.test',
    authType: 'PAT',
    accessToken: 'test-token-not-real',
  };

  it('exposes kind FORGEJO', () => {
    expect(adapter.kind).toBe('FORGEJO');
  });

  it('refuses testConnection without token (no network)', async () => {
    await expect(
      adapter.testConnection({ ...validCreds, accessToken: '' }),
    ).rejects.toBeInstanceOf(GitForgeNotConfiguredError);
  });

  it('refuses listCommits without baseUrl', async () => {
    await expect(
      adapter.listCommits(
        { ...validCreds, baseUrl: '' },
        { owner: 'acme', repo: 'app' },
      ),
    ).rejects.toBeInstanceOf(GitForgeNotConfiguredError);
  });

  it('returns empty commits when credentials present (stub, no network)', async () => {
    await expect(
      adapter.listCommits(validCreds, { owner: 'acme', repo: 'app' }),
    ).resolves.toEqual([]);
  });

  it('returns empty PRs when credentials present (stub, no network)', async () => {
    await expect(
      adapter.listPullRequests(validCreds, { owner: 'acme', repo: 'app' }),
    ).resolves.toEqual([]);
  });

  it('parseWebhook fails closed (null) until Phase 1', () => {
    expect(adapter.parseWebhook({}, '{}', 'secret')).toBeNull();
  });

  it('rejects GitHub credentials on the Forgejo adapter', async () => {
    await expect(
      adapter.testConnection({ ...validCreds, provider: 'GITHUB' }),
    ).rejects.toBeInstanceOf(GitForgeNotConfiguredError);
  });
});
