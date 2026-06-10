# WhatsApp Web setup

This app drives WhatsApp Web via a dedicated Chromium browser controlled by Playwright. The browser uses its own profile in `data/wa-profile/` — your real Chrome is untouched.

## One-time auth

1. Make sure the worker is **not** running (`npm run dev` should be stopped).
2. Run: `npm run wa-smoke` — a Chromium window opens to WhatsApp Web.
3. Open WhatsApp on your phone → Settings → Linked Devices → Link a Device.
4. Scan the QR shown in the Chromium window.
5. Once chats appear, the smoke test logs "✓ logged in" and exits. Session is persisted.
6. Restart the worker: `npm run dev`.

## Renewing the session

WA Web sessions stay valid for weeks but eventually log out. When this happens:
- Dashboard banner: "WA Web needs re-auth"
- Run `npm run wa-smoke` again and re-scan.

## What Playwright does — and what it never does

- Opens chats by navigating to `https://web.whatsapp.com/send?phone=…&text=…`.
- Verifies the text was pre-filled into the input box.
- **Never** clicks the send button.
- **Never** presses Enter inside the input.
- **Never** modifies the input after pre-fill.

You manually click send in the WA Web window, then click "Mark sent" in this app's dashboard.
