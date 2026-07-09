// electron-builder afterPack hook — ad-hoc code-sign the packed macOS .app.
//
// We deliberately DON'T let electron-builder do cert signing (package.mjs passes
// --config.mac.identity=null so an empty CI CSC_* secret can't crash the build).
// But identity=null means "skip signing", leaving only the linker's ad-hoc stub
// on the main executable with no sealed resources — which macOS flags as
// "damaged" once the download quarantine bit is set.
//
// A real ad-hoc signature (codesign --sign -) seals the whole bundle. It is NOT
// a Developer ID cert and NOT notarization (no Apple account, no secrets), so it
// stays within the "no code signing" cost decision. Effect for a downloader: the
// Gatekeeper message drops from "damaged / move to bin" (no way out but Terminal)
// to "unidentified developer" (System Settings > Privacy & Security > Open Anyway).
//
// Windows/Linux packs are ignored. If codesign fails we throw — a silently
// unsigned mac build is exactly the state we're trying to leave.

const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = join(context.appOutDir, appName);

  // --deep signs nested code (Electron helpers, frameworks, the bundled Chromium,
  // better-sqlite3.node) inside-out; --force replaces the linker stub. Ad-hoc
  // identity is the literal "-". No hardened runtime: that is only needed for
  // notarization, which we don't do, and it can only make an ad-hoc build fussier.
  console.log(`[afterPack] ad-hoc signing ${appName} ...`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  });

  // Fail loudly if the seal didn't take — better a failed build than a "damaged" one.
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit',
  });
  console.log(`[afterPack] ad-hoc signature verified for ${appName}`);
};
