// Fictional customers. Domains use the reserved .example TLD so nothing points at a real site.

const FIRST = ['Ingrid', 'Ola', 'Sofie', 'Henrik', 'Maja', 'Jonas', 'Nora', 'Emil', 'Thea', 'Lars', 'Ida', 'Magnus', 'Selma', 'Tobias', 'Astrid', 'Sander'];
const LAST = ['Berg', 'Hansen', 'Dahl', 'Lund', 'Moen', 'Strand', 'Haugen', 'Bakke', 'Nygaard', 'Solberg', 'Vik', 'Eide'];
const COMPANIES = [
  ['Fjordlys Bakeri', 'fjordlys-bakeri'],
  ['Nordkapp Regnskap', 'nordkapp-regnskap'],
  ['Granitt Arkitekter', 'granitt-arkitekter'],
  ['Polar Sykkel', 'polar-sykkel'],
  ['Lysaker Tannklinikk', 'lysaker-tannklinikk'],
  ['Brygga Kaffebar', 'brygga-kaffebar'],
  ['Vestvind Reiser', 'vestvind-reiser'],
  ['Elvebakken Advokater', 'elvebakken-advokater'],
  ['Hvalen Fiskeutsalg', 'hvalen-fiskeutsalg'],
  ['Tindetopp Klatring', 'tindetopp-klatring'],
];

/** A fresh customer with its line, hosted server and addresses. `r` is from makeRandom(). */
export function makeCustomer(r, used) {
  let company;
  do company = r.pick(COMPANIES);
  while (used.has(company[1]) && used.size < COMPANIES.length);
  used.add(company[1]);
  const [name, slug] = company;
  const domain = `${slug}.example`;
  const ip = () => `${r.int(1, 254)}`;
  return {
    id: `CU-${r.int(10000, 99999)}`,
    name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
    company: name,
    domain,
    site: `www.${domain}`,
    serverName: `srv01.${domain}`,
    wanIp: `85.${r.int(160, 199)}.${ip()}.${ip()}`,
    serverIp: `185.41.${r.int(10, 60)}.${ip()}`,
    oldServerIp: `185.41.${r.int(61, 99)}.${ip()}`,
    rdpPort: r.pick([3389, 22]),
  };
}
