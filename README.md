# Kalendarz

Osobiste centrum dowodzenia: kalendarz, zadania i automatyzacje w jednej aplikacji, która po dodaniu do ekranu początkowego iPhone'a działa jak natywna.

**Adres aplikacji:** https://lewym90.github.io/kalendarz/

## Instalacja na iPhonie
1. Otwórz adres w Safari.
2. Dotknij Udostępnij, potem „Dodaj do ekranu początkowego".
3. Uruchom aplikację z ikony, wejdź w Więcej i włącz powiadomienia.

## Co potrafi
- Dodawanie zdaniem po polsku: „jutro 17 siłownia", „co drugi wtorek 9:30 dentysta @Mokotów", „urodziny Ani 14 marca"
- Dodawanie głosem: mikrofon w oknie dodawania (lub mikrofon klawiatury iPhone’a), np. „dodaj do kalendarza wizyta u lekarza trzeciego listopada o 17”; kilka pozycji w jednym zdaniu, także zadania („kup dziś mleko, jutro znajdź opony”); mikrofon nagrywa i rozpoznaje mowę w samej aplikacji (model Whisper, ~80 MB pobierany raz, potem także offline), bez klawiatury; rozpoznany tekst jest poprawiany słownikiem (siłownia, lekarz…) i Twoimi wpisami; dokładne rozpoznawanie na serwerze (faster-whisper, `server/install-stt.sh`), a gdy serwer nie odpowiada — model w telefonie; najpierw podgląd, potem „Dodaj”
- Szybkie dodawanie: panel ustawień dotykiem (data, godzina, czas trwania, powtarzanie, przypomnienie, kategoria, miejsce) działa razem ze zdaniem; ostrzeżenie o nakładaniu się z „Wolny termin”, „Ostatnio dodawane” pamiętają godzinę i długość, „Dodaj i kolejne”
- Wspólny kalendarz: powiadomienie push, gdy druga osoba doda wydarzenie (grupowane, prywatne jako „Zajęty termin”, przełącznik w Centrum); poranny brief, podgląd jutra, przegląd tygodnia i licznik na ikonie liczą też jej wpisy (serwer składa treść w chwili wysyłki)
- Widoki: Dziś, miesiąc, tydzień, dzień (przeciąganie i zmiana długości), agenda
- Wydarzenia cykliczne, kategorie, zadania z przenoszeniem zaległych na dziś
- Reguły: „jeśli kategoria Praca, przypomnij 30 minut wcześniej"
- Poranny brief, podgląd jutra, przegląd tygodnia, licznik na ikonie, pogoda
- Widok 3 dni, przeciąganie wydarzeń między dniami (tydzień, 3 dni, miesiąc), edycja „ten i kolejne"
- Blokowanie czasu: przytrzymaj zadanie i upuść na osi czasu
- Znajdź wolny termin, statystyki z porównaniem okresów, import i eksport .ics
- Polskie święta (także ruchome), imieniny, numery tygodni, wschód i zachód słońca, urodziny z wiekiem
- Pogoda 7 dni w widokach i przy wydarzeniach plenerowych
- Ciemny styl Midnight, wybór koloru wpisów dla każdej osoby, blokada Face ID (WebAuthn) z awaryjnym PIN-em
- Praca offline, kopia zapasowa JSON

- Asystent AI (Gemini przez własny serwer) w polu na ekranie Dziś: odpowiada na pytania o plan i proponuje zmiany „było/będzie” do zatwierdzenia, np. „wypadło mi pilne spotkanie o 16, dopasuj resztę dnia”
- Automatyczna, szyfrowana kopia na serwerze (7 ostatnich dni), cofanie do 30 kroków i historia zmian
- Wspólne wydarzenia z akceptacją, wspólne zadania i lista zakupów, wspólny wolny termin
- Filtry kalendarza, bufory czasowe, pamięć preferencji, rozbudowane statystyki z terminowością
- Zdjęcie w nagłówku zależne od prawdziwych godzin słońca i pogody, ostrzeżenia pogodowe dopasowane do planu

Dane zapisują się lokalnie w telefonie. Bez zależności i bez budowania: czyste HTML, CSS i JavaScript.

## Aktualizacja serwera i asystent
- Nowa wersja serwera: `bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/kalendarz/main/server/update.sh)`
- Klucz Gemini: `bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/kalendarz/main/server/set-gemini-key.sh)`


## Powiadomienia przy zamkniętej aplikacji (opcjonalnie)

iOS usypia aplikacje w tle, więc lokalne przypomnienia działają głównie przy otwartej aplikacji. Żeby dostawać je zawsze, folder `server/` zawiera małą usługę Web Push (Node, `web-push`) dla własnego VPS-a:

1. Jako root na serwerze: `bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/kalendarz/main/server/install.sh)` (wymaga Caddy z folderem `conf.d`). Instalator tworzy osobnego użytkownika, usługę `kalendarz-push` na `127.0.0.1:8790` i jedną trasę `/kalendarz-push/` w Caddy (z walidacją i automatycznym wycofaniem). Wypisuje adres i kod połączenia.
2. W aplikacji (z ekranu początkowego): Więcej, Powiadomienia, „Powiadomienia z serwera”, Połącz.

Aplikacja wysyła serwerowi alarmy na najbliższe 14 dni i odświeża je po każdej zmianie. Serwer zapisuje tylko to, co potrzebne do wysyłki, a token urządzenia trzyma jako skrót. Testy serwera: `cd server && npm install && npm test`.

### Widget na ekran blokady i główny (Scriptable)

Po połączeniu z serwerem aplikacja wysyła mu plan dnia na 7 dni. Serwer udostępnia go pod tajnym adresem, a skrypt `widgets/kalendarz-widget.js` rysuje z niego widgety w bezpłatnej aplikacji Scriptable (ekran blokady: wiersz, prostokąt, kółko; ekran główny: mały, średni, duży). W zakładce Więcej przycisk „Kopiuj skrypt” kopiuje loader z Twoim adresem; sam kod widgetu aktualizuje się automatycznie.

## Testy
`npm test` (Node 22, bez zależności): parser zdań, powtarzanie, święta, import .ics, wolne terminy, podział serii.

Widget średni (pełna szerokość) pokazuje miniaturę miesiąca z zaznaczonym dniem, pogodę (Open-Meteo, miejsce z ustawień aplikacji) i plan dnia; tło to malowane szkło ze świetlistą ramką i zdjęciem gór zależnym od pory dnia i pogody (grafiki w `img/widget/`, widget pobiera je raz i trzyma w telefonie).

### Wspólny kalendarz

Na ekranie Wspólny, po połączeniu z serwerem, ustawiasz imię, a przełącznikami decydujesz, czy udostępniasz swój kalendarz i czy widzisz cudzy. Wpisy drugiej osoby są tylko do odczytu, mają jej kolor i literę imienia, a wydarzenia oznaczone jako prywatne pokazują się jako „Zajęte”. Serwer (`/sync` z polem `share`, `/peers`) trzyma to osobno dla każdego urządzenia; wszystkie urządzenia połączone tym samym kodem widzą nawzajem swoje kalendarze.
