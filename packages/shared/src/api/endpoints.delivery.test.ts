import { createApiEndpoints } from './endpoints';
import type { ApiClient } from './client';

function createClient(request: jest.Mock): ApiClient {
  return {
    request,
    requestRaw: jest.fn(),
    requestText: jest.fn(),
    getBaseUrl: () => 'https://example.test',
  };
}

describe('chat endpoint delivery retries', () => {
  it('retries a group send with the same client operation id and body', async () => {
    const request = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce({ id: 'server-message' });
    const api = createApiEndpoints(createClient(request));

    await expect(
      api.sendMessage('group-1', 'user-1', {
        content: 'Hello',
        clientMessageId: 'client-message-1',
      })
    ).resolves.toEqual({ id: 'server-message' });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({
      content: 'Hello',
      userId: 'user-1',
      clientMessageId: 'client-message-1',
    });
  });

  it('retries a direct message with the same client operation id and body', async () => {
    const request = jest
      .fn()
      .mockRejectedValueOnce(new Error('Request timed out'))
      .mockResolvedValueOnce({ id: 'server-dm' });
    const api = createApiEndpoints(createClient(request));

    await expect(
      api.sendDirectMessage('sender-1', 'recipient-1', 'Hello', 'client-dm-1')
    ).resolves.toEqual({ id: 'server-dm' });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
  });
});
