/**
 * Mwalimu Cosmetics — check the in-exe QR encoder against implementations
 * that did not come out of the same head.
 *
 * ── Why ───────────────────────────────────────────────────────────────
 *
 * FumasV5/QrCode.cs contains tables transcribed by hand from ISO/IEC 18004.
 * Transcription errors are silent: the symbol looks perfectly convincing and
 * simply does not decode, or decodes on one phone and not another. Reading
 * the tables back is worthless — it is the same eyes making the same mistake
 * twice.
 *
 * Two independent checks, and they fail in different ways, which is the
 * point of having both:
 *
 *   1. MATRIX — generate the same payload with the `qrcode` npm package and
 *      compare every module. This catches a wrong block count or generator
 *      polynomial even when the symbol still happens to decode, because a
 *      reader's error correction can paper over a handful of wrong modules
 *      right up until the day a slip is smudged.
 *
 *   2. DECODE — read the PNG the harness rendered at 203 dpi, at the size
 *      the slip actually prints it, with jsqr. This is the question that
 *      matters in the shop: can a phone read this off a till roll? A symbol
 *      can be mathematically perfect and still be unreadable if Draw lays it
 *      down badly at print scale.
 *
 * Usage:
 *   node bridge/tickets/verify-qr.js <dir-with-matrices.txt>
 */

const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const jsQR = require("jsqr");
const { PNG } = require("pngjs");

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node verify-qr.js <dir containing matrices.txt>");
  process.exit(2);
}

function parseManifest(file) {
  const cases = [];
  let cur = null;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!raw) continue;
    const p = raw.split("\t");
    if (p[0] === "CASE") {
      cur = {
        name: p[1],
        ecc: p[2],
        version: p[3] === "REFUSED" ? null : parseInt(p[3], 10),
        // The payload may itself contain tabs in principle; rejoin the tail.
        text: p.slice(4).join("\t"),
        rows: [],
        png: null
      };
      cases.push(cur);
    } else if (p[0] === "PNG" && cur) {
      cur.png = p[1];
    } else if (p[0] === "ROW" && cur) {
      cur.rows.push(p[1]);
    }
  }
  return cases;
}

// The reference encoder's matrix, as rows of '0'/'1' so the two can be
// compared as plain strings.
//
// Byte mode is FORCED. Left to itself, `qrcode` splits a payload into mixed
// segments — "t.me/…?start=E001" becomes Byte + Numeric, because the trailing
// digits pack tighter as numeric. That is a real optimisation and a perfectly
// valid symbol; it is simply not the same symbol, so comparing against it
// would report a difference that is not a defect. QrCode.cs implements byte
// mode only and says so, and this is the comparison that tests that claim.
// Both symbols decode to identical text either way, which is what case 2
// checks.
function referenceRows(text, ecc) {
  const qr = QRCode.create([{ data: text, mode: "byte" }], { errorCorrectionLevel: ecc });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const rows = [];
  for (let r = 0; r < size; r++) {
    let row = "";
    for (let c = 0; c < size; c++) row += data[r * size + c] ? "1" : "0";
    rows.push(row);
  }
  return { rows, version: qr.version };
}

function decodePng(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const res = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return { text: res ? res.data : null, width: png.width };
}

function firstDifference(a, b) {
  for (let r = 0; r < Math.min(a.length, b.length); r++) {
    if (a[r] !== b[r]) {
      for (let c = 0; c < a[r].length; c++) {
        if (a[r][c] !== b[r][c]) return "row " + r + ", column " + c;
      }
      return "row " + r;
    }
  }
  return "different heights: " + a.length + " vs " + b.length;
}

const cases = parseManifest(path.join(dir, "matrices.txt"));

let matrixOk = 0, matrixBad = 0, decodeOk = 0, decodeBad = 0, refused = 0;
const problems = [];

for (const c of cases) {
  if (c.version === null) { refused++; continue; }

  // --- 1. matrix against the reference encoder ---
  let ref;
  try {
    ref = referenceRows(c.text, c.ecc);
  } catch (e) {
    problems.push(c.name + " " + c.ecc + ": reference encoder refused - " + e.message);
    matrixBad++;
    continue;
  }

  const same =
    ref.rows.length === c.rows.length &&
    ref.rows.every((r, i) => r === c.rows[i]);

  if (same) {
    matrixOk++;
  } else {
    matrixBad++;
    const detail = ref.version !== c.version
      ? "version " + c.version + " vs reference " + ref.version
      : firstDifference(c.rows, ref.rows);
    problems.push(c.name + " " + c.ecc + ": matrix differs (" + detail + ")");
  }

  // --- 2. decode the printed-size render ---
  if (c.png) {
    const file = path.join(dir, c.png);
    if (!fs.existsSync(file)) {
      decodeBad++;
      problems.push(c.name + " " + c.ecc + ": png missing");
    } else {
      const got = decodePng(file);
      if (got.text === c.text) {
        decodeOk++;
      } else {
        decodeBad++;
        problems.push(c.name + " " + c.ecc + ": decoded " +
          (got.text === null ? "NOTHING" : JSON.stringify(got.text.slice(0, 40))) +
          " at " + got.width + "px, expected " + JSON.stringify(c.text.slice(0, 40)));
      }
    }
  }
}

console.log("Cases:              " + cases.length + " (" + refused + " correctly refused as too long)");
console.log("Matrix vs `qrcode`: " + matrixOk + " identical, " + matrixBad + " differing");
console.log("Decoded by jsqr:    " + decodeOk + " read back, " + decodeBad + " failed");

if (problems.length) {
  console.log("\nProblems:");
  for (const p of problems) console.log("  " + p);
} else {
  console.log("\nEvery symbol matches an independent encoder bit for bit,");
  console.log("and every one decodes at the size the slip prints it.");
}

process.exitCode = problems.length ? 1 : 0;
