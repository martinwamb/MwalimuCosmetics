// Mwalimu Sync Loop — keeps pusher.js running on the bridge PC.
//
// ── Why this file is in the repo ──────────────────────────────────────
//
// It lives at C:\MwalimuSync\loop.js on the bridge machine and is started at
// logon by a one-line MwalimuSync.vbs in the Startup folder. It was not in the
// repo, which meant the ACTUAL cadence of the whole sync was knowable only by
// reading a file on one laptop — and it disagreed with bridge/loop.ps1, which
// is in the repo, is not what runs, and polls every five seconds.
//
// ── The interval ─────────────────────────────────────────────────────
//
// Twenty seconds, matched to LIVE_EVERY_MS in pusher.js.
//
// It used to be ten minutes, which was fine when the agent only pushed metrics
// and waited for somebody to click Refresh on the dashboard. It is far too
// slow now that the shop screen customers watch and the web ticket board are
// both fed from here: a collection number that appears on the wall ten minutes
// after the picker marked it ready is worse than no screen at all, because
// people will stand and trust it.
//
// Each run is cheap — one API call to ask whether anything is wanted, and a
// throttled ticket push. The expensive work (products, the stran scan) is
// still gated behind an explicit refresh request inside pusher.js.
//
// ── Overlap ──────────────────────────────────────────────────────────
//
// A run that outlives the interval must not have a second one started on top
// of it. Two agents against the shop's MySQL at once is how a slow query
// becomes two slow queries, and the POS feels it.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const HOME = "C:\\MwalimuSync\\";
const PUSHER = HOME + "pusher.js";
const LOG = HOME + "sync.log";
const INTERVAL = 20 * 1000;

// node.exe is not always where it was last time somebody looked.
//
// The portable copy comes first. None of the shop PCs have Node installed and
// none of them should need an installer run on them by hand, so the bridge
// carries its own node.exe beside itself. A machine that also happens to have
// a system-wide install still works; this just stops the bridge depending on
// one being there.
function findNode() {
  const candidates = [
    HOME + "node\\node.exe",
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Program Files (x86)\\nodejs\\node.exe",
    process.execPath
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (e) { /* keep looking */ }
  }
  return process.execPath;
}

const NODE = findNode();

let running = false;

function note(line) {
  try {
    fs.appendFileSync(LOG, new Date().toISOString() + " " + line + "\n");
  } catch (e) {
    // A loop that dies because it could not write its own log would be a poor
    // trade. Nothing to do here but carry on.
  }
}

function trimLog() {
  try {
    if (!fs.existsSync(LOG)) return;
    if (fs.statSync(LOG).size < 5 * 1024 * 1024) return;
    const kept = fs.readFileSync(LOG, "utf8").split("\n").slice(-2000).join("\n");
    fs.writeFileSync(LOG, kept);
  } catch (e) { /* not worth stopping for */ }
}

function runSync() {
  // The guard, not a nicety. At twenty seconds a run that takes longer than
  // that is not unusual, and without this they would pile up.
  if (running) return;
  running = true;

  let proc;
  try {
    proc = spawn(NODE, [PUSHER], { stdio: "ignore", detached: false });
  } catch (e) {
    running = false;
    note("spawn failed: " + e.message);
    return;
  }

  proc.on("error", err => { running = false; note("agent error: " + err.message); });
  proc.on("exit", code => {
    running = false;
    // Only failures are logged. At this cadence a line per run would be four
    // thousand lines a day of "exit=0", which buries the one line that matters.
    if (code !== 0) note("exit=" + code);
    trimLog();
  });
}

// ── One loop, and only one ────────────────────────────────────────────
//
// The scheduled task that starts this also re-runs it every few minutes, so
// that a loop which has died — or a machine where nobody has logged in since a
// crash — comes back on its own rather than waiting for somebody to notice the
// shop has gone quiet.
//
// That only works if a second copy refuses to start. Two loops means two
// agents against the shop's MySQL, and the POS feels it.
//
// The pid file is checked, not trusted: a machine that lost power leaves one
// behind pointing at a pid that no longer exists, and treating that as "already
// running" would mean the bridge never starts again.
const LOCK = HOME + "loop.pid";

function alreadyRunning() {
  try {
    if (!fs.existsSync(LOCK)) return false;
    const pid = parseInt(fs.readFileSync(LOCK, "utf8").trim(), 10);
    if (!pid || pid === process.pid) return false;
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH: no such process — the file is stale and this instance takes over.
    return false;
  }
}

if (alreadyRunning()) {
  process.exit(0);
}

try { fs.writeFileSync(LOCK, String(process.pid)); } catch (e) { /* not fatal */ }
process.on("exit", () => { try { fs.unlinkSync(LOCK); } catch (e) {} });

note("Sync loop started (" + (INTERVAL / 1000) + "s) using " + NODE);
runSync();
setInterval(runSync, INTERVAL);

// Nothing holds this process open otherwise.
process.stdin.resume();
