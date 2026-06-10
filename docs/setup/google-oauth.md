# Google OAuth setup (one-time, ~15 min)

This project uses your personal Google account to read your contacts Sheet and your Gmail inbox. Tokens live in `data/app.db` under the `settings` table; nothing is sent anywhere except Google's APIs.

## 1. Create a GCP project

1. Go to https://console.cloud.google.com/projectcreate
2. Name: `vip-event-drafter` (or anything). Create.

## 2. Enable APIs

1. APIs & Services → Library
2. Enable **Google Sheets API** and **Gmail API**.

## 3. Configure OAuth consent screen

1. APIs & Services → OAuth consent screen
2. User type: **External** (you're using a personal Gmail)
3. App name: `vip-event-drafter`, support email: your Gmail.
4. Scopes: add
   - `.../auth/spreadsheets.readonly`
   - `.../auth/gmail.readonly`
5. Test users: add your Gmail address (apps in "Testing" mode are limited to listed test users).
6. Save and continue through the rest.

## 4. Create an OAuth client

1. APIs & Services → Credentials → **Create credentials** → **OAuth client ID**
2. Application type: **Web application**
3. Name: `vip-event-drafter local`
4. Authorized redirect URIs: `http://localhost:3000/api/auth/google/callback`
5. Create. Copy the **Client ID** and **Client secret**.

## 5. Add to `.env`

In the repo root, create `.env` (gitignored) and add:

```
GOOGLE_CLIENT_ID=<paste>
GOOGLE_CLIENT_SECRET=<paste>
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

## 6. First-run flow

Visit `http://localhost:3000/setup/google`, click "Authorize Google", complete the Google consent flow. Tokens are stored in `data/app.db`.
