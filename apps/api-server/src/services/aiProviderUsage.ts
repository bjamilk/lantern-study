import { getRedisClient, redisKey } from './redisStore';

const PREFIX = 'ai_provider_usage:';

function todayUtc(): string {
  return new Date().toISOString().split('T')[0];
}

function usageKey(providerName: string, day: string): string {
  return redisKey(`${PREFIX}${providerName}:${day}`);
}

export async function getProviderDailyUsage(providerName: string): Promise<number | null> {
  const client = await getRedisClient();
  if (!client) return null;
  const val = await client.get(usageKey(providerName, todayUtc()));
  if (!val) return 0;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function incrementProviderDailyUsage(providerName: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  const key = usageKey(providerName, todayUtc());
  await client.incr(key);
  await client.expire(key, 60 * 60 * 48);
}

export async function syncProviderUsageFromRedis<T extends {
  name: string;
  dailyUsed: number;
  dailyLimit: number;
  lastReset: string;
}>(
  provider: T,
  checkAndReset: (p: T) => void
): Promise<boolean> {
  checkAndReset(provider);
  const redisUsed = await getProviderDailyUsage(provider.name);
  if (redisUsed !== null) {
    provider.dailyUsed = redisUsed;
  }
  const configured =
    provider.name === 'groq'
      ? !!process.env.GROQ_API_KEY
      : provider.name === 'gemini'
        ? !!process.env.GEMINI_API_KEY
        : provider.name === 'cloudflare'
          ? !!process.env.CF_API_TOKEN && !!process.env.CF_ACCOUNT_ID
          : provider.name === 'huggingface'
            ? !!process.env.HF_API_TOKEN
            : provider.name === 'mock-fallback';
  return configured && provider.dailyUsed < provider.dailyLimit;
}
