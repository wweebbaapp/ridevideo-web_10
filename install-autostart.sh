#!/data/data/com.termux/files/usr/bin/bash
# Installa l'avvio automatico del server in ~/.bashrc e lo verifica.
exec >> /sdcard/Download/ridevideo10-setup.log 2>&1
echo "=== SETUP $(date) ==="

BASHRC="$HOME/.bashrc"
LINE='command -v python >/dev/null 2>&1 && ( nohup bash /sdcard/Download/ridevideo-web_10/run.sh >/dev/null 2>&1 & )'

if grep -q 'ridevideo-web_10/run.sh' "$BASHRC" 2>/dev/null; then
  echo "autostart gia' presente in ~/.bashrc"
else
  printf '\n# RideVideo Web 10: avvia il server locale (porta 8018)\n%s\n' "$LINE" >> "$BASHRC"
  echo "autostart aggiunto"
fi

echo "--- sintassi ~/.bashrc ---"
if bash -n "$BASHRC"; then echo "BASHRC OK"; else echo "BASHRC ERRORE"; fi

echo "--- test: fermo il server e riavvio una sessione ---"
for p in /proc/[0-9]*; do
  pid="${p#/proc/}"
  [ "$pid" = "$$" ] || [ "$pid" = "$PPID" ] && continue
  if tr '\0' ' ' < "$p/cmdline" 2>/dev/null | grep -q "http.server 8018"; then
    kill "$pid" 2>/dev/null && echo "ucciso pid $pid"
  fi
done
sleep 1
python -c "import socket,sys; s=socket.socket(); s.settimeout(1); print('porta 8018 DOPO KILL:', 'ANCORA SU' if s.connect_ex(('127.0.0.1',8018))==0 else 'GIU')"

bash -i -c 'exit' >/dev/null 2>&1
python - <<'PY'
import time, urllib.request
ok = False
for _ in range(20):
    try:
        urllib.request.urlopen("http://127.0.0.1:8018/index.html", timeout=1)
        ok = True
        break
    except Exception:
        time.sleep(0.5)
print("porta 8018 DOPO BASH -i:", "SU (autostart funziona)" if ok else "GIU (autostart NON funziona)")
PY

echo "=== FINE $(date) ==="
