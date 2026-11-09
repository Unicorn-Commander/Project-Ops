import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';

/** The first ACCEPTANCE paragraph, with platform line endings and surrounding whitespace normalized. */
export function acceptancePin(description: string | null | undefined): string | undefined {
  if (!description) return undefined;
  const lines = description.replace(/\r\n?/g, '\n').normalize('NFC').split('\n');
  const start = lines.findIndex((line) => line.startsWith('ACCEPTANCE:'));
  if (start < 0) return undefined;

  const paragraph: string[] = [];
  for (let index = start; index < lines.length && lines[index].trim(); index++) {
    paragraph.push(lines[index].trim());
  }
  return createHash('sha256').update(paragraph.join('\n'), 'utf8').digest('hex');
}

/** Pin fields are service-owned, even when a caller supplies the rest of metadata. */
export function withAcceptancePin(
  metadata: unknown,
  pin: string | undefined,
  pinnedAt?: string,
): Prisma.InputJsonObject | undefined {
  const base =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  delete base.acceptancePin;
  delete base.acceptancePinnedAt;
  if (pin) {
    base.acceptancePin = pin;
    base.acceptancePinnedAt = pinnedAt ?? new Date().toISOString();
  }
  return Object.keys(base).length ? (base as Prisma.InputJsonObject) : undefined;
}
