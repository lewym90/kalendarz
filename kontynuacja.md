# Kalendarz: notatki do dalszej pracy

Aplikacja dla dwóch osób (iPhone, PWA). Adres: https://lewym90.github.io/kalendarz/

- Styl: Midnight, tylko ciemny motyw. Kolor wpisu = kolor osoby (`settings.share.color`), kategorię pokazuje ikonka z `img/ikonki.webp` (`js/glyphs.js`). Kolory kategorii tylko na wykresie w Statystykach.
- Zdjęcia nagłówka: `img/niebo/`, wybór w `js/sky.js` (godziny słońca + pogoda).
- Serwer (`server/push-server.mjs`): push, kopia `/backup/*` (szyfrowana w telefonie, 7 dni), wspólna przestrzeń `/space/sync`, asystent `/ai` (Gemini, model wybierany automatycznie). Aktualizacja: `server/update.sh`, klucz: `server/set-gemini-key.sh`.
- Asystent (`js/ai.js`): model tylko proponuje, godziny liczy planer, każda zmiana wymaga zatwierdzenia.
- Wydarzenie wspólne to zwykły wpis w `state.events` z polem `sharedId`; `js/space.js` pilnuje zmian i nie wysyła go w kanale `share`.
- Po zmianie plików podbij `VERSION` w `sw.js` i dopisz nowe pliki do `SHELL`.
- Testy: `npm test` oraz `cd server && npm test`.
