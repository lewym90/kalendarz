# Kalendarz

Osobiste centrum dowodzenia: kalendarz, zadania i automatyzacje w jednej aplikacji, która po dodaniu do ekranu początkowego iPhone'a działa jak natywna.

**Adres aplikacji:** https://lewym90.github.io/kalendarz/

## Instalacja na iPhonie
1. Otwórz adres w Safari.
2. Dotknij Udostępnij, potem „Dodaj do ekranu początkowego".
3. Uruchom aplikację z ikony, wejdź w Centrum i włącz powiadomienia.

## Co potrafi
- Dodawanie zdaniem po polsku: „jutro 17 siłownia", „co drugi wtorek 9:30 dentysta @Mokotów", „urodziny Ani 14 marca"
- Widoki: Dziś, miesiąc, tydzień, dzień (przeciąganie i zmiana długości), agenda
- Wydarzenia cykliczne, kategorie, zadania z przenoszeniem zaległych na dziś
- Reguły: „jeśli kategoria Praca, przypomnij 30 minut wcześniej"
- Poranny brief, podgląd jutra, przegląd tygodnia, licznik na ikonie, pogoda
- Widok 3 dni, przeciąganie wydarzeń między dniami (tydzień, 3 dni, miesiąc), edycja „ten i kolejne"
- Blokowanie czasu: przytrzymaj zadanie i upuść na osi czasu
- Znajdź wolny termin, statystyki z porównaniem okresów, import i eksport .ics
- Polskie święta (także ruchome), imieniny, numery tygodni, wschód i zachód słońca, urodziny z wiekiem
- Pogoda 7 dni w widokach i przy wydarzeniach plenerowych
- Motywy tła, własny kolor akcentu, blokada Face ID (WebAuthn) z awaryjnym PIN-em
- Praca offline, kopia zapasowa JSON

Dane zapisują się lokalnie w telefonie. Bez zależności i bez budowania: czyste HTML, CSS i JavaScript.


## Testy
`npm test` (Node 22, bez zależności): parser zdań, powtarzanie, święta, import .ics, wolne terminy, podział serii.
