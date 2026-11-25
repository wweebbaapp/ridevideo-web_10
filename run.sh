#!/data/data/com.termux/files/usr/bin/bash
# RideVideo Web 10 — server locale sul tablet (porta 8018).
# Uso da Termux:  bash /sdcard/Download/ridevideo-web_10/run.sh
exec >> /sdcard/Download/ridevideo10-server.log 2>&1
echo "=== START $(date) ==="
cd /sdcard/Download/ridevideo-web_10 || { echo "CD FAILED"; exit 1; }
pwd

if ! command -v python >/dev/null 2>&1; then
  echo "PYTHON MANCANTE: esegui install-termux.sh"
  exit 1
fi
python --version

termux-wake-lock 2>/dev/null && echo "wake-lock attivo"

# Nessuna seconda istanza se la porta e' gia' occupata
if python -c "import socket,sys; s=socket.socket(); s.settimeout(1); sys.exit(0 if s.connect_ex(('127.0.0.1',8018))==0 else 1)"; then
  echo "server gia' attivo su http://localhost:8018"
  exit 0
fi

python -m http.server 8018 >/dev/null 2>&1 &
SRV=$!
echo "server pid: $SRV"
sleep 2

echo "--- self check ---"
python -c "import urllib.request as u; print('index.html ->', u.urlopen('http://127.0.0.1:8018/index.html').status)"
python -c "import urllib.request as u; print('elevation.js ->', u.urlopen('http://127.0.0.1:8018/js/elevation.js').status)"
python -c "import urllib.request as u; print('slope-chart.js ->', u.urlopen('http://127.0.0.1:8018/js/slope-chart.js').status)"
python -c "import urllib.request as u; print('interval-zoom-chart.js ->', u.urlopen('http://127.0.0.1:8018/js/interval-zoom-chart.js').status)"
python -c "import urllib.request as u; print('ui-scale.js ->', u.urlopen('http://127.0.0.1:8018/js/ui-scale.js').status)"
python -c "import urllib.request as u; print('styles.css ->', u.urlopen('http://127.0.0.1:8018/styles.css').status)"

echo ""
echo "======================================================"
echo "  App pronta: apri Chrome e vai su"
echo "      http://localhost:8018"
echo "  Menu '>' -> 'Aggiungi a schermata Home'"
echo "  Lascia Termux aperto (Ctrl+C per fermare)."
echo "======================================================"

wait $SRV
