/** CSV deck interchange helpers (mirrored from @lantern/shared/utils/deckFormats) */

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

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

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

/** Split CSV text into logical records without breaking on newlines inside quoted fields. */
export function splitCsvRecords(csv: string): string[] {
  const text = csv.replace(/^\uFEFF/, '');
  const records: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      current += ch;
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += text[++i];
        } else {
          inQuotes = false;
        }
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      current += ch;
      continue;
    }

    if (ch === '\n') {
      const trimmed = current.replace(/\r$/, '');
      if (trimmed.trim()) records.push(trimmed);
      current = '';
      continue;
    }

    current += ch;
  }

  const last = current.replace(/\r$/, '');
  if (last.trim()) records.push(last);
  return records;
}

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

export function csvToImportData(csv: string, deckName = 'Imported Deck'): DeckImportPayload {
  const lines = splitCsvRecords(csv);
  if (lines.length === 0) {
    return { deck: { name: deckName }, flashcards: [] };
  }

  const firstFields = parseCsvLine(lines[0]).map((f) => f.trim().toLowerCase());
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
    const fields = parseCsvLine(lines[i]);
    const front = (fields[frontIdx] || '').trim();
    const back = (fields[backIdx] || '').trim();
    if (!front && !back) continue;

    const tagsRaw = tagsIdx >= 0 ? fields[tagsIdx] : '';
    const tags = tagsRaw ? tagsRaw.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [];
    const imageUrl = imageIdx >= 0 ? (fields[imageIdx] || '').trim() : '';

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
