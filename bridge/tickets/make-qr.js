/**
 * Mwalimu Cosmetics — generate the ticket QR pool, once.
 *
 * ── Why a pool of images instead of encoding on the fly ───────────────
 *
 * Nothing on the tills can encode a QR. The only barcode library installed
 * (BarcodeLib.dll) does one-dimensional codes, there is no QR encoder among
 * the vendored DLLs, and adding one to a .NET 3.5 application that is
 * distributed by copying a single .exe around a LAN is a lot of moving parts
 * for one square of dots.
 *
 * It is also unnecessary. Ticket numbers come from a small fixed set — three
 * bands, numbered from 001, reset every trading day — so the complete set of
 * possible codes is a few hundred strings that never change. They are drawn
 * once here and copied to the tills as ordinary files.
 *
 * ── What the QR contains ──────────────────────────────────────────────
 *
 * https://t.me/<bot>?start=E042
 *
 * A Telegram deep link. Scanning it opens the bot and silently sends
 * "/start E042", which is what tells the announcer which chat belongs to which
 * ticket — a bot cannot message a phone number, only reply to somebody who has
 * messaged it first.
 *
 * The payload carries no date. A code scanned tomorrow would refer to
 * tomorrow's E-042, so the announcer only ever links a scan to a ticket that
 * is still open today and tells the customer plainly when it cannot.
 *
 * Usage:
 *   node make-qr.js --bot MwalimuCosmeticsBot [--max 300] [--out ./qr]
 */

const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const bot = arg("bot", "");
const max = parseInt(arg("max", "300"), 10);
const outDir = path.resolve(arg("out", path.join(__dirname, "qr")));
const BANDS = ["E", "B", "C"];

if (!bot) {
  console.error("Give the bot username: node make-qr.js --bot MwalimuCosmeticsBot");
  process.exit(1);
}

// Small, high-contrast, and no quiet-zone waste. The slip prints these at
// 80pt square on a thermal head that cannot resolve fine detail, so error
// correction is set high: a slip that has been in a pocket, folded once, and
// handed over a counter still has to scan.
const OPTIONS = {
  errorCorrectionLevel: "H",
  margin: 1,
  scale: 8,
  color: { dark: "#000000ff", light: "#ffffffff" }
};

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  let written = 0;
  for (const band of BANDS) {
    for (let n = 1; n <= max; n++) {
      const seq = String(n).padStart(3, "0");
      const code = band + "-" + seq;          // what the slip shows, and the file name
      const payload = band + seq;             // what /start carries: no dash, Telegram is fussy
      const url = "https://t.me/" + bot + "?start=" + payload;
      await QRCode.toFile(path.join(outDir, code + ".png"), url, OPTIONS);
      written++;
    }
  }

  const sample = path.join(outDir, "E-001.png");
  const bytes = fs.statSync(sample).size;
  let total = 0;
  for (const f of fs.readdirSync(outDir)) total += fs.statSync(path.join(outDir, f)).size;

  console.log("Wrote " + written + " QR images to " + outDir);
  console.log("Bands: " + BANDS.join(", ") + "   numbers: 001-" + String(max).padStart(3, "0"));
  console.log("Each about " + bytes + " bytes; " + (total / 1024).toFixed(0) + " KB in total.");
  console.log("");
  console.log("Sample payload: https://t.me/" + bot + "?start=E001");
  console.log("");
  console.log("Copy the folder to each till as <install>\\Tickets\\qr\\, e.g.");
  console.log("  robocopy \"" + outDir + "\" \"C:\\futuresoft\\Debugv5\\Tickets\\qr\" /MIR");
  console.log("");
  console.log("Then set the bot name so the slip knows to print them:");
  console.log("  update mw_settings set svalue='" + bot + "' where skey='ticket.bot';");
}

main().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
