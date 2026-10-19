#!/usr/bin/env bash
# Instalacja serwera powiadomień Kalendarza na VPS. Uruchom jako root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/kalendarz/main/server/install.sh)
# Bezpieczeństwo: osobny użytkownik, osobny katalog /opt/kalendarz, usługa tylko na 127.0.0.1:8790,
# jedna nowa trasa w /etc/caddy/conf.d/kalendarz.caddy. Typera i Egidy NIE dotyka.
# Po dodaniu trasy: caddy validate -> reload -> kontrola /zdrowie Typera; przy problemie plik trasy jest usuwany.
set -uo pipefail
RAW="${RAW:-https://raw.githubusercontent.com/lewym90/kalendarz/main/server}"
APP=/opt/kalendarz; USR=kalendarz; ENVF=/etc/kalendarz-push.env; PORT=8790
CF="${CADDYFILE:-/etc/caddy/Caddyfile}"; CD="${CONFD:-$(dirname "$CF")/conf.d}"; ROUTE="$CD/kalendarz.caddy"
say() { printf '== %s\n' "$*"; }
die() { printf 'PRZERWANO: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "uruchom jako root"
command -v systemctl >/dev/null || die "brak systemd"
command -v caddy >/dev/null || die "nie widzę Caddy"
[ -f "$CF" ] || die "brak $CF"
grep -qF "$CD" "$CF" || die "Caddy nie wczytuje $CD – najpierw uruchom: bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/typer/main/typer/caddy_confd.sh)"
SITE_LINE="$(grep -nE '^[^[:space:]{#(][^{]*\{[[:space:]]*$' "$CF" | head -n1 | cut -d: -f1)"
DOM="$(sed -n "${SITE_LINE}p" "$CF" | sed -E 's/[[:space:]]*\{.*$//; s/[[:space:]].*$//')"
[ -n "$DOM" ] || die "nie ustaliłem domeny z Caddyfile"
health() { [ -n "${SKIP_HEALTH:-}" ] && return 0; curl -fsS -m 10 "https://$DOM/zdrowie" >/dev/null 2>&1; }
HB=0; health && HB=1

# 1) Użytkownik i katalogi
id "$USR" >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin "$USR" || die "useradd"
mkdir -p "$APP/data" "$APP/node"; 

# 2) Node (własna kopia, jeśli systemowy za stary)
NODE="$(command -v node || true)"
if [ -z "$NODE" ] || [ "$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 18 ]; then
  say "Pobieram własny Node 22 do $APP/node"
  case "$(uname -m)" in x86_64) A=x64;; aarch64|arm64) A=arm64;; *) die "nieobsługiwana architektura";; esac
  B=https://nodejs.org/dist/latest-v22.x
  F="$(curl -fsSL $B/SHASUMS256.txt | grep -o "node-v[0-9.]*-linux-$A.tar.xz" | head -n1)" || die "nie znalazłem Node"
  curl -fsSL "$B/$F" | tar -xJ -C "$APP/node" --strip-components=1 || die "pobieranie Node"
  export PATH="$APP/node/bin:$PATH"; NODE="$APP/node/bin/node"
fi
say "Node: $($NODE -v)"

# 3) Pliki serwera
for f in push-server.mjs package.json; do curl -fsSL "$RAW/$f" -o "$APP/$f" || die "pobieranie $f"; done
( cd "$APP" && npm install --omit=dev --no-audit --no-fund --silent ) || die "npm install"

# 4) Klucze i kod połączenia (zachowane przy ponownym uruchomieniu)
if [ ! -f "$ENVF" ]; then
  K="$(cd "$APP" && "$NODE" -e "import('web-push').then(m=>{const k=(m.default||m).generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)})")"
  CODE="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 10)"
  umask 077
  { echo "PORT=$PORT"; echo "HOST=127.0.0.1"; echo "DATA_FILE=$APP/data/db.json"; echo "SETUP_CODE=$CODE"
    echo "VAPID_PUBLIC=${K%% *}"; echo "VAPID_PRIVATE=${K##* }"; } > "$ENVF"
fi
chmod 600 "$ENVF"
chown -R "$USR":"$USR" "$APP/data"

# 5) Usługa systemd
cat > /etc/systemd/system/kalendarz-push.service <<U
[Unit]
Description=Kalendarz – powiadomienia push
After=network-online.target
Wants=network-online.target
[Service]
User=$USR
EnvironmentFile=$ENVF
WorkingDirectory=$APP
ExecStart=$NODE $APP/push-server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$APP/data
MemoryMax=200M
[Install]
WantedBy=multi-user.target
U
systemctl daemon-reload && systemctl enable --now kalendarz-push >/dev/null 2>&1
systemctl restart kalendarz-push; sleep 2
systemctl is-active --quiet kalendarz-push || { journalctl -u kalendarz-push -n 20 --no-pager >&2; die "usługa nie wystartowała (Caddy i Typer nietknięte)"; }
curl -fsS -m 5 "http://127.0.0.1:$PORT/health" >/dev/null || die "usługa nie odpowiada lokalnie"

# 6) Trasa w Caddy (z walidacją i wycofaniem)
mkdir -p "$CD"
[ -f "$ROUTE" ] && cp -p "$ROUTE" "$ROUTE.bak"
cat > "$ROUTE" <<R
handle_path /kalendarz-push/* {
	reverse_proxy 127.0.0.1:$PORT
}
R
rollback() { say "WYCOFUJĘ trasę"; if [ -f "$ROUTE.bak" ]; then mv -f "$ROUTE.bak" "$ROUTE"; else rm -f "$ROUTE"; fi; systemctl reload caddy 2>/dev/null || systemctl restart caddy; exit 1; }
caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1 || { echo "Caddy odrzucił konfigurację." >&2; rollback; }
systemctl reload caddy || rollback
sleep 3
systemctl is-active --quiet caddy || rollback
if [ $HB = 1 ]; then ok=0; for _ in 1 2 3 4 5 6; do health && { ok=1; break; }; sleep 3; done; [ $ok = 1 ] || { echo "Typer nie odpowiada po zmianie." >&2; rollback; }; fi
rm -f "$ROUTE.bak"
OKR=0; for _ in 1 2 3 4 5; do curl -fsS -m 10 "https://$DOM/kalendarz-push/health" >/dev/null 2>&1 && { OKR=1; break; }; sleep 3; done
. "$ENVF"
say "GOTOWE. Typer działa jak wcześniej.$([ $OKR = 1 ] || echo ' (UWAGA: trasa publiczna jeszcze nie odpowiada – odczekaj chwilę i sprawdź ponownie)')"
echo
echo "W aplikacji Kalendarz: Centrum → Powiadomienia z serwera, wpisz:"
echo "   Adres:  https://$DOM/kalendarz-push"
echo "   Kod:    $SETUP_CODE"
