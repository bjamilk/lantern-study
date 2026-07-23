/**
 * Generates packages/shared/src/marketplace/campuses.ts and a SQL migration seed.
 * Source: NUC federal / state / private university directories + common polytechnics + city "Other" options.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseLines(block) {
  return block
    .trim()
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, city, state] = line.split('|').map((s) => s.trim());
      return { name, city, state };
    });
}

const federal = parseLines(`
Abubakar Tafawa Balewa University|Bauchi|Bauchi
Ahmadu Bello University|Zaria|Kaduna
Bayero University|Kano|Kano
Federal University Gashua|Gashua|Yobe
Federal University of Petroleum Resources|Effurun|Delta
Federal University of Technology, Akure|Akure|Ondo
Federal University of Technology, Minna|Minna|Niger
Federal University of Technology, Owerri|Owerri|Imo
Federal University Dutse|Dutse|Jigawa
Federal University Dutsin-Ma|Dutsin-Ma|Katsina
Federal University Kashere|Kashere|Gombe
Federal University Lafia|Lafia|Nasarawa
Federal University Lokoja|Lokoja|Kogi
Alex Ekwueme Federal University Ndufu-Alike|Ndufu-Alike|Ebonyi
Federal University Otuoke|Otuoke|Bayelsa
Federal University Oye-Ekiti|Oye-Ekiti|Ekiti
Federal University Wukari|Wukari|Taraba
Federal University Birnin Kebbi|Birnin Kebbi|Kebbi
Federal University Gusau|Gusau|Zamfara
Michael Okpara University of Agriculture|Umudike|Abia
Modibbo Adama University|Yola|Adamawa
National Open University of Nigeria|Abuja|FCT
Nigeria Police Academy|Wudil|Kano
Nigerian Defence Academy|Kaduna|Kaduna
Nnamdi Azikiwe University|Awka|Anambra
Obafemi Awolowo University|Ile-Ife|Osun
University of Abuja|Gwagwalada|FCT
Federal University of Agriculture, Abeokuta|Abeokuta|Ogun
Joseph Sarwuan Tarka University|Makurdi|Benue
University of Benin|Benin City|Edo
University of Calabar|Calabar|Cross River
University of Ibadan|Ibadan|Oyo
University of Ilorin|Ilorin|Kwara
University of Jos|Jos|Plateau
University of Lagos|Lagos|Lagos
University of Maiduguri|Maiduguri|Borno
University of Nigeria, Nsukka|Nsukka|Enugu
University of Port Harcourt|Port Harcourt|Rivers
University of Uyo|Uyo|Akwa Ibom
Usmanu Danfodiyo University|Sokoto|Sokoto
Nigerian Maritime University|Okerenkoko|Delta
Air Force Institute of Technology|Kaduna|Kaduna
Nigerian Army University|Biu|Borno
Federal University of Health Sciences, Otukpo|Otukpo|Benue
Federal University of Agriculture, Zuru|Zuru|Kebbi
Federal University of Technology, Babura|Babura|Jigawa
Federal University of Technology, Ikot Abasi|Ikot Abasi|Akwa Ibom
Federal University of Health Sciences, Azare|Azare|Bauchi
Federal University of Health Sciences, Ila Orangun|Ila Orangun|Osun
David Umahi Federal University of Medical Sciences|Uburu|Ebonyi
Admiralty University|Ibusa|Delta
Federal University of Transportation|Daura|Katsina
African Aviation and Aerospace University|Abuja|FCT
National University of Science and Technology|Abuja|FCT
Federal University of Agriculture, Bassambiri|Bassambiri|Bayelsa
Federal University of Health Sciences, Kwale|Kwale|Delta
Federal University of Health Sciences, Katsina|Katsina|Katsina
Federal University of Agriculture, Mubi|Mubi|Adamawa
Federal University of Education, Zaria|Zaria|Kaduna
Alvan Ikoku Federal University of Education|Owerri|Imo
Yusuf Maitama Sule Federal University of Education|Kano|Kano
Adeyemi Federal University of Education|Ondo|Ondo
Federal University of Allied Health Sciences|Enugu|Enugu
Federal University of Medicine and Medical Sciences|Abeokuta|Ogun
Federal University of Education, Pankshin|Pankshin|Plateau
Federal University of Education, Kontagora|Kontagora|Niger
University of Maritime Studies|Oron|Akwa Ibom
Federal University of Environment and Technology|Tai|Rivers
Federal University of Applied Sciences|Kachia|Kaduna
Tai Solarin Federal University of Education|Ijagun|Ogun
Federal University of Agriculture and Developmental Studies|Iragbiji|Osun
Federal University of Technology and Environmental Studies|Iyin-Ekiti|Ekiti
Federal University of Agriculture and Technology, Okeho|Okeho|Oyo
Federal University of Health Science and Technology|Tsafe|Zamfara
Federal University of Agriculture and Technology, Obio-Akpa|Obio-Akpa|Akwa Ibom
Federal University of Science and Technology, Epe|Epe|Lagos
Federal University of Science and Technology, Kabo|Kabo|Kano
`);

const state = parseLines(`
Rivers State University|Port Harcourt|Rivers
Ambrose Alli University|Ekpoma|Edo
Abia State University|Uturu|Abia
Ekiti State University|Ado-Ekiti|Ekiti
Enugu State University of Science and Technology|Enugu|Enugu
Olabisi Onabanjo University|Ago-Iwoye|Ogun
Lagos State University|Ojo|Lagos
Ladoke Akintola University of Technology|Ogbomoso|Oyo
Benue State University|Makurdi|Benue
Delta State University|Abraka|Delta
Imo State University|Owerri|Imo
Adekunle Ajasin University|Akungba|Ondo
Prince Abubakar Audu University|Anyigba|Kogi
Chukwuemeka Odumegwu Ojukwu University|Uli|Anambra
Ebonyi State University|Abakaliki|Ebonyi
Aliko Dangote University of Science and Technology|Wudil|Kano
Niger Delta University|Yenagoa|Bayelsa
Adamawa State University|Mubi|Adamawa
Nasarawa State University|Keffi|Nasarawa
University of Cross River State|Calabar|Cross River
Gombe State University|Gombe|Gombe
Kaduna State University|Kaduna|Kaduna
Ibrahim Badamasi Babangida University|Lapai|Niger
Plateau State University|Bokkos|Plateau
Yobe State University|Damaturu|Yobe
Kebbi State University of Science and Technology|Aliero|Kebbi
Umaru Musa Yar'adua University|Katsina|Katsina
Osun State University|Osogbo|Osun
Olusegun Agagu University of Science and Technology|Okitipupa|Ondo
Taraba State University|Jalingo|Taraba
Kwara State University|Malete|Kwara
Sokoto State University|Sokoto|Sokoto
Akwa Ibom State University|Ikot Akpaden|Akwa Ibom
Ignatius Ajuru University of Education|Port Harcourt|Rivers
Bauchi State University|Gadau|Bauchi
Northwest University|Kano|Kano
First Technical University|Ibadan|Oyo
Sule Lamido University|Kafin Hausa|Jigawa
University of Medical Sciences|Ondo|Ondo
Edo State University|Iyamho|Edo
Kingsley Ozumba Mbadiwe University|Ogboko|Imo
University of Africa|Toru-Orua|Bayelsa
Kashim Ibrahim University|Maiduguri|Borno
Moshood Abiola University of Science and Technology|Abeokuta|Ogun
Zamfara State University|Talata Mafara|Zamfara
Bayelsa Medical University|Yenagoa|Bayelsa
University of Agriculture and Environmental Sciences|Umuagwo|Imo
Confluence University of Science and Technology|Osara|Kogi
Bamidele Olumilua University of Education, Science and Technology|Ikere|Ekiti
University of Delta|Agbor|Delta
Delta University of Science and Technology|Ozoro|Delta
Dennis Osadebay University|Asaba|Delta
Lagos State University of Education|Ijanikin|Lagos
Lagos State University of Science and Technology|Ikorodu|Lagos
Shehu Shagari University of Education|Sokoto|Sokoto
State University of Medical and Applied Sciences|Igbo-Eno|Enugu
University of Ilesa|Ilesa|Osun
Emmanuel Alayande University of Education|Oyo|Oyo
Kogi State University|Kabba|Kogi
AbdulKadir Kure University|Minna|Niger
Kwara State University of Education|Ilorin|Kwara
Abdulsalam Abubakar University of Agriculture and Climate Action|Mokwa|Niger
Ebonyi State University of ICT, Science and Technology|Oferekpe|Ebonyi
Cross River University of Education and Entrepreneurship|Akamkpa|Cross River
Benue State University of Agriculture, Science and Technology|Ihugh|Benue
University of Aeronautics and Aerospace Engineering|Ezza|Ebonyi
University of Innovation, Science and Technology|Omuma|Imo
`);

const privateUnis = parseLines(`
Babcock University|Ilishan-Remo|Ogun
Igbinedion University|Okada|Edo
Madonna University|Okija|Anambra
Bowen University|Iwo|Osun
Benson Idahosa University|Benin City|Edo
Covenant University|Ota|Ogun
Pan-Atlantic University|Lekki|Lagos
American University of Nigeria|Yola|Adamawa
Ajayi Crowther University|Oyo|Oyo
Al-Hikmah University|Ilorin|Kwara
Al-Qalam University|Katsina|Katsina
Bells University of Technology|Ota|Ogun
Bingham University|Karu|Nasarawa
Caritas University|Enugu|Enugu
Crawford University|Igbesa|Ogun
Crescent University|Abeokuta|Ogun
Kwararafa University|Wukari|Taraba
Lead City University|Ibadan|Oyo
Novena University|Ogume|Delta
Redeemer's University|Ede|Osun
Renaissance University|Enugu|Enugu
University of Mkar|Mkar|Benue
Joseph Ayo Babalola University|Ikeji-Arakeji|Osun
Achievers University|Owo|Ondo
Caleb University|Imota|Lagos
Fountain University|Osogbo|Osun
African University of Science and Technology|Abuja|FCT
Obong University|Obong Ntak|Akwa Ibom
Salem University|Lokoja|Kogi
Tansian University|Umunya|Anambra
Veritas University|Abuja|FCT
Wesley University|Ondo|Ondo
Western Delta University|Oghara|Delta
Afe Babalola University|Ado-Ekiti|Ekiti
Godfrey Okoye University|Enugu|Enugu
Nile University of Nigeria|Abuja|FCT
Oduduwa University|Ipetumodu|Osun
Paul University|Awka|Anambra
Rhema University|Obeama-Asa|Rivers
Wellspring University|Evbuobanosa|Edo
Adeleke University|Ede|Osun
Baze University|Abuja|FCT
Landmark University|Omu-Aran|Kwara
Glorious Vision University|Ogwa|Edo
Elizade University|Ilara-Mokin|Ondo
Evangel University|Akaeze|Ebonyi
Gregory University|Uturu|Abia
McPherson University|Seriki Sotayo|Ogun
Southwestern University|Okun Owa|Ogun
Augustine University|Ilara|Lagos
Chrisland University|Abeokuta|Ogun
Edwin Clark University|Kaigbodo|Delta
Hallmark University|Ijebu-Itele|Ogun
Hezekiah University|Umudi|Imo
Kings University|Ode-Omu|Osun
Michael and Cecilia Ibru University|Agbarha-Otor|Delta
Mountain Top University|Makogi-Oba|Ogun
Ritman University|Ikot Ekpene|Akwa Ibom
Summit University|Offa|Kwara
Christopher University|Mowe|Ogun
Kola Daisi University|Ibadan|Oyo
Anchor University|Ayobo|Lagos
Dominican University|Ibadan|Oyo
Legacy University|Okija|Anambra
Arthur Jarvis University|Akpabuyo|Cross River
Ojaja University|Eiyenkorin|Kwara
Coal City University|Enugu|Enugu
Clifford University|Owerrinta|Abia
Spiritan University|Nneochi|Abia
Precious Cornerstone University|Oyo|Oyo
PAMO University of Medical Sciences|Port Harcourt|Rivers
Atiba University|Oyo|Oyo
Eko University of Medical and Health Sciences|Ijanikin|Lagos
Skyline University|Kano|Kano
Greenfield University|Kaduna|Kaduna
Dominion University|Ibadan|Oyo
Trinity University|Yaba|Lagos
Westland University|Iwo|Osun
Topfaith University|Mkpatak|Akwa Ibom
Thomas Adewumi University|Oko-Irese|Kwara
Maranatha University|Lagos|Lagos
Ave Maria University|Piyanko|Nasarawa
Al-Istiqama University|Sumaila|Kano
Mudiame University|Irrua|Edo
Havilla University|Nde-Ikom|Cross River
Claretian University of Nigeria|Nekede|Imo
Karl-Kumm University|Vom|Plateau
James Hope University|Lekki|Lagos
Maryam Abacha American University of Nigeria|Kano|Kano
Capital City University|Kano|Kano
Ahman Pategi University|Patigi|Kwara
University of Offa|Offa|Kwara
Mewar International University|Masaka|Nasarawa
Edusoko University|Bida|Niger
Philomath University|Kuje|FCT
Khadija University|Majia|Jigawa
ANAN University|Kwall|Plateau
North Eastern University|Gombe|Gombe
Al-Ansar University|Maiduguri|Borno
Margaret Lawrence University|Umunede|Delta
Khalifa Isiyaku Rabiu University|Kano|Kano
Sports University|Idumuje-Ugboko|Delta
Baba Ahmed University|Kano|Kano
Saisa University of Medical Sciences and Technology|Sokoto|Sokoto
Nigerian British University|Asa|Abia
Peter University|Achina-Onneh|Anambra
Newgate University|Minna|Niger
European University of Nigeria|Duboyi|FCT
Northwest University Sokoto|Sokoto|Sokoto
Rayhaan University|Birnin Kebbi|Kebbi
Muhammad Kamalud-Deen University|Ilorin|Kwara
Sam Maris University|Supare|Ondo
Aletheia University|Ago-Iwoye|Ogun
Lux Mundi University|Umuahia|Abia
Maduka University|Ekwegbe|Enugu
Peaceland University|Enugu|Enugu
Amadeus University|Amizi|Abia
Vision University|Ikogbo|Ogun
Azman University|Kano|Kano
Huda University|Gusau|Zamfara
Franco British International University|Kaduna|Kaduna
Canadian University of Nigeria|Abuja|FCT
Gerar University of Medical Science|Imope-Ijebu|Ogun
British Canadian University|Obudu|Cross River
Hensard University|Toru-Orua|Bayelsa
Amaj University|Kwali|FCT
Phoenix University|Agwada|Nasarawa
Wigwe University|Isiokpo|Rivers
Hillside University of Science and Technology|Okemesi|Ekiti
University on the Niger|Umunya|Anambra
Elrazi Medical University|Yargaya|Kano
Venite University|Iloro-Ekiti|Ekiti
Shanahan University|Onitsha|Anambra
The Duke Medical University|Calabar|Cross River
Mercy Medical University|Iwo|Osun
Cosmopolitan University|Abuja|FCT
Miva Open University|Abuja|FCT
Iconic Open University|Sokoto|Sokoto
West Midlands Open University|Ibadan|Oyo
Al-Muhibbah Open University|Abuja|FCT
El-Amin University|Minna|Niger
College of Petroleum and Energy Studies|Kaduna|Kaduna
Jewel University|Gombe|Gombe
Prime University|Kuje|FCT
Nigerian University of Technology and Management|Apapa|Lagos
Al-Bayan University|Ankpa|Kogi
Lighthouse University|Evbobanosa|Edo
African University of Economics|Abuja|FCT
New City University|Ayetoro|Ogun
University of Fortune|Igbotako|Ondo
Eranova University|Abuja|FCT
Minaret University|Ikirun|Osun
Abdulrasaq Abubakar Toyin University|Ilorin|Kwara
Southern Atlantic University|Uyo|Akwa Ibom
Lens University|Ilemona|Kwara
Monarch University|Iyesi-Ota|Ogun
Tonine Iredia University of Communication|Benin City|Edo
Isaac Balami University of Aeronautics and Management|Lagos|Lagos
Kevin Eze University|Mgbowo|Enugu
Tazkiyah University|Kaduna|Kaduna
Leadership University|Abuja|FCT
Jimoh Babalola University|Ilorin|Kwara
Bridget University|Mbaise|Imo
Greenland University|Jalingo|Taraba
JEFAP University|Suleja|Niger
Azione Verde University|Amaigbo|Imo
Unique Open University|Ojo|Lagos
American Open University|Abeokuta|Ogun
`);

const polys = parseLines(`
Yaba College of Technology|Yaba|Lagos
Federal Polytechnic, Ilaro|Ilaro|Ogun
Federal Polytechnic, Nekede|Nekede|Imo
Federal Polytechnic, Ado-Ekiti|Ado-Ekiti|Ekiti
Auchi Polytechnic|Auchi|Edo
Lagos State Polytechnic|Ikorodu|Lagos
Moshood Abiola Polytechnic|Abeokuta|Ogun
The Polytechnic, Ibadan|Ibadan|Oyo
Kwara State Polytechnic|Ilorin|Kwara
Ken Saro-Wiwa Polytechnic|Bori|Rivers
Lagos University Teaching Hospital|Idi-Araba|Lagos
`);

const otherCities = parseLines(`
Lagos|Lagos|Lagos
Abuja|Abuja|FCT
Ibadan|Ibadan|Oyo
Kano|Kano|Kano
Port Harcourt|Port Harcourt|Rivers
Benin City|Benin City|Edo
Kaduna|Kaduna|Kaduna
Enugu|Enugu|Enugu
Abeokuta|Abeokuta|Ogun
Ilorin|Ilorin|Kwara
Jos|Jos|Plateau
Calabar|Calabar|Cross River
Uyo|Uyo|Akwa Ibom
Owerri|Owerri|Imo
Warri|Warri|Delta
Onitsha|Onitsha|Anambra
Aba|Aba|Abia
Maiduguri|Maiduguri|Borno
Sokoto|Sokoto|Sokoto
Akure|Akure|Ondo
Osogbo|Osogbo|Osun
Awka|Awka|Anambra
Asaba|Asaba|Delta
Makurdi|Makurdi|Benue
Minna|Minna|Niger
Gombe|Gombe|Gombe
Bauchi|Bauchi|Bauchi
Yenagoa|Yenagoa|Bayelsa
Lokoja|Lokoja|Kogi
Jalingo|Jalingo|Taraba
Abakaliki|Abakaliki|Ebonyi
Umuahia|Umuahia|Abia
Katsina|Katsina|Katsina
Dutse|Dutse|Jigawa
Damaturu|Damaturu|Yobe
Birnin Kebbi|Birnin Kebbi|Kebbi
Gusau|Gusau|Zamfara
Lafia|Lafia|Nasarawa
Yola|Yola|Adamawa
`);

function toCampus(row, kind) {
  return {
    name: row.name,
    city: row.city,
    state: row.state,
    country_code: 'NG',
    slug: slugify(row.name),
    kind,
  };
}

const all = [
  ...federal.map((r) => toCampus(r, 'federal')),
  ...state.map((r) => toCampus(r, 'state')),
  ...privateUnis.map((r) => toCampus(r, 'private')),
  ...polys.map((r) => toCampus(r, 'polytechnic')),
  ...otherCities.map((r) =>
    toCampus(
      { name: `Other — ${r.city}`, city: r.city, state: r.state },
      'other-city'
    )
  ),
  {
    name: 'Other (city in Nigeria)',
    city: 'Nigeria',
    state: 'Nigeria',
    country_code: 'NG',
    slug: 'other-city-nigeria',
    kind: 'other',
  },
];

const seen = new Set();
const unique = [];
for (const campus of all) {
  let slug = campus.slug;
  let n = 2;
  while (seen.has(slug)) {
    slug = `${campus.slug}-${n++}`;
  }
  seen.add(slug);
  unique.push({ ...campus, slug });
}

const tsPath = path.join(root, 'packages/shared/src/marketplace/campuses.ts');
const sqlPath = path.join(
  root,
  'supabase/migrations/20260721090000_expand_nigeria_marketplace_campuses.sql'
);

const tsRows = unique
  .map(
    (c) =>
      `  { name: ${JSON.stringify(c.name)}, city: ${JSON.stringify(c.city)}, state: ${JSON.stringify(c.state)}, country_code: 'NG', slug: ${JSON.stringify(c.slug)} },`
  )
  .join('\n');

const ts = `import type { NigerianGeopoliticalZone } from './zones';
export type { NigerianGeopoliticalZone } from './zones';
export {
  NIGERIAN_GEOPOLITICAL_ZONES,
  resolveNigerianGeopoliticalZone,
} from './zones';

export interface MarketplaceCampus {
  id: string;
  name: string;
  city: string;
  state: string;
  country_code: string;
  slug: string;
  geopolitical_zone?: NigerianGeopoliticalZone | null;
}

/** Special campus for free-text city when the user's school/city is not listed. */
export const OTHER_CITY_CAMPUS_SLUG = 'other-city-nigeria';

/** Seed campuses for Nigeria — synced with DB migration (NUC federal/state/private + polytechnics + city Others). */
export const NIGERIA_MARKETPLACE_CAMPUSES: Omit<MarketplaceCampus, 'id'>[] = [
${tsRows}
];

export function formatCampusLabel(campus: Pick<MarketplaceCampus, 'name' | 'city'>): string {
  return campus.city ? \`\${campus.name} (\${campus.city})\` : campus.name;
}

export function isOtherCityCampus(
  campus: { slug?: string; name: string } | null | undefined
): boolean {
  if (!campus) return false;
  return campus.slug === OTHER_CITY_CAMPUS_SLUG || campus.name === 'Other (city in Nigeria)';
}

export function filterCampusesByQuery<T extends { name: string; city: string; state?: string }>(
  campuses: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return campuses;
  return campuses.filter((campus) => {
    const hay = \`\${campus.name} \${campus.city} \${campus.state || ''}\`.toLowerCase();
    return hay.includes(q);
  });
}
`;

const sqlValues = unique
  .map(
    (c) =>
      `  (${esc(c.name)}, ${esc(c.city)}, ${esc(c.state)}, 'NG', ${esc(c.slug)})`
  )
  .join(',\n');

function esc(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

const sql = `-- Expand Nigerian marketplace campuses (NUC universities + polytechnics + city "Other" options).
-- Idempotent via ON CONFLICT (slug).

INSERT INTO marketplace_campuses (name, city, state, country_code, slug) VALUES
${sqlValues}
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  country_code = EXCLUDED.country_code,
  active = TRUE;
`;

fs.writeFileSync(tsPath, ts);
fs.writeFileSync(sqlPath, sql);
console.log(`Wrote ${unique.length} campuses to:`);
console.log(`  ${tsPath}`);
console.log(`  ${sqlPath}`);
