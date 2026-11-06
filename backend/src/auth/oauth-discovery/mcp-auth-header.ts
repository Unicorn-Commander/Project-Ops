import { Request, Response } from 'express';
import { NO_PROJECT_OPS_ACCESS_DESCRIPTION } from '../no-workspace-access.exception';
import {
  ConfigReader,
  MCP_PATH,
  PROTECTED_RESOURCE_PATH,
  resolvePublicOrigin,
} from './oauth-discovery.service';

export const MCP_REALM = 'project-ops-mcp';
/**
 * RFC 6750 §3.1: a verified token that lacks Project-Ops access.
 * Distinct from the invalid_token discovery challenge below — no resource_metadata link,
 * so an AI client shows the description instead of starting sign-in again.
 */
export const MCP_INSUFFICIENT_SCOPE_HEADER = `Bearer realm="${MCP_REALM}", error="insufficient_scope", error_description="${NO_PROJECT_OPS_ACCESS_DESCRIPTION}"`;

/** True when the request carries a non-empty Bearer credential. */
export function hasBearerToken(request: Request): boolean {
  const value = request.headers?.authorization ?? (request.headers as any)?.Authorization;
  if (typeof value !== 'string') return false;
  const [scheme, token] = value.split(/\s+/, 2);
  return scheme?.toLowerCase() === 'bearer' && Boolean(token?.trim());
}

export function isMcpRequest(request: Request): boolean {
  const path =
    (typeof request.path === 'string' && request.path) ||
    request.originalUrl?.split('?', 1)[0] ||
    request.url?.split('?', 1)[0] ||
    '';
  return path === MCP_PATH || path === `${MCP_PATH}/`;
}

/**
 * Add the RFC 9728 challenge only to the MCP resource-server path. The body
 * remains Nest's generic 401 JSON; no presented credential is copied anywhere.
 */
export function setMcpUnauthorizedHeader(
  request: Request,
  response: Response,
  config?: ConfigReader,
  tokenPresented = hasBearerToken(request),
): void {
  if (!isMcpRequest(request)) return;

  const metadataUrl = `${resolvePublicOrigin(request, config)}${PROTECTED_RESOURCE_PATH}${MCP_PATH}`;
  const error = tokenPresented ? ', error="invalid_token"' : '';
  response.setHeader(
    'WWW-Authenticate',
    `Bearer realm="${MCP_REALM}", resource_metadata="${metadataUrl}"${error}`,
  );
}

/** RFC 6750 insufficient_scope for a verified identity with no Project-Ops access. */
export function setInsufficientScopeHeader(response: Response): void {
  response.setHeader('WWW-Authenticate', MCP_INSUFFICIENT_SCOPE_HEADER);
}
