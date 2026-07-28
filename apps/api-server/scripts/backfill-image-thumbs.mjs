#!/usr/bin/env node
/**
 * Backfill missing sibling thumbnails (<path>.thumb.webp) for image buckets.
 * Never modifies originals. Safe to re-run (skips objects that already have thumbs).
 *
 * Usage:
 *   node apps/api-server/scripts/backfill-image-thumbs.mjs --dry-run
 *   node apps/api-server/scripts/backfill-image-thumbs.mjs --bucket=marketplace-images
 *   node apps/api-server/scripts/backfill-image-thumbs.mjs --concurrency=4
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env (or apps/api-server/.env).
 */

import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const sharp = require('sharp');

const DEFAULT_BUCKETS = [
  'marketplace-images',
  'flashcard-images',
  'question-images',
  'note-files',
  'profile-avatars',
  'group-avatars',
];

const THUMB_SIZE_BY_BUCKET = {
  'marketplace-images': 320,
  'flashcard-images': 320,
  'question-images': 320,
  'note-files': 480,
  'profile-avatars': 0, // no thumbs for avatars
  'group-avatars': 0,
};

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(resolve(__dirname, '../.env'));
loadEnvFile(resolve(__dirname, '../../../.env'));

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    bucket: null,
    concurrency: 3,
    limit: Infinity,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--bucket=')) opts.bucket = arg.slice('--bucket='.length);
    else if (arg.startsWith('--concurrency=')) {
      opts.concurrency = Math.max(1, Number(arg.slice('--concurrency='.length)) || 3);
    } else if (arg.startsWith('--limit=')) {
      opts.limit = Math.max(1, Number(arg.slice('--limit='.length)) || Infinity);
    }
  }
  return opts;
}

function storageThumbPath(path) {
  if (path.endsWith('.thumb.webp')) return path;
  return `${path}.thumb.webp`;
}

function isThumbPath(path) {
  return path.endsWith('.thumb.webp');
}

function looksLikeImage(name) {
  return IMAGE_EXT.test(name) && !isThumbPath(name);
}

async function listAllObjects(supabase, bucket, prefix = '') {
  const out = [];
  const pageSize = 100;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    if (!data?.length) break;

    for (const item of data) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      // Folders have id === null in Supabase list responses.
      if (item.id === null || item.metadata == null) {
        const nested = await listAllObjects(supabase, bucket, fullPath);
        out.push(...nested);
      } else if (looksLikeImage(item.name)) {
        out.push({
          path: fullPath,
          size: item.metadata?.size ?? 0,
          contentType: item.metadata?.mimetype || '',
        });
      }
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function objectExists(supabase, bucket, path) {
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
  const { data, error } = await supabase.storage.from(bucket).list(parent, {
    limit: 100,
    search: name,
  });
  if (error) return false;
  return (data || []).some((item) => item.name === name);
}

async function buildThumb(buffer, size) {
  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: size,
      height: size,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 72 })
    .toBuffer();
}

async function mapPool(items, concurrency, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const buckets = opts.bucket ? [opts.bucket] : DEFAULT_BUCKETS;
  let processed = 0;
  let created = 0;
  let skipped = 0;
  let failed = 0;
  let bytesAdded = 0;

  for (const bucket of buckets) {
    const thumbSize = THUMB_SIZE_BY_BUCKET[bucket];
    if (!thumbSize) {
      console.log(`[${bucket}] skip (no thumb budget)`);
      continue;
    }

    console.log(`[${bucket}] listing objects…`);
    let objects = await listAllObjects(supabase, bucket);
    // note-files also holds PDFs/audio — already filtered by extension.
    // Prefer chat + note photo paths when bucket is note-files.
    if (bucket === 'note-files') {
      objects = objects.filter(
        (o) =>
          o.path.includes('/chat/') ||
          o.path.includes('/photos/') ||
          o.path.includes('/notes/') ||
          !o.path.includes('/audio/'),
      );
    }

    if (processed + objects.length > opts.limit) {
      objects = objects.slice(0, Math.max(0, opts.limit - processed));
    }

    console.log(`[${bucket}] ${objects.length} candidate images`);

    await mapPool(objects, opts.concurrency, async (obj) => {
      processed += 1;
      const thumbPath = storageThumbPath(obj.path);
      try {
        const exists = await objectExists(supabase, bucket, thumbPath);
        if (exists) {
          skipped += 1;
          return;
        }

        if (opts.dryRun) {
          created += 1;
          console.log(`[dry-run] would create ${bucket}/${thumbPath}`);
          return;
        }

        const { data, error } = await supabase.storage.from(bucket).download(obj.path);
        if (error || !data) {
          failed += 1;
          console.warn(`download failed ${bucket}/${obj.path}:`, error?.message);
          return;
        }
        const buffer = Buffer.from(await data.arrayBuffer());
        const thumb = await buildThumb(buffer, thumbSize);
        const { error: uploadError } = await supabase.storage.from(bucket).upload(thumbPath, thumb, {
          contentType: 'image/webp',
          cacheControl: '31536000',
          upsert: true,
        });
        if (uploadError) {
          failed += 1;
          console.warn(`upload failed ${bucket}/${thumbPath}:`, uploadError.message);
          return;
        }
        created += 1;
        bytesAdded += thumb.length;
        if (created % 25 === 0) {
          console.log(`…created ${created} thumbs (${Math.round(bytesAdded / 1024)} KB)`);
        }
      } catch (err) {
        failed += 1;
        console.warn(`error ${bucket}/${obj.path}:`, err?.message || err);
      }
    });

    if (processed >= opts.limit) break;
  }

  console.log(
    JSON.stringify(
      {
        dryRun: opts.dryRun,
        processed,
        created,
        skipped,
        failed,
        bytesAdded,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
