#!/bin/sh
# Ferma il server RideVideo Web 10 (porta 8018).
# Funziona sia su Termux (via /proc) sia su macOS (via pkill).
found=""
for p in /proc/[0-9]*; do
  pid="${p#/proc/}"
  [ "$pid" = "$$" ] && continue
  if tr '\0' ' ' < "$p/cmdline" 2>/dev/null | grep -q "http[.]server 8018"; then
    kill "$pid" 2>/dev/null && echo "Server fermato (pid $pid)"
    found=1
  fi
done
if command -v pkill >/dev/null 2>&1; then
  pkill -f "http.server 8018" 2>/dev/null && found=1
fi
[ -n "$found" ] || echo "nessun server sulla porta 8018"
