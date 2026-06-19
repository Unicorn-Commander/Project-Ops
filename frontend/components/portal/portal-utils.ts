/**
 * Small presentation helpers shared across the client-portal surfaces. Kept
 * here (not in lib/) to honour the portal's ownership boundary.
 */

/** Format a nullable money amount as USD; "—" when absent. */
export function money(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/** Human-friendly file size (B / KB / MB). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
