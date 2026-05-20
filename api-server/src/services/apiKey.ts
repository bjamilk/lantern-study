import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ApiKey } from '../types';

export class ApiKeyService {
  private jwtSecret: string;
  private saltRounds: number;

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'default-secret-change-in-production';
    this.saltRounds = parseInt(process.env.API_KEY_SALT_ROUNDS || '12');
  }

  // Generate a new API key
  async generateApiKey(userId: string, name: string, permissions: string[] = ['read', 'write']): Promise<ApiKey> {
    const keyId = this.generateId();
    const rawKey = this.generateRandomKey();
    const hashedKey = await bcrypt.hash(rawKey, this.saltRounds);

    const apiKey: ApiKey = {
      id: keyId,
      key: hashedKey,
      userId,
      name,
      permissions,
      createdAt: new Date().toISOString(),
      isActive: true,
    };

    // In a real implementation, you'd store this in a database
    // For now, we'll return the raw key to the user (only time they see it)
    return {
      ...apiKey,
      key: rawKey, // Return the unhashed key to the user
    };
  }

  // Validate an API key
  async validateApiKey(apiKey: string): Promise<{ isValid: boolean; userId?: string; permissions?: string[] }> {
    try {
      // In a real implementation, you'd look up the hashed key in the database
      // For demo purposes, we'll decode the JWT token
      const decoded = jwt.verify(apiKey, this.jwtSecret) as any;

      return {
        isValid: true,
        userId: decoded.userId,
        permissions: decoded.permissions,
      };
    } catch (error) {
      return { isValid: false };
    }
  }

  // Create a JWT token for authenticated requests
  createToken(userId: string, permissions: string[]): string {
    return jwt.sign(
      {
        userId,
        permissions,
        iat: Math.floor(Date.now() / 1000),
      },
      this.jwtSecret,
      { expiresIn: '24h' }
    );
  }

  // Verify a JWT token
  verifyToken(token: string): { userId: string; permissions: string[] } | null {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      return {
        userId: decoded.userId,
        permissions: decoded.permissions,
      };
    } catch (error) {
      return null;
    }
  }

  private generateId(): string {
    return `key_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateRandomKey(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Check if user has permission
  hasPermission(userPermissions: string[], requiredPermission: string): boolean {
    return userPermissions.includes(requiredPermission) || userPermissions.includes('admin');
  }

  // Rate limiting key for user
  getRateLimitKey(userId: string): string {
    return `ratelimit:${userId}`;
  }
}

// Singleton instance
export const apiKeyService = new ApiKeyService();