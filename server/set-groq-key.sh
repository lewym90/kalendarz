#!/usr/bin/env bash
# Włącza szybkie, bardzo dokładne rozpoznawanie głosu przez Groq (Whisper large-v3-turbo). Uruchom jako root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/kalendarz/main/server/set-groq-key.sh)
# Klucz API zostaje wyłącznie w /etc/kalendarz-push.env na serwerze (nie trafia do aplikacji ani do GitHuba).
# Nagrania głosu (kilka sekund) są wtedy wysyłane z Twojego serwera do Groq. Usunięcie klucza z pliku wyłącza to.
set -uo pipefail
RAW="${RAW:-https://raw.githubusercontent.com/lewym90/kalendarz/main/server}"
APP=/opt/kalendarz; ENVF=/etc/kalendarz-push.env
[ "$(id -u)" = 0 ] || { echo "uruchom jako root" >&2; exit 1; }
[ -f "$ENVF" ] || { echo "najpierw uruchom install.sh" >&2; exit 1; }
KEY="${GROQ_API_KEY:-}"
if [ -z "$KEY" ]; then read -rsp "Wklej klucz API z console.groq.com (niewidoczny): " KEY; echo; fi
[ -n "$KEY" ] || { echo "pusty klucz" >&2; exit 1; }
curl -fsSL "$RAW/push-server.mjs" -o "$APP/push-server.mjs.new" && mv -f "$APP/push-server.mjs.new" "$APP/push-server.mjs" || { echo "pobieranie push-server.mjs" >&2; exit 1; }
grep -v '^GROQ_API_KEY=' "$ENVF" > "$ENVF.new"; echo "GROQ_API_KEY=$KEY" >> "$ENVF.new"
chmod 600 "$ENVF.new"; mv -f "$ENVF.new" "$ENVF"
systemctl restart kalendarz-push; sleep 2
systemctl is-active --quiet kalendarz-push || { journalctl -u kalendarz-push -n 15 --no-pager >&2; echo "usługa nie wstała" >&2; exit 1; }
# test klucza
CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 10 -H "Authorization: Bearer $KEY" https://api.groq.com/openai/v1/models)"
if [ "$CODE" = 200 ]; then echo "GOTOWE. Klucz działa. Rozpoznawanie głosu idzie teraz przez Groq (a lokalny model zostaje awaryjnym)."; else echo "UWAGA: Groq odpowiedział kodem $CODE – sprawdź klucz." >&2; fi
