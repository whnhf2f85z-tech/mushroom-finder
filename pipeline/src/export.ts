import type { Reserve, Spot } from '@mf/scoring';

/** The folders and styles of the original pilze-schwyz.kml, in order. */
export const GROUPS = [
  {
    name: 'Eierschwämme & Trompetenpfifferlinge',
    style: 'eierschwamm',
    species: ['chanterelle', 'winter_chanterelle', 'bay_bolete'],
  },
  { name: 'Steinpilze (end of season)', style: 'steinpilz', species: ['porcini'] },
  {
    name: 'Totentrompeten, Semmelstoppelpilze, Hallimasch (beech, lower)',
    style: 'buche',
    species: ['horn_of_plenty', 'hedgehog', 'honey_fungus', 'parasol', 'morel'],
  },
] as const;
export const RESERVE_FOLDER = 'No picking – reserves (approximate)';

const STYLES: Record<string, string> = {
  eierschwamm: 'ylw-circle',
  steinpilz: 'orange-circle',
  buche: 'purple-circle',
  achtung: 'red-stars',
};

/** German plural names, as in the original "Pilz" field. */
const GERMAN_PLURAL: Record<string, string> = {
  chanterelle: 'Eierschwämme',
  winter_chanterelle: 'Trompetenpfifferlinge',
  porcini: 'Steinpilze',
  horn_of_plenty: 'Totentrompeten',
  hedgehog: 'Semmelstoppelpilze',
  honey_fungus: 'Hallimasch',
  bay_bolete: 'Maronenröhrlinge',
  parasol: 'Parasole',
  morel: 'Morcheln',
};

/** Spots per group; a spot goes to the group of its first species hint (the beech group if it has none). */
export function groupSpots(spots: Spot[]): { group: (typeof GROUPS)[number]; spots: Spot[] }[] {
  return GROUPS.map((group) => ({
    group,
    spots: spots.filter((s) => {
      const first = s.species_hint[0];
      const g =
        GROUPS.find((x) => (x.species as readonly string[]).includes(first ?? '')) ?? GROUPS[2];
      return g === group;
    }),
  }));
}

const xml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const band = (s: Spot) => `${s.elevation_band.min}–${s.elevation_band.max} m`;

export function toKml(spots: Spot[], reserves: Reserve[]): string {
  const styles = Object.entries(STYLES)
    .map(
      ([id, icon]) =>
        `  <Style id="${id}"><IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/${icon}.png</href></Icon></IconStyle></Style>`,
    )
    .join('\n');
  const placemark = (
    name: string,
    description: string,
    data: [string, string][],
    style: string,
    lat: number,
    lon: number,
  ) =>
    `    <Placemark>
      <name>${xml(name)}</name>
      <description>${xml(description)}</description>
      <ExtendedData>${data.map(([k, v]) => `<Data name="${xml(k)}"><value>${xml(v)}</value></Data>`).join('')}</ExtendedData>
      <styleUrl>#${style}</styleUrl>
      <Point><coordinates>${lon},${lat},0</coordinates></Point>
    </Placemark>`;
  const folders = groupSpots(spots)
    .filter((g) => g.spots.length)
    .map(
      ({ group, spots: list }) => `  <Folder>
    <name>${xml(group.name)}</name>
${list
  .map((s) =>
    placemark(
      s.name,
      s.notes,
      [
        ['Pilz', s.species_hint.map((id) => GERMAN_PLURAL[id] ?? id).join(' / ')],
        ['Höhe', band(s)],
      ],
      group.style,
      s.lat,
      s.lon,
    ),
  )
  .join('\n')}
  </Folder>`,
    );
  const reserveFolder = `  <Folder>
    <name>${xml(RESERVE_FOLDER)}</name>
${reserves.map((r) => placemark(r.name, r.notes, [['Pilz', 'Verbot']], 'achtung', r.lat, r.lon)).join('\n')}
  </Folder>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Pilze Schwyz – Herbst 2026</name>
  <description>Candidate mushroom areas in canton Schwyz, grouped by mushroom type. Pins mark areas, not exact spots; they were checked against the federal forest map, the terrain model and the cantonal reserves. Rules: max 2 kg per person per day, no picking in nature reserves. Generated from data/spots.json (npm run export:spots).</description>

${styles}

${[...folders, reserveFolder].join('\n\n')}
</Document>
</kml>
`;
}

export function toText(spots: Spot[], reserves: Reserve[], date: string): string {
  const lines = [`Pilze Schwyz – spots (generated from data/spots.json on ${date})`, ''];
  for (const { group, spots: list } of groupSpots(spots)) {
    if (!list.length) continue;
    lines.push(group.name);
    for (const s of list) lines.push(`- ${s.name} | ${band(s)} | ${s.lat}, ${s.lon}`);
    lines.push('');
  }
  lines.push(RESERVE_FOLDER);
  for (const r of reserves) lines.push(`- ${r.name} | ${r.lat}, ${r.lon}`);
  return lines.join('\n') + '\n';
}
