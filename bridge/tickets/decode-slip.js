/**
 * Mwalimu Cosmetics — read the QR codes back off a rendered ticket slip.
 *
 * ── Why not just decode the codes in isolation ────────────────────────
 *
 * verify-qr.js already proves the encoder: every symbol matches an
 * independent implementation and decodes at print size. This asks a
 * different and later question — did the SLIP put them down properly?
 *
 * Between a correct matrix and a customer's phone sit the layout, the
 * rectangle drawing, the scale the slip chose, and whatever the printer
 * driver did to it. A code can be mathematically perfect and still be
 * unreadable because it was drawn too small, or clipped at the margin, or
 * laid down without a quiet zone because something else was placed too close
 * underneath it.
 *
 * ── Finding both ──────────────────────────────────────────────────────
 *
 * jsqr returns one code per pass. Rather than crop where the codes are
 * expected — which would quietly stop testing the layout the moment the
 * layout changed — each code found is painted over and the image scanned
 * again. Whatever is on the slip is what gets reported.
 *
 * Usage:
 *   node bridge/tickets/decode-slip.js <slip.png> [more.png ...]
 */

const fs = require("fs");
const path = require("path");
const jsQR = require("jsqr");
const { PNG } = require("pngjs");

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node decode-slip.js <slip.png> [...]");
  process.exit(2);
}

function whiteOut(png, loc, pad) {
  const xs = [loc.topLeftCorner.x, loc.topRightCorner.x,
              loc.bottomLeftCorner.x, loc.bottomRightCorner.x];
  const ys = [loc.topLeftCorner.y, loc.topRightCorner.y,
              loc.bottomLeftCorner.y, loc.bottomRightCorner.y];
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - pad);
  const x1 = Math.min(png.width, Math.ceil(Math.max(...xs)) + pad);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - pad);
  const y1 = Math.min(png.height, Math.ceil(Math.max(...ys)) + pad);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4;
      png.data[i] = 255; png.data[i + 1] = 255; png.data[i + 2] = 255; png.data[i + 3] = 255;
    }
  }
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

let total = 0;
let problems = 0;

for (const file of files) {
  console.log("\n" + path.basename(file));

  if (!fs.existsSync(file)) {
    console.log("  missing");
    problems++;
    continue;
  }

  const png = PNG.sync.read(fs.readFileSync(file));
  console.log("  " + png.width + " x " + png.height + " px");

  const found = [];
  // Four passes at most: two codes are expected, and a runaway loop on a
  // pathological image is not worth risking.
  for (let pass = 0; pass < 4; pass++) {
    const res = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    if (!res) break;
    const box = whiteOut(png, res.location, 2);
    found.push({ text: res.data, box });
  }

  if (!found.length) {
    console.log("  NO CODE FOUND — a slip that should carry two");
    problems++;
    continue;
  }

  for (const f of found) {
    total++;
    // Sorted left to right so the output reads in the order they print.
    console.log("  at x=" + f.box.x0 + " y=" + f.box.y0 +
      "  " + f.box.w + "x" + f.box.h + "px   " + JSON.stringify(f.text));
  }

  const kinds = found.map(f =>
    /t\.me\//.test(f.text) ? "telegram" :
    /\/r\/[0-9A-Za-z]{22}$/.test(f.text) ? "receipt" : "unknown");

  console.log("  -> " + kinds.join(" + "));
  if (kinds.indexOf("unknown") !== -1) {
    console.log("  a code decoded to something unrecognised");
    problems++;
  }
}

console.log("\n" + total + " code(s) decoded off " + files.length + " slip(s).");
if (problems) {
  console.log(problems + " problem(s).");
  process.exitCode = 1;
} else {
  console.log("Every code on every slip was readable.");
}
