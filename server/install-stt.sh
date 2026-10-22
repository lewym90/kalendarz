#!/usr/bin/env bash
# Dokładne rozpoznawanie głosu na VPS (faster-whisper). Opcjonalne, osobne od install.sh. Uruchom jako root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/lewym90/kalendarz/main/server/install-stt.sh)
# Bezpieczeństwo dla Typera: osobna usługa kalendarz-stt (127.0.0.1:8791), niski priorytet (Nice=15, IOWeight),
# limit pamięci MemoryMax, model ładowany dopiero przy użyciu i zwalniany po 10 min bezczynności.
# Nie rusza Caddy ani Typera. Wymaga wcześniej uruchomionego install.sh (kalendarz-push).
set -uo pipefail
RAW="${RAW:-https://raw.githubusercontent.com/lewym90/kalendarz/main/server}"
APP=/opt/kalendarz; STT=$APP/stt; USR=kalendarz; PORT=8791
say() { printf '== %s\n' "$*"; }
die() { printf 'PRZERWANO: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "uruchom jako root"
[ -d "$APP" ] && id "$USR" >/dev/null 2>&1 || die "najpierw uruchom install.sh (powiadomienia)"
command -v systemctl >/dev/null || die "brak systemd"

# Model dobieramy do pamięci: small potrzebuje ok. 1 GB wolnej pamięci na czas rozpoznawania
MEM_MB="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)"; TOT_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
MODEL="${STT_MODEL:-}"
if [ -z "$MODEL" ]; then
  if [ "$TOT_MB" -ge 7000 ] && [ "$MEM_MB" -ge 4000 ]; then MODEL=large-v3-turbo
  elif [ "$TOT_MB" -ge 3500 ] && [ "$MEM_MB" -ge 1800 ]; then MODEL=small; else MODEL=base; fi
fi
case "$MODEL" in large*|turbo) LIM=3000M;; small) LIM=1500M;; *) LIM=800M;; esac
TH="$(nproc 2>/dev/null || echo 2)"; [ "$TH" -gt 4 ] && TH=4
say "Pamięć: razem ${TOT_MB} MB, wolna ${MEM_MB} MB → model: $MODEL (limit usługi $LIM)"

# Python + venv
command -v python3 >/dev/null || { command -v apt-get >/dev/null && apt-get install -y python3 >/dev/null 2>&1; }
command -v python3 >/dev/null || die "brak python3"
mkdir -p "$STT/models"
if ! python3 -m venv "$STT/venv" >/dev/null 2>&1; then
  command -v apt-get >/dev/null && apt-get install -y python3-venv >/dev/null 2>&1
  python3 -m venv "$STT/venv" || die "nie mogę utworzyć środowiska Python (zainstaluj python3-venv)"
fi
say "Instaluję faster-whisper (kilka minut, ok. 300 MB)"
"$STT/venv/bin/pip" install --quiet --no-cache-dir --upgrade pip >/dev/null 2>&1
"$STT/venv/bin/pip" install --quiet --no-cache-dir faster-whisper numpy || die "pip install faster-whisper"
curl -fsSL "$RAW/stt/stt-server.py" -o "$STT/stt-server.py" || die "pobieranie stt-server.py"
chown -R "$USR":"$USR" "$STT"

say "Pobieram model $MODEL (jednorazowo)"
runuser -u "$USR" -- env STT_DIR="$STT/models" HF_HOME="$STT/models" "$STT/venv/bin/python" -c "
from faster_whisper import WhisperModel
WhisperModel('$MODEL', device='cpu', compute_type='int8', download_root='$STT/models')
print('model gotowy')" || die "pobieranie modelu $MODEL"

cat > /etc/systemd/system/kalendarz-stt.service <<U
[Unit]
Description=Kalendarz – rozpoznawanie mowy
After=network-online.target
[Service]
User=$USR
Environment=STT_MODEL=$MODEL STT_DIR=$STT/models STT_PORT=$PORT STT_THREADS=$TH HF_HOME=$STT/models
ExecStart=$STT/venv/bin/python $STT/stt-server.py
Restart=always
RestartSec=5
Nice=15
IOSchedulingClass=idle
CPUWeight=20
MemoryMax=$LIM
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$STT
[Install]
WantedBy=multi-user.target
U
systemctl daemon-reload && systemctl enable --now kalendarz-stt >/dev/null 2>&1
systemctl restart kalendarz-stt; sleep 3
systemctl is-active --quiet kalendarz-stt || { journalctl -u kalendarz-stt -n 20 --no-pager >&2; die "usługa nie wystartowała (Typer nietknięty)"; }
curl -fsS -m 5 "http://127.0.0.1:$PORT/health" >/dev/null || die "usługa nie odpowiada lokalnie"

# serwer powiadomień zna adres usługi (domyślnie 127.0.0.1:8791) — wgrywamy nowszą wersję i restartujemy tylko jego
curl -fsSL "$RAW/push-server.mjs" -o "$APP/push-server.mjs.new" && mv -f "$APP/push-server.mjs.new" "$APP/push-server.mjs" && systemctl restart kalendarz-push
sleep 2
systemctl is-active --quiet kalendarz-push || die "kalendarz-push nie wstał po aktualizacji"
say "GOTOWE. Rozpoznawanie głosu działa na serwerze (model $MODEL). W aplikacji nic więcej nie trzeba robić."
