import { randomBytes, createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { SupabaseService } from './supabase';
import { logger } from '../utils/logger';

export const API_KEY_PREFIX = 'lsk_';
/** Permissions users may request when creating API keys. */
export const USER_CREATABLE_API_KEY_PERMISSIONS = ['read', 'write', 'ai'] as const;
/** All permission scopes that may exist on stored keys (includes legacy admin). */
export const VALID_API_KEY_PERMISSIONS = [...USER_CREATABLE_API_KEY_PERMISSIONS, 'admin'] as const;
export type ApiKeyPermission = (typeof VALID_API_KEY_PERMISSIONS)[number];
const KEY_PREFIX_LENGTH = 12;
const DEFAULT_MAX_KEYS_PER_USER = parseInt(process.env.API_KEY_MAX_PER_USER || '10', 10);
const DEFAULT_TTL_DAYS = parseInt(process.env.API_KEY_DEFAULT_TTL_DAYS || '0', 10);

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface ApiKeyCreateResult extends ApiKeyRecord {
  secret: string;
}

export interface ApiKeyValidationResult {
  isValid: boolean;
  userId?: string;
  permissions?: string[];
  keyId?: string;
}

let supabaseService: SupabaseService | null = null;
const lastUsedDebounce = new Map<string, number>();

export function initializeApiKeyService(supabase: SupabaseService): void {
  supabaseService = supabase;
}

function requireSupabase(): SupabaseService {
  if (!supabaseService) {
    throw new Error('ApiKeyService not initialized');
  }
  return supabaseService;
}

function generateSecret(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

function getKeyPrefix(secret: string): string {
  return secret.slice(0, KEY_PREFIX_LENGTH);
}

function hashForLookup(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

function mapRow(row: any): ApiKeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    permissions: row.permissions || ['read'],
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export class ApiKeyService {
  private saltRounds: number;

  constructor() {
    this.saltRounds = parseInt(process.env.API_KEY_SALT_ROUNDS || '12', 10);
  }

  isApiKeyFormat(value: string): boolean {
    return typeof value === 'string' && value.startsWith(API_KEY_PREFIX) && value.length >= 20;
  }

  async countActiveKeys(userId: string): Promise<number> {
    const client = requireSupabase().getClient();
    const { count, error } = await client
      .from('user_api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('revoked_at', null);
    if (error) throw error;
    return count || 0;
  }

  async createKey(
    userId: string,
    name: string,
    permissions: string[] = ['read'],
    expiresAt?: string | null
  ): Promise<ApiKeyCreateResult> {
    const active = await this.countActiveKeys(userId);
    if (active >= DEFAULT_MAX_KEYS_PER_USER) {
      throw new Error(`Maximum of ${DEFAULT_MAX_KEYS_PER_USER} active API keys allowed`);
    }

    const normalizedPermissions = this.normalizePermissions(permissions.length ? permissions : ['read']);
    const secret = generateSecret();
    const keyHash = await bcrypt.hash(secret, this.saltRounds);
    const keyPrefix = getKeyPrefix(secret);

    let resolvedExpiresAt = expiresAt;
    if (!resolvedExpiresAt && DEFAULT_TTL_DAYS > 0) {
      resolvedExpiresAt = new Date(Date.now() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    }

    const client = requireSupabase().getClient();
    const { data, error } = await client
      .from('user_api_keys')
      .insert({
        user_id: userId,
        name: name.trim(),
        key_prefix: keyPrefix,
        key_hash: keyHash,
        permissions: normalizedPermissions,
        expires_at: resolvedExpiresAt || null,
      })
      .select('*')
      .single();

    if (error) throw error;

    return {
      ...mapRow(data),
      secret,
    };
  }

  async listKeys(userId: string): Promise<ApiKeyRecord[]> {
    const client = requireSupabase().getClient();
    const { data, error } = await client
      .from('user_api_keys')
      .select('id, user_id, name, key_prefix, permissions, last_used_at, expires_at, revoked_at, created_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map(mapRow);
  }

  async revokeKey(userId: string, keyId: string): Promise<void> {
    const client = requireSupabase().getClient();
    const { error } = await client
      .from('user_api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', keyId)
      .eq('user_id', userId)
      .is('revoked_at', null);

    if (error) throw error;
  }

  async rotateKey(userId: string, keyId: string, name?: string): Promise<ApiKeyCreateResult> {
    const client = requireSupabase().getClient();
    const { data: existing, error: fetchError } = await client
      .from('user_api_keys')
      .select('*')
      .eq('id', keyId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .single();

    if (fetchError || !existing) {
      throw new Error('API key not found');
    }

    await this.revokeKey(userId, keyId);
    return this.createKey(
      userId,
      name || existing.name,
      existing.permissions || ['read'],
      existing.expires_at
    );
  }

  async validateKey(secret: string): Promise<ApiKeyValidationResult> {
    if (!this.isApiKeyFormat(secret)) {
      return { isValid: false };
    }

    const client = requireSupabase().getClient();
    const keyPrefix = getKeyPrefix(secret);
    const { data: rows, error } = await client
      .from('user_api_keys')
      .select('*')
      .eq('key_prefix', keyPrefix)
      .is('revoked_at', null)
      .limit(20);

    if (error) {
      logger.warn('API key lookup failed', { error: error.message });
      return { isValid: false };
    }

    const now = Date.now();
    for (const row of rows || []) {
      if (row.expires_at && new Date(row.expires_at).getTime() < now) {
        continue;
      }
      const match = await bcrypt.compare(secret, row.key_hash);
      if (!match) continue;

      void this.touchLastUsed(row.id, hashForLookup(secret));
      return {
        isValid: true,
        userId: row.user_id,
        permissions: row.permissions || ['read'],
        keyId: row.id,
      };
    }

    return { isValid: false };
  }

  private async touchLastUsed(keyId: string, debounceKey: string): Promise<void> {
    const now = Date.now();
    const last = lastUsedDebounce.get(debounceKey) || 0;
    if (now - last < 60_000) return;
    lastUsedDebounce.set(debounceKey, now);

    try {
      const client = requireSupabase().getClient();
      await client
        .from('user_api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', keyId);
    } catch {
      // non-fatal
    }
  }

  hasPermission(userPermissions: string[], requiredPermission: string): boolean {
    if (userPermissions.includes('admin')) return true;
    if (requiredPermission === 'read') {
      return userPermissions.includes('read') || userPermissions.includes('write');
    }
    return userPermissions.includes(requiredPermission);
  }

  normalizePermissions(permissions: string[]): string[] {
    const normalized = [...new Set(
      permissions.filter(p => USER_CREATABLE_API_KEY_PERMISSIONS.includes(p as (typeof USER_CREATABLE_API_KEY_PERMISSIONS)[number]))
    )];
    if (normalized.length === 0) return ['read'];
    if (!normalized.includes('read') && !normalized.includes('write') && !normalized.includes('ai')) {
      return ['read', ...normalized];
    }
    return normalized;
  }
}

export const apiKeyService = new ApiKeyService();
