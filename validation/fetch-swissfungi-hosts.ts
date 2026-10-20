/**
 * Host trees from SwissFungi (WSL, Swiss National Fungi Databank): per species, the number of Swiss records with
 * each mycorrhizal partner ("byMykoPartner") or host plant ("byHostPlant"), as shown in the SwissFungi
 * distribution map (https://www.wsl.ch/map_fungi). Counts only; all years.
 *   npx tsx validation/fetch-swissfungi-hosts.ts   → validation/data/swissfungi-hosts.json
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://www.wsl.ch/map_fungi/rest/diagram/observations';
/** App species → SwissFungi taxon ids (current names; Armillaria: the two common species; morels: both groups). */
const TAXA: Record<string, Record<string, number>> = {
  chanterelle: { 'Cantharellus cibarius': 744 },
  porcini: { 'Boletus edulis': 547 },
  winter_chanterelle: { 'Craterellus tubaeformis': 27098 },
  horn_of_plenty: { 'Craterellus cornucopioides': 1951 },
  bay_bolete: { 'Imleria badia': 29648 },
  hedgehog: { 'Hydnum repandum': 3161 },
  honey_fungus: { 'Armillaria mellea': 312, 'Armillaria ostoyae': 313 },
  parasol: { 'Macrolepiota procera': 4502 },
  morel: { 'Morchella esculenta': 4737, 'Morchella elata': 4736 },
};

const out: Record<
  string,
  {
    taxa: Record<string, number>;
    myko: Record<string, number>;
    host: Record<string, number>;
    substrate: Record<string, number>;
  }
> = {};
for (const [id, taxa] of Object.entries(TAXA)) {
  const sum = {
    myko: {} as Record<string, number>,
    host: {} as Record<string, number>,
    substrate: {} as Record<string, number>,
  };
  for (const taxonId of Object.values(taxa)) {
    for (const [key, path] of [
      ['myko', 'byMykoPartner'],
      ['host', 'byHostPlant'],
      ['substrate', 'bySubstrateCoarse'],
    ] as const) {
      const rows = (await (
        await fetch(`${API}/${path}/${taxonId}?startyear=1800&endyear=2026&lang=de`)
      ).json()) as { count: string; label: string }[];
      for (const r of rows) sum[key][r.label] = (sum[key][r.label] ?? 0) + Number(r.count);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  out[id] = { taxa, ...sum };
  const top = Object.entries(sum.myko)
    .filter(([k]) => k !== 'keine Angabe')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const topHost = Object.entries(sum.host)
    .filter(([k]) => k !== 'keine Angabe')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  console.log(
    id.padEnd(19),
    'myko:',
    top.map(([k, v]) => `${k} ${v}`).join(', '),
    '| host:',
    topHost.map(([k, v]) => `${k} ${v}`).join(', '),
  );
}
writeFileSync(
  join(import.meta.dirname, 'data', 'swissfungi-hosts.json'),
  JSON.stringify(
    {
      source:
        'SwissFungi distribution map, WSL (https://www.wsl.ch/map_fungi), diagram endpoints byMykoPartner / byHostPlant / bySubstrateCoarse',
      fetched: new Date().toISOString().slice(0, 10),
      species: out,
    },
    null,
    1,
  ),
);
