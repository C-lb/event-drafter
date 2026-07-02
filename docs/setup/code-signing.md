# Code signing & notarization (Task 6)

The desktop installers built by `npm run desktop:dist` are **unsigned** until you add
the secrets below. Unsigned apps still run, but the OS warns hard:

- **macOS** Gatekeeper: "Event Drafter is damaged / cannot be opened" — user must
  right-click → Open, or run `xattr -dr com.apple.quarantine "/Applications/Event Drafter.app"`.
- **Windows** SmartScreen: "Windows protected your PC" — user must click
  "More info → Run anyway".

Signing removes the macOS warning entirely and softens (OV) or removes (EV / reputation)
the Windows one.

Everything here is **credential-gated**: the build skips signing when the secrets are
absent, so nothing breaks before you have certificates. The wiring lives in
`packages/desktop/electron-builder.yml`, `packages/desktop/scripts/package.mjs`, and
`.github/workflows/release.yml`.

---

## macOS — Developer ID + notarization

### What you need
1. **Apple Developer Program** membership ($99/yr). Lead time: usually same-day, but
   can take longer for org accounts — start early.
2. A **"Developer ID Application"** certificate (NOT "Apple Distribution" — that's for
   the App Store). Create it in Xcode (Settings → Accounts → Manage Certificates → +)
   or at developer.apple.com → Certificates.
3. An **app-specific password** for notarization: appleid.apple.com → Sign-In & Security
   → App-Specific Passwords. (Alternative: an App Store Connect API key — see note.)
4. Your **Team ID** (10 chars): developer.apple.com → Membership.

### Export the cert for CI
In Keychain Access, find "Developer ID Application: <you> (TEAMID)", right-click →
Export → `.p12` with a password. Then base64 it:

```sh
base64 -i developer-id.p12 | pbcopy   # now in clipboard
```

### GitHub secrets (Settings → Secrets and variables → Actions)
| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | base64 of the `.p12` |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` export password |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | your 10-char Team ID |

When `APPLE_TEAM_ID` is set, the workflow turns on notarization automatically
(`ED_NOTARIZE=1`).

### Building & signing locally on your Mac
If the Developer ID cert is already in your login keychain, electron-builder finds it
automatically — no env vars needed for *signing*. To also *notarize* locally:

```sh
export ED_NOTARIZE=1
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"
npm run desktop:dist
```

> App Store Connect API key instead of Apple ID: set `APPLE_API_KEY` (path to the `.p8`),
> `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` in the env instead of `APPLE_ID` /
> `APPLE_APP_SPECIFIC_PASSWORD`. Keep `ED_NOTARIZE=1` + `APPLE_TEAM_ID`.

### Verify
```sh
codesign -dvvv "/Applications/Event Drafter.app"          # Authority = Developer ID
spctl -a -vvv "/Applications/Event Drafter.app"           # => accepted, source=Notarized Developer ID
xcrun stapler validate "/Applications/Event Drafter.app"  # => The validate action worked!
```

### ⚠️ The bundled-Chromium caveat (most likely thing to debug)
This app ships a full Playwright Chromium *inside* `Contents/Resources/ms-playwright/`,
and loads a native addon (`better_sqlite3.node`). Both are signed by someone other than
your Team. We already handle this in `build/entitlements.mac.plist` with
`com.apple.security.cs.disable-library-validation` (so the hardened runtime will load
them) plus `allow-jit` / `allow-unsigned-executable-memory` / `allow-dyld-environment-variables`.

Still verify on the **first real signed build**: notarization (`notarytool`) inspects
every nested Mach-O, and the bundled Chromium's helper apps must each end up signed with
your Developer ID + hardened runtime. electron-builder re-signs nested binaries by
default, which normally satisfies this. If notarization is rejected, run
`xcrun notarytool log <submission-id> --apple-id ...` to see exactly which binary failed,
then either add it to `mac.signIgnore` (if it's already validly signed and self-contained)
or confirm electron-builder is descending into the `ms-playwright` tree. As a last resort,
stop bundling Chromium and download it at first run instead.

---

## Windows — Authenticode

### What you need (pick one)
- **Azure Trusted Signing** (recommended: cheap, no hardware token, ~$10/mo, EV-grade
  reputation). Requires a verified Azure account + a Trusted Signing account/profile.
- **OV certificate** (file-based `.pfx`, cheapest one-off; SmartScreen reputation builds
  up over downloads).
- **EV certificate** (hardware token or cloud HSM; instant SmartScreen trust, pricier,
  identity-verification lead time of days).

### File-based cert (OV, or EV via cloud HSM exposed as .pfx)
Base64 the `.pfx`:

```sh
base64 -i codesign.pfx | pbcopy
```

GitHub secrets:
| Secret | Value |
| --- | --- |
| `WIN_CSC_LINK` | base64 of the `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | the `.pfx` password |

electron-builder signs the NSIS `.exe` + `.msi` automatically when these are present.

### Verify
```powershell
signtool verify /pa /v "Event Drafter Setup 0.1.0.exe"
```

> **Azure Trusted Signing** uses a different mechanism (a signing endpoint, not a `.pfx`).
> If you go that route, we'll switch `win` in `electron-builder.yml` to
> `azureSignOptions` and add the `AZURE_*` secrets — ping me and I'll wire it.

---

## Releasing

Tag a version and push — the `release` workflow builds both OSes, signs (if secrets
exist), notarizes macOS, and attaches the `.dmg` / `.pkg` / `.exe` / `.msi` to the
GitHub Release:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

Or run it manually from the Actions tab (`workflow_dispatch`) to get unsigned artifacts
without cutting a release.
