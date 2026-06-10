# vip-event-drafter

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
