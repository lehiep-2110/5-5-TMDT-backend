#!/usr/bin/env node
// Generate SVG cover + insert book_images row for any book without an image.
// Reuses the seed script's SVG style.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads', 'books');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Load env from be/.env if not already set
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const COVER_PALETTE = [
  '#1F2937', '#7C2D12', '#14532D', '#111827', '#7F1D1D',
  '#312E81', '#134E4A', '#78350F', '#1E293B', '#4C1D95',
];

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function xmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function wrapTitle(title, maxChars = 14, maxLines = 4) {
  const words = String(title).split(/\s+/);
  const lines = [];
  let current = '';
  for (const w of words) {
    if (!current.length) current = w;
    else if ((current + ' ' + w).length <= maxChars) current = current + ' ' + w;
    else { lines.push(current); current = w; if (lines.length >= maxLines) break; }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function buildCoverSvg(title, author) {
  const bg = COVER_PALETTE[hashString(title) % COVER_PALETTE.length];
  const titleLines = wrapTitle(title, 14, 4);
  const lineHeight = 64;
  const titleBlockHeight = titleLines.length * lineHeight;
  const titleStartY = 400 - titleBlockHeight / 2 + 50;
  const tspans = titleLines
    .map((ln, i) => `<tspan x="300" dy="${i === 0 ? 0 : lineHeight}">${xmlEscape(ln)}</tspan>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
  <rect width="600" height="800" fill="${bg}"/>
  <rect x="28" y="28" width="544" height="744" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
  <text x="300" y="120" text-anchor="middle" fill="#ffffff" font-family="Georgia, serif" font-size="16" letter-spacing="2" opacity="0.8" style="text-transform:uppercase;">${xmlEscape(String(author).toUpperCase())}</text>
  <line x1="200" y1="150" x2="400" y2="150" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>
  <text x="300" y="${titleStartY}" text-anchor="middle" fill="#ffffff" font-family="Georgia, serif" font-size="44" font-weight="700">${tspans}</text>
  <text x="300" y="740" text-anchor="middle" fill="#ffffff" font-family="Georgia, serif" font-size="12" letter-spacing="4" opacity="0.7">THE EDITORIAL</text>
</svg>
`;
}

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5434),
  database: process.env.DB_NAME || 'bookstore',
  user: process.env.DB_USER || 'bookstore',
  password: process.env.DB_PASSWORD || 'bookstore',
});

const sql = await pool.query(`
  SELECT b.id, b.title, b.slug,
         COALESCE((SELECT a.name FROM authors a
                   JOIN book_authors ba ON ba.author_id = a.id
                   WHERE ba.book_id = b.id LIMIT 1), 'The Editorial') AS author
  FROM books b
  LEFT JOIN book_images bi ON bi.book_id = b.id
  GROUP BY b.id
  HAVING COUNT(bi.id) = 0
  ORDER BY b.created_at;
`);

if (sql.rows.length === 0) {
  console.log('All books already have at least one image. Nothing to do.');
  await pool.end();
  process.exit(0);
}

console.log(`Found ${sql.rows.length} book(s) missing cover image:`);
for (const row of sql.rows) {
  const filename = `${row.slug}.svg`;
  const fullpath = path.join(UPLOADS_DIR, filename);
  const url = `/uploads/books/${filename}`;
  fs.writeFileSync(fullpath, buildCoverSvg(row.title, row.author));
  await pool.query(
    `INSERT INTO book_images (id, book_id, image_url, is_primary, display_order)
     VALUES (gen_random_uuid(), $1, $2, true, 0)`,
    [row.id, url],
  );
  console.log(`  + ${row.slug.padEnd(40)} → ${url}`);
}

console.log(`\nDone. Wrote ${sql.rows.length} SVG cover(s) and inserted ${sql.rows.length} book_images row(s).`);
await pool.end();
