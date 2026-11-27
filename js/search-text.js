// Shared street-key normalization for address shards and search.
const CANON = {
  street: 'st', st: 'st', str: 'st', saint: 'st', ste: 'ste', sainte: 'ste',
  avenue: 'ave', ave: 'ave', av: 'ave', road: 'rd', rd: 'rd', boulevard: 'blvd', blvd: 'blvd', boul: 'blvd',
  drive: 'dr', dr: 'dr', crescent: 'cres', cres: 'cres', cr: 'cres', court: 'ct', ct: 'ct', place: 'pl', pl: 'pl',
  square: 'sq', sq: 'sq', terrace: 'ter', ter: 'ter', terr: 'ter', lane: 'ln', ln: 'ln', gardens: 'gdns', gdns: 'gdns',
  gate: 'gt', gt: 'gt', circle: 'cir', cir: 'cir', crcl: 'cir', parkway: 'pkwy', pkwy: 'pkwy', highway: 'hwy', hwy: 'hwy',
  expressway: 'expy', expy: 'expy', trail: 'trl', trl: 'trl', heights: 'hts', hts: 'hts', grove: 'grv', grv: 'grv',
  east: 'e', e: 'e', west: 'w', w: 'w', north: 'n', n: 'n', south: 's', s: 's',
  mount: 'mt', mt: 'mt', market: 'mkt', mkt: 'mkt', centre: 'ctr', center: 'ctr', ctr: 'ctr', cntr: 'ctr',
  park: 'pk', pk: 'pk', university: 'univ', univ: 'univ', station: 'stn', stn: 'stn', hospital: 'hosp', hosp: 'hosp',
  church: 'ch', ch: 'ch', public: 'pub', school: 'sch', sch: 'sch', building: 'bldg', bldg: 'bldg', and: 'and'
};
const STOP = new Set(['the', 'of']);
/** Lower case, accents and punctuation off, the stop words dropped: the words of a name. */
export function words(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter((w) => w && !STOP.has(w));
}
/** The canonical tokens of a name (index side). */
export function tokens(s) { return words(s).map((w) => Object.hasOwn(CANON, w) ? CANON[w] : w); }
/** One normalised key for a name (dedupe, outside-the-map lookups). */
export const key = (s) => tokens(s).join(' ');
