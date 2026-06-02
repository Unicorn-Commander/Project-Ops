import { generatePat, hashPat, isPatToken, verifyPat } from './pat.util';
import { PAT_PREFIX, PAT_TOKEN_BYTES } from './pat.constants';

describe('pat.util', () => {
  describe('generatePat', () => {
    it('produces a plaintext token with the canonical prefix', async () => {
      const { plaintext, hash } = generatePat();
      await hash; // resolve the eagerly-started hash so jest doesn't warn
      expect(plaintext.startsWith(PAT_PREFIX)).toBe(true);
    });

    it('uses base64url for the random suffix (no padding, url-safe alphabet)', async () => {
      const { plaintext, hash } = generatePat();
      await hash;
      const suffix = plaintext.slice(PAT_PREFIX.length);
      // base64url is [A-Za-z0-9_-]+; no '+', '/', or '=' padding
      expect(suffix).toMatch(/^[A-Za-z0-9_-]+$/);
      // 32 bytes -> ceil(32 * 4/3) = 43 base64url chars
      const expectedLen = Math.ceil((PAT_TOKEN_BYTES * 4) / 3);
      expect(suffix.length).toBe(expectedLen);
    });

    it('generates a fresh token on every call', async () => {
      const a = generatePat();
      const b = generatePat();
      await Promise.all([a.hash, b.hash]);
      expect(a.plaintext).not.toEqual(b.plaintext);
    });

    it('returns a hash that round-trips with verifyPat', async () => {
      const { plaintext, hash } = generatePat();
      const resolved = await hash;
      await expect(verifyPat(plaintext, resolved)).resolves.toBe(true);
    });

    it('rejects a different plaintext against the same hash', async () => {
      const { plaintext, hash } = generatePat();
      const resolved = await hash;
      await expect(verifyPat(`${plaintext}x`, resolved)).resolves.toBe(false);
    });
  });

  describe('hashPat', () => {
    it('verifies against the plaintext it was derived from', async () => {
      const plaintext = `${PAT_PREFIX}testing-token-value`;
      const hash = await hashPat(plaintext);
      await expect(verifyPat(plaintext, hash)).resolves.toBe(true);
    });
  });

  describe('verifyPat', () => {
    it('returns false on empty plaintext', async () => {
      await expect(verifyPat('', 'whatever')).resolves.toBe(false);
    });
    it('returns false on empty hash', async () => {
      await expect(verifyPat('po_pat_abc', '')).resolves.toBe(false);
    });
  });

  describe('isPatToken', () => {
    it('recognizes the canonical prefix', () => {
      expect(isPatToken('po_pat_anything-here')).toBe(true);
    });
    it('rejects non-strings', () => {
      expect(isPatToken(undefined)).toBe(false);
      expect(isPatToken(null)).toBe(false);
      expect(isPatToken(42)).toBe(false);
      expect(isPatToken({})).toBe(false);
    });
    it('rejects JWT-shaped values that lack the prefix', () => {
      expect(isPatToken('eyJhbGciOi.payload.sig')).toBe(false);
    });
    it('rejects empty string and lone prefix variations', () => {
      expect(isPatToken('')).toBe(false);
      // Lone prefix is structurally a PAT shape; we accept the prefix
      // check (the bcrypt-compare in the service will still reject it).
      expect(isPatToken(PAT_PREFIX)).toBe(true);
    });
  });
});
