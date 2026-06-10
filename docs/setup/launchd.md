# Auto-start worker on login (optional)

Without this, the worker only runs when you have `npm run dev` (or `npm -w @vip/worker run start`) in a terminal. With it, the worker runs in the background from login, and cron jobs always fire.

## Install

```bash
./scripts/install-launchd.sh
```

This:
1. Builds the worker (`npm -w @vip/worker run build`)
2. Writes a launchd plist to `~/Library/LaunchAgents/com.vip-event-drafter.worker.plist`
3. Loads it (it'll start running immediately and auto-start on every login)

## Logs

```
tail -f ./data/worker.out.log ./data/worker.err.log
```

## Stop / uninstall

```bash
launchctl bootout gui/$(id -u)/com.vip-event-drafter.worker
rm ~/Library/LaunchAgents/com.vip-event-drafter.worker.plist
```

## Re-install after code changes

```bash
launchctl bootout gui/$(id -u)/com.vip-event-drafter.worker
./scripts/install-launchd.sh
```

## Notes

- The plist disables `nohup` semantics — KeepAlive means launchd restarts the worker if it crashes.
- Playwright still launches a headed Chromium window when sending. With launchd, that window opens whenever a job runs — even if you're not actively using the app. If that's disruptive, prefer running `npm run dev` in a terminal during event weeks instead.
