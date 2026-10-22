# Kalendarz

Osobiste centrum dowodzenia: kalendarz, zadania i automatyzacje w jednej aplikacji, która po dodaniu do ekranu początkowego iPhone'a działa jak natywna.

**Adres aplikacji:** https://lewym90.github.io/kalendarz/

## Instalacja na iPhonie
1. Otwórz adres w Safari.
2. Dotknij Udostępnij, potem „Dodaj do ekranu początkowego".
3. Uruchom aplikację z ikony, wejdź w Centrum i włącz powiadomienia.

## Co potrafi
- Dodawanie zdaniem po polsku: „jutro 17 siłownia", „co drugi wtorek 9:30 dentysta @Mokotów", „urodziny Ani 14 marca"
- Dodawanie głosem: mikrofon w oknie dodawania (lub mikrofon klawiatury iPhone’a), np. „dodaj do kalendarza wizyta u lekarza trzeciego listopada o 17”; kilka pozycji w jednym zdaniu, także zadania („kup dziś mleko, jutro znajdź opony”); mikrofon nagrywa i rozpoznaje mowę w samej aplikacji (model Whisper, ~80 MB pobierany raz, potem także offline), bez klawiatury; rozpoznany tekst jest poprawiany słownikiem (siłownia, lekarz…) i Twoimi wpisami; dokładne rozpoznawanie na serwerze (faster-whisper, `server/install-stt.sh`), a gdy serwer nie odpowiada — model w telefonie; najpierw podgląd, potem „Dodaj”
- Szybkie dodawanie: panel ustawień dotykiem (data, godzina, czas trwania, powtarzanie, przypomnienie, kategoria, miejsce) działa razem ze zdaniem; ostrzeżenie o nakładaniu się z „Wolny termin”, „Ostatnio dodawane” pamiętają godzinę i długość, „Dodaj i kolejne”
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


## Powiadomienia przy zamkniętej aplikacji (opcjonalnie)

iOS usypia aplikacje w tle, więc lokalne przypomnienia działają głównie przy otwartej aplikacji. Żeby dostawać je zawsze, folder `server/` zawiera małą usługę Web Push (Node, `web-push`) dla własnego VPS-a:

1. Jako root na serwerze: `bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/kalendarz/main/server/install.sh)` (wymaga Caddy z folderem `conf.d`). Instalator tworzy osobnego użytkownika, usługę `kalendarz-push` na `127.0.0.1:8790` i jedną trasę `/kalendarz-push/` w Caddy (z walidacją i automatycznym wycofaniem). Wypisuje adres i kod połączenia.
2. W aplikacji (z ekranu początkowego): Centrum, Powiadomienia, „Powiadomienia z serwera”, Połącz.

Aplikacja wysyła serwerowi alarmy na najbliższe 14 dni i odświeża je po każdej zmianie. Serwer zapisuje tylko to, co potrzebne do wysyłki, a token urządzenia trzyma jako skrót. Testy serwera: `cd server && npm install && npm test`.

### Widget na ekran blokady i główny (Scriptable)

Po połączeniu z serwerem aplikacja wysyła mu plan dnia na 7 dni. Serwer udostępnia go pod tajnym adresem, a skrypt `widgets/kalendarz-widget.js` rysuje z niego widgety w bezpłatnej aplikacji Scriptable (ekran blokady: wiersz, prostokąt, kółko; ekran główny: mały, średni, duży). W Centrum przycisk „Kopiuj skrypt” kopiuje loader z Twoim adresem; sam kod widgetu aktualizuje się automatycznie.

## Testy
`npm test` (Node 22, bez zależności): parser zdań, powtarzanie, święta, import .ics, wolne terminy, podział serii.

Widget średni (pełna szerokość) pokazuje miniaturę miesiąca z zaznaczonym dniem, pogodę (Open-Meteo, miejsce z ustawień aplikacji) i plan dnia; tło to ciemne, półprzezroczyste szkło. Parametr widgetu `slate` daje chłodny grafit jak w widgecie Pogoda.

### Wspólny kalendarz

W Centrum, po połączeniu z serwerem, sekcja „Wspólny kalendarz”: ustawiasz imię i kolor, a przełącznikami decydujesz, czy udostępniasz swój kalendarz i czy widzisz cudzy. Wpisy drugiej osoby są tylko do odczytu, mają jej kolor i literę imienia, a wydarzenia oznaczone jako prywatne pokazują się jako „Zajęte”. Serwer (`/sync` z polem `share`, `/peers`) trzyma to osobno dla każdego urządzenia; wszystkie urządzenia połączone tym samym kodem widzą nawzajem swoje kalendarze.
