// This suite runs under Jest (see jest.config), which provides describe/expect/it
// as globals. Importing them from vitest makes the whole suite fail to load with
// "Vitest cannot be imported in a CommonJS module using require()".
import { signAccountExport, verifyAccountExportSignature, wrapSignedExport } from './accountExportSign';

describe('accountExportSign', () => {
  it('signs and verifies export payloads', () => {
    process.env.JWT_SECRET = 'test-secret-for-exports';

    const wrapped = wrapSignedExport({
      sourceUserId: '00000000-0000-4000-8000-000000000001',
      sourceEmail: 'user@example.com',
      data: { profile: { name: 'Test' }, notes: [] },
    });

    expect(wrapped.format).toBe('lantern-study-gdpr-export-v2');
    expect(verifyAccountExportSignature(wrapped)).toBe(true);

    const tampered = {
      ...wrapped,
      data: { ...wrapped.data, notes: [{ id: 'x' }] },
    };
    expect(verifyAccountExportSignature(tampered)).toBe(false);

    const resigned = signAccountExport({
      sourceUserId: wrapped.sourceUserId,
      sourceEmail: wrapped.sourceEmail,
      exportedAt: wrapped.exportedAt,
      data: wrapped.data as Record<string, unknown>,
    });
    expect(resigned).toBe(wrapped.signature);
  });
});
