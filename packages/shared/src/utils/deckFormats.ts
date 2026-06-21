/** CSV and deck interchange helpers for Lantern Study */

export interface DeckImportPayload {
  deck: { name: string; description?: string };
  flashcards: Array<{
    type?: string;
    front?: string;
    back?: string;
    clozeText?: string;
    cloze_text?: string;
    imageUrl?: string;
    image_url?: string;
    tags?: string[];
  }>;
}

/** Escape a CSV field */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Parse one CSV line respecting quoted fields */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/** Convert Lantern export payload to CSV (front,back,tags,image_url) */
export function deckToCsv(data: DeckImportPayload): string {
  const header = 'front,back,tags,image_url';
  const rows = (data.flashcards || []).map((card) => {
    const front = card.front || card.clozeText || card.cloze_text || '';
    const back = card.back || '';
    const tags = Array.isArray(card.tags) ? card.tags.join(';') : '';
    const imageUrl = card.image_url || card.imageUrl || '';
    return [csvEscape(front), csvEscape(back), csvEscape(tags), csvEscape(imageUrl)].join(',');
  });
  return [header, ...rows].join('\n');
}

/** Parse CSV text into Lantern import payload */
export function csvToImportData(csv: string, deckName = 'Imported Deck'): DeckImportPayload {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) {
    return { deck: { name: deckName }, flashcards: [] };
  }

  const firstLine = lines[0]!;
  const firstFields = parseCsvLine(firstLine).map((f) => f.trim().toLowerCase());
  const hasHeader =
    firstFields.includes('front') ||
    firstFields.includes('question') ||
    firstFields.includes('term');

  const startIdx = hasHeader ? 1 : 0;
  const frontIdx = hasHeader
    ? Math.max(firstFields.indexOf('front'), firstFields.indexOf('question'), firstFields.indexOf('term'), 0)
    : 0;
  const backIdx = hasHeader
    ? Math.max(firstFields.indexOf('back'), firstFields.indexOf('answer'), firstFields.indexOf('definition'), 1)
    : 1;
  const tagsIdx = hasHeader ? firstFields.indexOf('tags') : -1;
  const imageIdx = hasHeader
    ? Math.max(firstFields.indexOf('image_url'), firstFields.indexOf('image'))
    : -1;

  const flashcards: DeckImportPayload['flashcards'] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!;
    const fields = parseCsvLine(line);
    const front = (fields[frontIdx] || '').trim();
    const back = (fields[backIdx] || '').trim();
    if (!front && !back) continue;

    const tagsRaw = tagsIdx >= 0 ? fields[tagsIdx] : '';
    const tags = tagsRaw ? tagsRaw.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [];
    const imageUrl = imageIdx >= 0 ? (fields[imageIdx] || '').trim() : '';

    // Detect cloze {{c1::...}} syntax
    const isCloze = /\{\{c\d+::/.test(front) || /\{\{c\d+::/.test(back);
    const cardBase = imageUrl ? { imageUrl } : {};
    if (isCloze) {
      flashcards.push({ type: 'CLOZE', clozeText: front || back, tags, ...cardBase });
    } else {
      flashcards.push({ type: 'BASIC', front, back, tags, ...cardBase });
    }
  }

  return { deck: { name: deckName, description: 'Imported from CSV' }, flashcards };
}

/** Strip HTML tags from Anki fields */
export function stripHtml(html: string): string {
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
