import { logger } from '../utils/logger';

export interface ApkgImportResult {
  deck: { name: string; description?: string };
  flashcards: Array<{
    type: string;
    front?: string;
    back?: string;
    clozeText?: string;
    tags?: string[];
  }>;
}

/** Strip HTML tags from Anki fields */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Largest `collection.anki2` we will inflate into memory. The archive is
 * student-supplied, and a zip's declared uncompressed size is attacker
 * controlled (GHSA-7q85-xj36-vmfc): a few KB of zip can claim gigabytes. The
 * whole SQLite file has to sit in memory for sql.js, so the cap is on the
 * DECLARED size, checked before any inflation happens. Real Anki decks are
 * tens of MB at most.
 */
export const MAX_APKG_DB_BYTES = 128 * 1024 * 1024;

/**
 * Parse Anki .apkg buffer (zip containing collection.anki2 SQLite DB).
 *
 * Nothing is ever extracted to disk — the one entry we need is read straight
 * into memory — so entry names are never used as paths here.
 */
export async function parseApkgBuffer(
  buffer: Buffer,
  options: { maxDbBytes?: number } = {}
): Promise<ApkgImportResult> {
  const maxDbBytes = options.maxDbBytes ?? MAX_APKG_DB_BYTES;
  const AdmZip = (await import('adm-zip')).default;
  const initSqlJs = (await import('sql.js')).default;

  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const dbEntry = entries.find(
    (e: { entryName: string }) => e.entryName === 'collection.anki2' || e.entryName.endsWith('/collection.anki2')
  );
  if (!dbEntry) {
    throw new Error('Invalid APKG: collection.anki2 not found');
  }
  const declaredBytes = dbEntry.header?.size;
  if (typeof declaredBytes === 'number' && declaredBytes > maxDbBytes) {
    throw new Error(
      `Invalid APKG: collection.anki2 is ${Math.round(declaredBytes / (1024 * 1024))} MB; the limit is ${Math.round(maxDbBytes / (1024 * 1024))} MB`
    );
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(new Uint8Array(dbEntry.getData()));

  let deckName = 'Imported from Anki';
  try {
    const decksRow = db.exec('SELECT decks FROM col LIMIT 1');
    if (decksRow[0]?.values[0]?.[0]) {
      const decksJson = JSON.parse(decksRow[0].values[0][0] as string);
      const firstDeck = Object.values(decksJson)[0] as { name?: string };
      if (firstDeck?.name) deckName = firstDeck.name;
    }
  } catch {
    // use default name
  }

  const notesResult = db.exec(`
    SELECT n.flds, n.tags, c.ord
    FROM notes n
    JOIN cards c ON c.nid = n.id
    ORDER BY c.id
  `);

  const flashcards: ApkgImportResult['flashcards'] = [];
  const seen = new Set<string>();

  if (notesResult[0]) {
    const { columns, values } = notesResult[0];
    const fldsIdx = columns.indexOf('flds');
    const tagsIdx = columns.indexOf('tags');

    for (const row of values) {
      const fldsRaw = row[fldsIdx] as string;
      const tagsRaw = (row[tagsIdx] as string) || '';
      const key = fldsRaw;
      if (seen.has(key)) continue;
      seen.add(key);

      const fields = fldsRaw.split('\x1f').map(stripHtml);
      const front = fields[0] || '';
      const back = fields[1] || '';
      const tags = tagsRaw.trim().split(/\s+/).filter(Boolean);

      if (!front && !back) continue;

      const isCloze = /\{\{c\d+::/.test(front) || /\{\{c\d+::/.test(back);
      if (isCloze) {
        flashcards.push({ type: 'CLOZE', clozeText: front || back, tags });
      } else {
        flashcards.push({ type: 'BASIC', front, back, tags });
      }
    }
  }

  db.close();

  if (flashcards.length === 0) {
    throw new Error('No cards found in APKG file');
  }

  logger.info(`Parsed APKG: ${flashcards.length} cards for deck "${deckName}"`);
  return {
    deck: { name: deckName, description: 'Imported from Anki APKG' },
    flashcards,
  };
}
