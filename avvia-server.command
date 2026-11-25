#!/bin/zsh
# Avvia il server locale di RideVideo Web e apre il browser.
# Utile per testare su Mac, o per aprire la web app da altri dispositivi in LAN.
# Nota: usa la porta 8018 (la v9 usa la 8017, la v8 la 8016, la v7 la 8015,
# la v6 la 8014, la v5 la 8013, la v4 la 8012, la v3 la 8011, la v2 la 8010,
# la v1 la 8000, così possono girare contemporaneamente).
cd "$(dirname "$0")"
PORT=8018
echo "$$" > rideweb10.pid
echo "RideVideo Web su: http://localhost:$PORT"
echo "(premi Ctrl+C per fermare)"
# Apre il browser dopo un attimo
( sleep 1; open "http://localhost:$PORT/index.html" ) &
exec python3 -m http.server "$PORT"
