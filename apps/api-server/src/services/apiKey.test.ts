import { ApiKeyService, API_KEY_PREFIX } from '../services/apiKey';

describe('ApiKeyService', () => {
  const service = new ApiKeyService();

  it('recognizes lsk_ key format', () => {
    const sampleKey = `${API_KEY_PREFIX}${'a'.repeat(32)}`;
    expect(service.isApiKeyFormat(sampleKey)).toBe(true);
    expect(service.isApiKeyFormat('Bearer jwt-token')).toBe(false);
    expect(service.isApiKeyFormat('lsk_short')).toBe(false);
  });

  it('hasPermission grants admin override', () => {
    expect(service.hasPermission(['admin'], 'write')).toBe(true);
    expect(service.hasPermission(['read'], 'write')).toBe(false);
    expect(service.hasPermission(['read', 'write'], 'write')).toBe(true);
  });
});
