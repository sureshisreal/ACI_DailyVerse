#!/usr/bin/env bash
# Start DailyVerse for phone access. Keeps the Mac awake while the server runs
# and prints the URLs to open on your phone. Usage: npm run mobile
cd "$(dirname "$0")/.." || exit 1
PORT=3000

echo ""
echo "📱 DailyVerse – open one of these on your phone:"
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
[ -n "$LAN_IP" ] && echo "   Same Wi-Fi : http://$LAN_IP:$PORT"

TS=""
for c in tailscale /Applications/Tailscale.app/Contents/MacOS/Tailscale; do
  command -v "$c" >/dev/null 2>&1 && TS="$c" && break
done
if [ -n "$TS" ]; then
  TS_IP=$("$TS" ip -4 2>/dev/null | head -1)
  TS_NAME=$("$TS" status --json 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null)
  [ -n "$TS_IP" ]   && echo "   Anywhere   : http://$TS_IP:$PORT   (Tailscale)"
  [ -n "$TS_NAME" ] && echo "   Anywhere   : http://$TS_NAME:$PORT"
else
  echo "   (Install Tailscale to reach it away from home Wi-Fi)"
fi
echo ""

# -i idle, -m disk, -s system (on AC power) sleep prevented while the server runs
exec caffeinate -ims npm run dev
