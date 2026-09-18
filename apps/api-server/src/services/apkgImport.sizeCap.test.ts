/**
 * The archive is student-supplied and adm-zip inflates whatever the entry
 * header declares (GHSA-7q85-xj36-vmfc). parseApkgBuffer must refuse on the
 * DECLARED size before inflating anything.
 */
import AdmZip from 'adm-zip';
import { parseApkgBuffer, MAX_APKG_DB_BYTES } from './apkgImport';

function apkgWithDb(bytes: number): Buffer {
  const zip = new AdmZip();
  zip.addFile('collection.anki2', Buffer.alloc(bytes, 1));
  return zip.toBuffer();
}

describe('parseApkgBuffer size cap', () => {
  it('refuses an archive whose collection.anki2 declares more than the cap, before inflating', async () => {
    const buffer = apkgWithDb(4096);
    await expect(parseApkgBuffer(buffer, { maxDbBytes: 1024 })).rejects.toThrow(/limit is 0 MB/);
  });

  it('still rejects a missing database with the same message as before', async () => {
    const zip = new AdmZip();
    zip.addFile('media', Buffer.from('{}'));
    await expect(parseApkgBuffer(zip.toBuffer())).rejects.toThrow('collection.anki2 not found');
  });

  it('keeps the default cap at 128 MB', () => {
    expect(MAX_APKG_DB_BYTES).toBe(128 * 1024 * 1024);
  });
});
