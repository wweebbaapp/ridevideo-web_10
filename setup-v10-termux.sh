#!/data/data/com.termux/files/usr/bin/bash
# setup-v10-termux.sh — installa RideVideo Web 10 su Termux (porta 8018).
# Da eseguire dentro Termux:  bash /sdcard/Download/ridevideo-web_10/setup-v10-termux.sh
DIR=/sdcard/Download/ridevideo-web_10
LOG=/sdcard/Download/ridevideo10-setup.log
exec >> "$LOG" 2>&1
echo "=== SETUP V10 $(date) ==="

# 1. Accesso allo storage
if [ ! -d "$HOME/storage" ]; then
  echo "-- chiedo accesso allo storage..."
  termux-setup-storage || true
fi

# 2. Python
if ! command -v python >/dev/null 2>&1; then
  echo "-- installo Python..."
  pkg update -y && pkg install -y python
fi
python --version

# 3. Avvio automatico in ~/.bashrc
BASHRC="$HOME/.bashrc"
LINE='command -v python >/dev/null 2>&1 && ( nohup bash /sdcard/Download/ridevideo-web_10/run.sh >/dev/null 2>&1 & )'
touch "$BASHRC"
if grep -q 'ridevideo-web_10/run.sh' "$BASHRC" 2>/dev/null; then
  echo "autostart gia' presente in ~/.bashrc"
else
  printf '\n# RideVideo Web 10: avvia il server locale (porta 8018)\n%s\n' "$LINE" >> "$BASHRC"
  echo "autostart aggiunto"
fi

# 4. Wakelock
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock && echo "wake-lock attivo"
fi

# 5. Riavvia il server v10
bash "$DIR/stop-server.sh" || true
sleep 1
nohup bash "$DIR/run.sh" >/dev/null 2>&1 &
sleep 4

# 6. Verifica
echo "--- self check (porta 8018) ---"
python - <<'PY'
import urllib.request as u
for p in ("index.html", "styles.css", "sw.js", "js/app.js", "js/hud.js", "js/intervals.js", "js/interval-view.js", "js/interval-zoom-chart.js", "js/ui-scale.js", "js/slope-chart.js", "js/elevation.js"):
    try:
        r = u.urlopen("http://127.0.0.1:8018/" + p)
        print(p, "->", r.status, len(r.read()), "byte")
    except Exception as e:
        print(p, "-> ERRORE", e)
PY

echo "--- server attivi ---"
for p in /proc/[0-9]*; do
  pid="${p#/proc/}"
  [ "$pid" = "$$" ] && continue
  tr '\0' ' ' < "$p/cmdline" 2>/dev/null | grep -q "http.server" && \
    echo "pid $pid: $(tr '\0' ' ' < "$p/cmdline" 2>/dev/null)"
done

echo "=== FINE $(date) ==="
