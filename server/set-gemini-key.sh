#!/usr/bin/env bash
# Włącza asystenta AI w Kalendarzu. Uruchom jako root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/kalendarz/main/server/set-gemini-key.sh)
# Klucz zostaje wyłącznie w /etc/kalendarz-push.env na serwerze (nie trafia do aplikacji ani do GitHuba).
set -uo pipefail
ENVF=/etc/kalendarz-push.env
[ "$(id -u)" = 0 ] || { echo "uruchom jako root" >&2; exit 1; }
[ -f "$ENVF" ] || { echo "najpierw uruchom install.sh" >&2; exit 1; }
KEY="${GEMINI_API_KEY:-}"
if [ -z "$KEY" ]; then read -rsp "Wklej klucz Gemini z aistudio.google.com (niewidoczny): " KEY; echo; fi
[ -n "$KEY" ] || { echo "pusty klucz" >&2; exit 1; }
CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 15 -H "x-goog-api-key: $KEY" 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=5')"
[ "$CODE" = 200 ] || { echo "Google odrzucił klucz (kod $CODE). Nic nie zmieniono." >&2; exit 1; }
grep -v '^GEMINI_API_KEY=' "$ENVF" > "$ENVF.new"; echo "GEMINI_API_KEY=$KEY" >> "$ENVF.new"
chmod 600 "$ENVF.new"; mv -f "$ENVF.new" "$ENVF"
systemctl restart kalendarz-push; sleep 2
systemctl is-active --quiet kalendarz-push || { journalctl -u kalendarz-push -n 15 --no-pager >&2; echo "usługa nie wstała" >&2; exit 1; }
echo "GOTOWE. Klucz działa, asystent jest włączony."
