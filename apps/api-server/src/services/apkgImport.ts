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

/** Parse Anki .apkg buffer (zip containing collection.anki2 SQLite DB) */
export async function parseApkgBuffer(buffer: Buffer): Promise<ApkgImportResult> {
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
