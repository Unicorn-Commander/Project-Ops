// Build step: point public/.well-known/mcps.json at this environment's hosts.
// Reads NEXT_PUBLIC_SITE_URL (mint_url origin) and NEXT_PUBLIC_API_URL
// (mcp_endpoint = its origin). Unset values leave the committed file as is.
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../public/.well-known/mcps.json", import.meta.url);
const origin = (v) => {
  try { return v && v.trim() ? new URL(v.trim()).origin : undefined; } catch { return undefined; }
};
const site = origin(process.env.NEXT_PUBLIC_SITE_URL);
const api = origin(process.env.NEXT_PUBLIC_API_URL);
const doc = JSON.parse(readFileSync(file, "utf8"));
if (api) doc.mcp_endpoint = api;
if (site && doc.auth && doc.auth.mint_url) {
  const u = new URL(doc.auth.mint_url);
  doc.auth.mint_url = site + u.pathname + u.search;
}
writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
console.log(`mcps.json: mcp_endpoint=${doc.mcp_endpoint} mint_url=${doc.auth?.mint_url}`);
