/**
 * Assemble a runnable, self-contained folder without electron-builder.
 *
 * electron-builder shells out to app-builder.exe, which Windows Defender
 * quarantines on this machine as a false positive — the file appears after
 * install and is gone moments later. Rather than weaken the machine's
 * security settings to work around that, this assembles the same thing by
 * hand: Electron's runtime plus the app and the handful of modules it needs,
 * with the executable renamed.
 *
 * The result runs from any folder and needs no installation, which also
 * makes it the easier thing to try on a shop PC.
 *
 *   node build-portable.js
 *   → release/MwalimuCosmetics-portable/Mwalimu Cosmetics.exe
 */

const fs = require("fs");
const path = require("path");

const APP_DIR   = __dirname;
const REPO_ROOT = path.resolve(APP_DIR, "..", "..");
const ELECTRON  = path.join(REPO_ROOT, "node_modules", "electron", "dist");
const OUT       = path.join(APP_DIR, "release", "MwalimuCosmetics-portable");
const RES_APP   = path.join(OUT, "resources", "app");

const PRODUCT = "Mwalimu Cosmetics";

/** Runtime dependencies. mysql is pure JavaScript, so nothing needs building. */
const MODULES = [
  "mysql", "bignumber.js", "readable-stream", "safe-buffer", "sqlstring",
  "core-util-is", "inherits", "isarray", "process-nextick-args",
  "string_decoder", "util-deprecate",
];

function copyDir(src, dest, skip = () => false) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d, skip);
    else if (entry.isSymbolicLink()) {
      // Workspace links must become real files, or the copy is useless
      // anywhere but this machine.
      try { copyDir(fs.realpathSync(s), d, skip); } catch { /* dangling */ }
    } else fs.copyFileSync(s, d);
  }
  return true;
}

function findModule(name) {
  for (const base of [path.join(APP_DIR, "node_modules"), path.join(REPO_ROOT, "node_modules")]) {
    const p = path.join(base, name);
    if (fs.existsSync(p)) return fs.existsSync(fs.realpathSync(p)) ? fs.realpathSync(p) : p;
  }
  return null;
}

function main() {
  if (!fs.existsSync(ELECTRON)) {
    console.error(`Electron runtime not found at ${ELECTRON}`);
    process.exit(1);
  }
  for (const required of ["dist", "dist-electron"]) {
    if (!fs.existsSync(path.join(APP_DIR, required))) {
      console.error(`Missing ${required}. Run: npx vite build && npx tsc -p tsconfig.electron.json`);
      process.exit(1);
    }
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  console.log("Copying the Electron runtime…");
  // The bundled default app is Electron's own placeholder and only confuses
  // things once a real app is present.
  copyDir(ELECTRON, OUT, name => name === "resources");
  fs.mkdirSync(path.join(OUT, "resources"), { recursive: true });

  const exe = path.join(OUT, `${PRODUCT}.exe`);
  fs.renameSync(path.join(OUT, "electron.exe"), exe);
  console.log(`  ${PRODUCT}.exe`);

  console.log("Copying the application…");
  fs.mkdirSync(RES_APP, { recursive: true });
  copyDir(path.join(APP_DIR, "dist"), path.join(RES_APP, "dist"));
  copyDir(path.join(APP_DIR, "dist-electron"), path.join(RES_APP, "dist-electron"));

  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, "package.json"), "utf8"));
  fs.writeFileSync(path.join(RES_APP, "package.json"), JSON.stringify({
    name: pkg.name,
    productName: PRODUCT,
    version: pkg.version,
    main: "dist-electron/main.js",
    author: pkg.author,
  }, null, 2));

  console.log("Copying runtime modules…");
  const core = findModule(path.join("@mwalimu", "fumas-core"));
  if (!core) {
    console.error("fumas-core not found. Run: npm run build --workspace=@mwalimu/fumas-core");
    process.exit(1);
  }
  // Only the built output and manifest; sources and tests would just add bulk.
  const coreOut = path.join(RES_APP, "node_modules", "@mwalimu", "fumas-core");
  fs.mkdirSync(coreOut, { recursive: true });
  copyDir(path.join(core, "dist"), path.join(coreOut, "dist"));
  fs.copyFileSync(path.join(core, "package.json"), path.join(coreOut, "package.json"));
  console.log("  @mwalimu/fumas-core");

  for (const name of MODULES) {
    const found = findModule(name);
    if (!found) { console.warn(`  ${name} — not found, skipped`); continue; }
    copyDir(found, path.join(RES_APP, "node_modules", name),
            n => n === "node_modules" || n === "test" || n === ".github");
    console.log(`  ${name}`);
  }

  fs.writeFileSync(path.join(OUT, "READ ME FIRST.txt"),
`${PRODUCT}
${"=".repeat(PRODUCT.length)}

Run "${PRODUCT}.exe" in this folder. There is nothing to install.

On first launch the sign-in screen checks that it can reach the shop's
database and reports what it found. If it cannot connect, choose
"Open settings" to enter the server details.

Sign in with the username and password you already use for FumasV5.

This version can only READ. Nothing you do here can change the shop's
records, so explore freely.

Settings are kept in C:\\ProgramData\\Mwalimu\\config.json, outside this
folder, so replacing the folder with a newer version keeps them.
`, "utf8");

  const size = (dir) => {
    let total = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      total += e.isDirectory() ? size(p) : fs.statSync(p).size;
    }
    return total;
  };

  console.log("");
  console.log(`Built ${OUT}`);
  console.log(`Size  ${(size(OUT) / 1024 / 1024).toFixed(0)} MB`);
  console.log(`Run   "${PRODUCT}.exe"`);
}

main();
