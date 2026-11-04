#!/usr/bin/env bash
# Aktualizuje serwer Kalendarza do najnowszej wersji. Uruchom jako root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/kalendarz/main/server/update.sh)
# Dane, kod połączenia i klucze zostają bez zmian. Gdy nowa wersja nie wstanie, wraca poprzednia.
set -uo pipefail
RAW="${RAW:-https://raw.githubusercontent.com/lewym90/kalendarz/main/server}"
APP=/opt/kalendarz
[ "$(id -u)" = 0 ] || { echo "uruchom jako root" >&2; exit 1; }
[ -f "$APP/push-server.mjs" ] || { echo "najpierw uruchom install.sh" >&2; exit 1; }
curl -fsSL "$RAW/push-server.mjs" -o "$APP/push-server.mjs.new" || { echo "nie mogę pobrać nowej wersji" >&2; exit 1; }
cp -f "$APP/push-server.mjs" "$APP/push-server.mjs.old"
mv -f "$APP/push-server.mjs.new" "$APP/push-server.mjs"
systemctl restart kalendarz-push; sleep 3
if systemctl is-active --quiet kalendarz-push && curl -fsS -m 5 http://127.0.0.1:8790/health >/dev/null; then
  echo "GOTOWE. Serwer Kalendarza zaktualizowany."
else
  mv -f "$APP/push-server.mjs.old" "$APP/push-server.mjs"; systemctl restart kalendarz-push
  journalctl -u kalendarz-push -n 15 --no-pager >&2
  echo "Nie udało się. Przywrócono poprzednią wersję." >&2; exit 1
fi
