#!/data/data/com.termux/files/usr/bin/bash
# setup-termux.sh — prepara e avvia RideVideo Web su Android (Termux).
# Uso:  bash setup-termux.sh
set -e

PORT=8018
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "== RideVideo Web — setup Termux =="
echo "Cartella: $DIR"

# 1. Accesso allo storage (una volta sola)
if [ ! -d "$HOME/storage" ]; then
  echo "-- Chiedo accesso allo storage (concedi il permesso)..."
  termux-setup-storage || true
fi

# 2. Python
if ! command -v python >/dev/null 2>&1; then
  echo "-- Installo Python..."
  pkg update -y && pkg install -y python
fi

# 3. Tieni Termux attivo mentre usi Chrome
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
  echo "-- Wakelock attivato (Termux non verrà sospeso)"
fi

echo ""
echo "======================================================"
echo "  Apri Chrome e vai su:  http://localhost:$PORT"
echo "  Poi ⋮ → 'Aggiungi a schermata Home'"
echo "  Lascia questa finestra aperta. Ctrl+C per fermare."
echo "======================================================"
echo ""

python -m http.server "$PORT"
