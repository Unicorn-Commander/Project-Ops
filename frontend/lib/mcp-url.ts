/**
 * The MCP endpoint follows the public API host for the current build ring.
 * NEXT_PUBLIC_API_URL includes the API prefix in deployed builds, so use its
 * origin before adding the MCP route rather than baking a host into the UI.
 */
export function mcpUrlFromApiBase(apiBaseUrl: string | undefined): string {
  const value = (apiBaseUrl ?? "").trim();
  if (!value) return "/api/v1/mcp";

  // A relative public API base is valid for same-origin/self-hosted builds.
  if (value.startsWith("/")) return "/api/v1/mcp";

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "/api/v1/mcp";
    }
    return `${url.origin}/api/v1/mcp`;
  } catch {
    return "/api/v1/mcp";
  }
}

/** Build-time public MCP URL for this ring, sourced from NEXT_PUBLIC_API_URL. */
export const MCP_URL = mcpUrlFromApiBase(process.env.NEXT_PUBLIC_API_URL);
