import { Request } from 'express';

/** Public marketplace GET paths (relative to /api/v1/marketplace). */
export const PUBLIC_MARKETPLACE_READ_PATHS = [
  '/listings',
  '/campuses',
  '/analytics/categories',
  '/categories/custom',
] as const;

const PUBLIC_MARKETPLACE_READ_PATTERNS: RegExp[] = [
  /^\/listings\/[^/]+$/,
  /^\/listings\/[^/]+\/reviews$/,
  /^\/listings\/[^/]+\/similar$/,
  /^\/listings\/[^/]+\/full$/,
  /^\/sellers\/[^/]+\/profile$/,
];

export function isPublicMarketplaceReadPath(path: string): boolean {
  const normalized = path.split('?')[0] || '/';
  if ((PUBLIC_MARKETPLACE_READ_PATHS as readonly string[]).includes(normalized)) {
    return true;
  }
  return PUBLIC_MARKETPLACE_READ_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isPublicGroupMembersPath(method: string, path: string): boolean {
  return method === 'GET' && /^\/[^/]+\/members\/?$/.test(path);
}

export function isPublicReadRequest(req: Request): boolean {
  if (req.method !== 'GET') return false;
  const base = req.baseUrl || '';
  const path = req.path || '';
  if (base.endsWith('/marketplace') && isPublicMarketplaceReadPath(path)) {
    return true;
  }
  if (base.endsWith('/groups') && isPublicGroupMembersPath(req.method, path)) {
    return true;
  }
  return false;
}

export function isPublicWriteRequest(req: Request): boolean {
  return false;
}
