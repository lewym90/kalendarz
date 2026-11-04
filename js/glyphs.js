// Ikonki wpisów: numer pola w arkuszu img/ikonki.webp (8 × 8) dobierany z treści, a gdy nic nie pasuje, z kategorii.
const norm = (s) => (s || '').toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => ({ ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }[c]));

const RULES = [
  [/\b(silowni|trening|fitness|crossfit|sztang)/, 0], [/\b(bieg|jogging|parkrun|maraton)/, 1], [/\b(rower|kolarz)/, 2], [/\b(basen|plywa|aquapark)/, 3],
  [/\b(mecz|pilk|futbol|orlik)/, 4], [/\b(tenis|squash|padel|badminton)/, 5], [/\b(wycieczk|gory|szlak|trekking|wedrowk)/, 6], [/\b(joga|yoga|medytac|pilates)/, 7],
  [/\b(dentyst|stomatolog|zab)/, 8], [/\b(lekarz|przychodni|internist|wizyt\w* u)/, 9], [/\b(tabletk|leki?\b|apteka|recept)/, 10], [/\b(badani|kardiolog|morfologi|usg|rezonans)/, 11],
  [/\b(szczepi|krew|krwi|pobrani)/, 12], [/\b(okulist|optyk|okular)/, 13], [/\b(fryzjer|barber|strzyzeni)/, 14], [/\b(spa|masaz|kosmetycz|manicure|paznok)/, 15],
  [/\b(praca|pracy|biuro|dyzur|sluzb|zmiana)\b/, 16], [/\b(komputer|laptop|kod|programow|aplikacj)/, 17], [/\b(telefon|zadzwon|rozmow)/, 18], [/\b(mail|e-mail|poczt|list\b|odpisa)/, 19],
  [/\b(dokument|urzad|wniosek|umow|papier|ksiegow)/, 20], [/\b(prezentac|szkoleni|webinar|konferencj)/, 21], [/\b(spotkani|klient|narad|zebrani)/, 22], [/\b(szkol|kurs|egzamin|studi|nauka|lekcj)/, 23],
  [/\b(lunch|obiad|kolacj|restaurac|pizza|sniadani|burger|sushi)/, 24], [/\b(kaw|kawiarni|espresso)/, 25], [/\b(wino|piwo|pub|drink|impreza)/, 26], [/\b(zakup|sklep|biedronk|lidl|kaufland|auchan|dino|zabk)/, 27],
  [/\b(galeri|ubrani|buty|ikea)/, 28], [/\b(urodzin|imienin|rocznic)/, 29], [/\b(prezent)/, 30], [/\b(gotow|upiec|ugotow)/, 31],
  [/\b(pranie|prac\b|pralk)/, 33], [/\b(sprzat|odkurz|porzadk)/, 34], [/\b(napraw|remont|hydraulik|elektryk|mechanik|majster)/, 35], [/\b(klucz|mieszkani|notariusz)/, 36],
  [/\b(prad|licznik|gaz\b)/, 37], [/\b(pies|psa|kot|weterynarz|spacer z)/, 38], [/\b(ogrod|kwiat|dzialk|roslin)/, 39],
  [/\b(samochod|auto|warsztat|przeglad|opon|myjni)/, 40], [/\b(tankow|paliw|stacj)/, 41], [/\b(pociag|pkp|intercity|dworzec)/, 42], [/\b(lot\b|samolot|lotnisk)/, 43],
  [/\b(wyjazd|delegac|walizk|pakowa)/, 44], [/\b(dojazd|odebrac|odbior)/, 45], [/\b(hotel|nocleg|drzemk)/, 46], [/\b(urlop|wakacj|plaz|odpoczyn)/, 47],
  [/\b(bank|kredyt|pozyczk)/, 49], [/\b(oplat|przelew|podatek|podatk|skladk|ubezpiecz)/, 50], [/\b(rachun|faktur|paragon)/, 51],
  [/\b(rodzin|znajom|mama|mamy|tata|taty|teściow|tesciow|babci|dziadk|goscie)/, 52], [/\b(dzieck|dzieci|przedszkol|zlobek|syn|corka)/, 53], [/\b(randk|rocznic|kolacja we dwoje)/, 54], [/\b(ksiazk|czyta|bibliotek)/, 55],
  [/\b(koncert|muzyk|festiwal)/, 60], [/\b(kino|film|serial|teatr)/, 61], [/\b(zdjec|fotograf)/, 62], [/\b(dom|domu)\b/, 32],
];
const BY_CAT = { praca: 16, dom: 32, sport: 0, zdrowie: 11, rodzina: 52, finanse: 48, nauka: 23, odpoczynek: 47 };

export function glyphFor(ev) {
  const t = norm(`${ev.title || ''}`);
  if (ev.bday) return 29;
  for (const [re, i] of RULES) if (re.test(t)) return i;
  return BY_CAT[ev.cat] ?? 56;
}
export const glyphHtml = (i, cls = '') => `<span class="gl ${cls}" style="--gx:${(i % 8) / 7 * 100}%;--gy:${Math.floor(i / 8) / 7 * 100}%" aria-hidden="true"></span>`;
