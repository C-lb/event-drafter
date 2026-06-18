# event-drafter

Local single-user tool to draft and track personalized WhatsApp invites for VIP contacts.

See `docs/superpowers/specs/2026-06-10-vip-event-drafter-design.md` for the design.

## Run

```bash
nvm use            # node 22
npm install
npm run migrate    # initialize SQLite at ./data/app.db
npm run dev        # starts web (localhost:3000) + worker
```

## Test

```bash
npm test           # runs core + worker test suites
```

## Architecture

See `docs/superpowers/specs/2026-06-10-vip-event-drafter-design.md`.

## Plans

- Plan 1: Foundation — `docs/superpowers/plans/2026-06-10-01-foundation.md`
- Plan 2: Data ingest — `docs/superpowers/plans/2026-06-10-02-data-ingest.md`
- Plan 3: Drafting — `docs/superpowers/plans/2026-06-10-03-drafting.md`
- Plan 4: Sending — `docs/superpowers/plans/2026-06-10-04-sending.md`
- Plan 5: Replies — `docs/superpowers/plans/2026-06-10-05-replies.md`
- Plan 6: Polish — `docs/superpowers/plans/2026-06-10-06-polish.md`

## One-time setup

1. `docs/setup/google-oauth.md` — GCP OAuth
2. `docs/setup/whatsapp.md` — WA Web QR scan
3. `docs/setup/launchd.md` — auto-start worker (optional)
