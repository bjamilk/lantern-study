/**
 * Helpers for user-scoped resource access and cache keys (IDOR mitigation).
 */

export class ResourceAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceAccessError';
  }
}

/** Build a cache key scoped to the authenticated user and resource id. */
export function userScopedCacheKey(prefix: string, userId: string, resourceId: string): string {
  return `${prefix}:${userId}:${resourceId}`;
}

/** Resolve owner id from common column shapes (snake_case and camelCase). */
export function getResourceOwnerId(resource: Record<string, unknown>): string | undefined {
  const owner = resource.user_id ?? resource.userId;
  return typeof owner === 'string' ? owner : undefined;
}

/**
 * Throws if the resource does not belong to the requesting user.
 * Platform admins may bypass when allowAdmin is true.
 */
export function assertResourceOwner(
  resource: Record<string, unknown> | null | undefined,
  userId: string,
  options?: { allowAdmin?: boolean; isAdmin?: boolean }
): void {
  if (!resource) {
    throw new ResourceAccessError('Resource not found');
  }
  if (options?.allowAdmin && options?.isAdmin) {
    return;
  }
  const ownerId = getResourceOwnerId(resource);
  if (!ownerId || ownerId !== userId) {
    throw new ResourceAccessError('Access denied');
  }
}

/** Express-friendly: returns false and sends 403/404 when access denied. */
export function enforceResourceOwner(
  res: { status: (code: number) => { json: (body: unknown) => void } },
  resource: Record<string, unknown> | null | undefined,
  userId: string,
  options?: { allowAdmin?: boolean; isAdmin?: boolean }
): boolean {
  try {
    assertResourceOwner(resource, userId, options);
    return true;
  } catch (err) {
    if (err instanceof ResourceAccessError) {
      const isNotFound = !resource;
      res.status(isNotFound ? 404 : 403).json({
        success: false,
        error: isNotFound ? 'Resource not found or access denied' : 'Access denied',
      });
      return false;
    }
    throw err;
  }
}
