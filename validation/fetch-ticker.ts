/**
 * Part B: dated reports of the Swiss Pilz-Ticker (passion-pilze-sammeln.com), counted per week. Only the dates and
 * a "nothing found / too dry" flag are kept; no report text is stored.
 *   npx tsx validation/fetch-ticker.ts   → validation/results/ticker.json
 * Pages are cached in validation/cache/ticker/ and fetched 1 s apart.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = import.meta.dirname;
const CACHE = join(DIR, 'cache', 'ticker');
mkdirSync(CACHE, { recursive: true });
const BASE = 'https://www.passion-pilze-sammeln.com';
const MONTHS = [
  'januar',
  'februar',
  'märz',
  'april',
  'mai',
  'juni',
  'juli',
  'august',
  'september',
  'oktober',
  'november',
  'dezember',
];
const NEGATIVE =
  /keine pilze|kein einziger|nichts gefunden|fast nichts|kaum pilze|kaum etwas|zu trocken|trockenheit|staubtrocken|leer/i;

async function page(name: string): Promise<string> {
  const path = join(CACHE, name);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  await new Promise((r) => setTimeout(r, 1000));
  const res = await fetch(`${BASE}/${name}`, {
    headers: { 'User-Agent': 'MushroomFinder validation (counts report dates only)' },
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(path, text);
  return text;
}

const toText = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&auml;/g, 'ä')
    .replace(/&ouml;/g, 'ö')
    .replace(/&uuml;/g, 'ü')
    .replace(/\s+/g, ' ');

const index = await page('pilztickerarchiv_schweiz.html');
const names = [
  ...new Set(
    [...index.matchAll(/pilzticker_schweiz_(\d+)\.html/g)].map(
      (m) => `pilzticker_schweiz_${m[1]}.html`,
    ),
  ),
];
names.push('pilz-ticker-schweiz.html');

const reports: { date: string; negative: boolean }[] = [];
for (const n of names) {
  const t = toText(await page(n));
  // "Name schreibt am 24. April 2018: »…«" – the text until the next report.
  const re = /schreibt am (\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\s+(20\d\d)\s*:/g;
  const hits = [...t.matchAll(re)];
  hits.forEach((m, k) => {
    const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
    if (month < 1) return;
    const body = t
      .slice(m.index! + m[0].length, hits[k + 1]?.index ?? m.index! + 1500)
      .slice(0, 1500);
    reports.push({
      date: `${m[3]}-${String(month).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`,
      negative: NEGATIVE.test(body),
    });
  });
}
const unique = [...new Map(reports.map((r, i) => [`${r.date}|${i}`, r])).values()];
const weekOf = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
};
const weekly: Record<string, { reports: number; negative: number }> = {};
for (const r of unique) {
  const w = (weekly[weekOf(r.date)] ??= { reports: 0, negative: 0 });
  w.reports++;
  if (r.negative) w.negative++;
}
const byYear: Record<string, number> = {};
for (const r of unique) byYear[r.date.slice(0, 4)] = (byYear[r.date.slice(0, 4)] ?? 0) + 1;
writeFileSync(
  join(DIR, 'results', 'ticker.json'),
  JSON.stringify({
    source: `${BASE}/pilztickerarchiv_schweiz.html`,
    fetched: new Date().toISOString(),
    pages: names.length,
    byYear,
    weekly,
  }),
);
console.log(`${names.length} pages, ${unique.length} dated reports`, byYear);
