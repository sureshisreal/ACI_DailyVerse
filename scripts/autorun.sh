#!/usr/bin/env bash
# Daily automation entry point, run inside the codespace by .github/workflows/daily-autorun.yml
# (over `gh codespace ssh`, which also wakes a stopped codespace).
#   bash scripts/autorun.sh generate [YYYY-MM-DD]   generate + schedule a plan date (default: tomorrow)
#                                                   DRY_RUN=1: generate only, schedule nothing
#   bash scripts/autorun.sh post                    post anything due on Instagram (its scheduler only
#                                                   runs while the server is up - the codespace is
#                                                   usually asleep at go-live time)
# Exits non-zero when the run failed or was incomplete, so the Action (and GitHub's email) flags it.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
TASK="${1:-generate}"
DATE="${2:-}"

# The headless run needs Chromium; install it once if this codespace predates setup.sh adding it.
if [ "$TASK" = "generate" ] && ! command -v chromium >/dev/null && [ -z "${CHROME_PATH:-}" ]; then
  echo "Installing Chromium for the headless run..."
  sudo apt-get update -qq >/dev/null && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq chromium >/dev/null 2>&1 || echo "Chromium install failed"
fi

bash .devcontainer/start.sh >/dev/null 2>&1
for _ in $(seq 1 90); do curl -s -o /dev/null localhost:3000/api/youtube/status && break; sleep 2; done

case "$TASK" in
  generate)
    BODY="{\"wait\":true${DATE:+,\"date\":\"$DATE\"}${DRY_RUN:+,\"dryRun\":true}}"
    OUT=$(curl -s -m 2700 -X POST localhost:3000/api/autorun/start -H 'Content-Type: application/json' -d "$BODY")
    printf '%s' "$OUT" | node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        let r; try { r = JSON.parse(s.trim()); } catch { console.log("Unexpected response:", s.slice(0, 500)); process.exit(1); }
        console.log(`Date: ${r.date}  Verse: ${r.reference || "?"}  Status: ${String(r.status).toUpperCase()}`);
        if (r.detail) console.log(`Detail: ${r.detail}`);
        if (r.generation) console.log(`Generated: ${r.generation.videos ?? "?"} videos, ${r.generation.posters ?? "?"} posters${r.generation.error ? ` (issues: ${r.generation.error})` : ""}`);
        for (const s of r.scheduled || []) {
          if (s.result.error) { console.log(`  ${s.file}: ERROR ${s.result.error}`); continue; }
          const ch = ["youtube", "facebook", "instagram"].map((k) => { const c = s.result[k] || {}; return `${k}=${c.state}${c.state === "error" || c.state === "skipped" ? ` (${c.detail})` : ""}`; });
          console.log(`  ${s.file}: ${ch.join("  ")}`);
        }
        if (r.whatsapp) console.log(`WhatsApp posters: ${r.whatsapp}`);
        process.exit(r.status === "done" || r.status === "skipped" ? 0 : 1);
      });'
    ;;
  post)
    curl -s -m 900 -X POST localhost:3000/api/instagram/sync -H 'Content-Type: application/json' -d '{}'
    echo
    ;;
  *)
    echo "Unknown task: $TASK (use generate or post)"; exit 2 ;;
esac
