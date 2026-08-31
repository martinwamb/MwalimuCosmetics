/**
 * Mwalimu Cosmetics — the ticket announcer.
 *
 * Runs on the laptop. Watches the tickets table, and when a picker presses
 * Ready at any till it does the two things the till cannot:
 *
 *   1. Calls the number out loud, through whatever speakers this laptop is
 *      plugged into.
 *   2. Sends the customer a Telegram message, if they scanned the QR on their
 *      slip while they were waiting.
 *
 * ── Why this is not in FumasV5 ────────────────────────────────────────
 *
 * Nine of the eleven tills have no internet at all, and none of them are wired
 * to the shop speakers. A till that tried to do either of these itself would
 * work on one machine and fail silently on the rest. So FumasV5 does the one
 * thing it can do reliably — set state='READY' on a row — and everything the
 * customer experiences hangs off that single change, watched from here.
 *
 * It also means a laptop that is switched off costs the shop nothing but the
 * announcements: tickets still issue, print, and are marked ready all day. The
 * backlog is picked up when the laptop returns.
 *
 * ── Why not part of pusher.js ─────────────────────────────────────────
 *
 * pusher.js exits every cycle and is restarted by loop.ps1 every five seconds,
 * so it cannot hold a Telegram long poll open. It is also the sync agent for
 * the whole business, and a bug in bot code has no business taking that down.
 *
 * ── Telegram, and why there is a QR at all ────────────────────────────
 *
 * A bot cannot message a phone number. It can only reply to somebody who has
 * messaged it first. The QR on the slip is a deep link that sends "/start
 * E042" on the customer's behalf the moment they scan it, and that is what
 * ties their chat to their ticket.
 *
 * ── Why scans arrive via the server ───────────────────────────────────
 *
 * @mwalimucosmetics_bot already has a live webhook serving the website's order
 * notifications, and a bot can have a webhook or long polling but never both.
 * Calling getUpdates here would have taken those notifications down.
 *
 * So the scan goes to the webhook the bot already has, is parked in a
 * TicketLink row, and this process collects it over the API — the same
 * api.mwalimucosmetics.com the sync agent already talks to, with the same
 * x-sync-secret. Sending is unaffected by any of that: sendMessage works
 * alongside a webhook, so the goods-are-ready message goes straight from here
 * to Telegram, and falls back to the server only when the shop WiFi can reach
 * the server but not Telegram.
 *
 * Usage:
 *   node announcer.js                 run forever
 *   node announcer.js --once          one pass, then exit (for testing)
 *   node announcer.js --say E-042     say a number and exit (test the speakers)
 *   node announcer.js --no-telegram   speakers only
 *   node announcer.js --no-speak     Telegram and linking only, no speaking
 *
 * Config: C:\MwalimuSync\ticket-config.json
 *   { "botToken": "...", "voice": "", "api": "https://api.mwalimucosmetics.com",
 *     "syncSecret": "..." }
 * or TELEGRAM_BOT_TOKEN / MWALIMU_API / MWALIMU_SYNC_SECRET in the environment.
 * Neither the token nor the secret is ever committed.
 */

const fs = require("fs");
const https = require("https");
const { spawn } = require("child_process");
const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions, describeConfigSource } = require("./../db-config.js");

const ONCE = process.argv.includes("--once");
const NO_TELEGRAM = process.argv.includes("--no-telegram");

// Speaking moved to the browser on the screen laptop, which is the machine
// actually wired to the shop's amplifier. This process still does the two
// things only it can do — claiming scans and messaging customers — and stays
// silent so a number is not called twice from two rooms.
const NO_SPEAK = process.argv.includes("--no-speak");
const SAY_INDEX = process.argv.indexOf("--say");
const SAY_ONLY = SAY_INDEX >= 0 ? process.argv[SAY_INDEX + 1] : null;

const CONFIG_PATH = "C:\\MwalimuSync\\ticket-config.json";
const POLL_MS = 3000;
// Scans are collected less often than tickets are announced. A customer who
// has just scanned is not waiting on this — the server already replied to
// them — so five seconds costs nothing and keeps the API quiet.
const LINK_POLL_MS = 5000;

function loadConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    // Absent is normal on a machine that only needs the speakers.
  }
  if (!cfg.botToken && process.env.TELEGRAM_BOT_TOKEN) cfg.botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!cfg.api) cfg.api = process.env.MWALIMU_API || "https://api.mwalimucosmetics.com";
  // The same secret the sync agent already uses, so nothing new has to be
  // distributed to this machine.
  if (!cfg.syncSecret) cfg.syncSecret = process.env.MWALIMU_SYNC_SECRET || "mwalimu-sync-secret";
  return cfg;
}

const config = loadConfig();
const TOKEN = NO_TELEGRAM ? "" : (config.botToken || "");
const API = String(config.api || "").replace(/\/+$/, "");

// ── Speaking ──────────────────────────────────────────────────────────

// "E-042" becomes "E, zero four two".
//
// Digits are said one at a time on purpose. "Forty-two" and "forty-eight"
// are nearly the same word across a busy shop with a fan running; "four two"
// and "four eight" are not. The band letter is said first because that is what
// is printed largest on the slip.
function speakable(code) {
  const digits = {
    "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four",
    "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine"
  };
  const parts = String(code).split("-");
  const band = parts[0] || "";
  const seq = (parts[1] || "").split("").map(d => digits[d] || d).join(" ");
  return band + ", " + seq;
}

function say(code) {
  return new Promise(resolve => {
    const phrase = "Ticket " + speakable(code) + ", your goods are ready for collection.";
    // Doubling single quotes is how a literal one is escaped inside a
    // single-quoted PowerShell string. Ticket codes are [EBC] and digits only,
    // so nothing here can carry a quote, but the escape stays: the day
    // somebody makes the phrase configurable is the day it would matter.
    const safe = phrase.replace(/'/g, "''");
    const voice = (config.voice || "").replace(/'/g, "''");

    const script =
      "Add-Type -AssemblyName System.Speech; " +
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
      (voice ? "try { $s.SelectVoice('" + voice + "') } catch {}; " : "") +
      "$s.Volume = 100; $s.Rate = -1; " +
      // A chime first. People do not look up at the start of a sentence, so
      // without it the ticket number is the part that gets missed.
      "[console]::beep(880,180); [console]::beep(1170,220); " +
      "$s.Speak('" + safe + "'); " +
      // Said twice, because somebody who looked up on the chime has already
      // missed half of the first one.
      "Start-Sleep -Milliseconds 400; $s.Speak('" + safe + "'); " +
      "$s.Dispose();";

    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true });
    let err = "";
    ps.stderr.on("data", d => { err += d.toString(); });
    ps.on("close", codeOut => {
      if (codeOut !== 0) console.log("  speech failed (" + codeOut + "): " + err.trim());
      resolve(codeOut === 0);
    });
    ps.on("error", e => { console.log("  speech failed: " + e.message); resolve(false); });
  });
}

// ── Telegram ──────────────────────────────────────────────────────────

function telegram(method, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!TOKEN) return resolve(null);
    const body = JSON.stringify(payload || {});
    const req = https.request({
      host: "api.telegram.org",
      path: "/bot" + TOKEN + "/" + method,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: timeoutMs || 15000
    }, res => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.ok) return reject(new Error(method + ": " + (parsed.description || data)));
          resolve(parsed.result);
        } catch (e) {
          reject(new Error(method + ": unreadable reply: " + data.slice(0, 200)));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(method + ": timed out")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// The shop's own API, where customer scans are parked by the webhook.
function api(method, path, body) {
  return new Promise((resolve, reject) => {
    if (!API) return resolve(null);
    const url = new URL(API + path);
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = { "x-sync-secret": config.syncSecret };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = https.request({
      host: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method,
      headers: headers,
      timeout: 15000
    }, res => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(method + " " + path + ": HTTP " + res.statusCode + " " + data.slice(0, 160)));
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(method + " " + path + ": unreadable reply")); }
      });
    });
    req.on("timeout", () => req.destroy(new Error(method + " " + path + ": timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Database ──────────────────────────────────────────────────────────

const cfg = getMysqlConfig();
let conn;

function connect() {
  return new Promise((resolve, reject) => {
    conn = mysql.createConnection(toDriverOptions(cfg));
    conn.connect(e => (e ? reject(e) : resolve()));
    // A connection that dies overnight must not take the process with it; the
    // next cycle reconnects.
    conn.on("error", e => { console.log("db connection lost: " + e.code); conn = null; });
  });
}

const q = (sql, args) =>
  new Promise((res, rej) => {
    if (!conn) return rej(new Error("no connection"));
    conn.query({ sql, timeout: 20000 }, args || [], (e, r) => (e ? rej(e) : res(r)));
  });

async function ensureConnected() {
  if (conn) return;
  await connect();
}

// ── The three jobs ────────────────────────────────────────────────────

// Anything marked ready that has not been called out yet.
async function announce() {
  const rows = await q(
    "select ticket_day, ticket_code from tickets " +
    "where state = 'READY' and announced_at is null and ticket_day = curdate() " +
    "order by ready_at asc limit 5");

  for (const r of rows) {
    console.log(stamp() + (NO_SPEAK ? "  ready " : "  calling ") + r.ticket_code);
    if (!NO_SPEAK) await say(r.ticket_code);
    // Stamped after speaking, not before: if this process is killed
    // mid-sentence the number is called again on restart, which is far better
    // than a customer never being called at all.
    await q("update tickets set announced_at = now() where ticket_day = ? and ticket_code = ?",
      [r.ticket_day, r.ticket_code]);
  }
  return rows.length;
}

// Anything ready, linked to a chat, and not yet messaged.
async function notify() {
  if (!TOKEN) return 0;
  const rows = await q(
    "select ticket_day, ticket_code, tg_chat_id, arname from tickets " +
    "where state = 'READY' and tg_chat_id is not null and notified_at is null " +
    "and ticket_day = curdate() order by ready_at asc limit 10");

  for (const r of rows) {
    const text =
      "Your goods are ready.\n\n" +
      "Ticket " + r.ticket_code + "\n" +
      "Please come to the counter and bring this ticket.\n\n" +
      "Mwalimu Cosmetics";
    try {
      await telegram("sendMessage", { chat_id: r.tg_chat_id, text: text });
      await q("update tickets set notified_at = now() where ticket_day = ? and ticket_code = ?",
        [r.ticket_day, r.ticket_code]);
      console.log(stamp() + "  messaged " + r.ticket_code);
    } catch (e) {
      // A customer who has blocked the bot, or a chat that no longer exists,
      // must not wedge the queue behind them.
      console.log(stamp() + "  could not message " + r.ticket_code + ": " + e.message);
      await q("update tickets set notified_at = now() where ticket_day = ? and ticket_code = ?",
        [r.ticket_day, r.ticket_code]);
    }
  }
  return rows.length;
}

// Customers scanning the QR on their slip.
//
// The scans arrive at the website's Telegram webhook — see the header for why
// they cannot arrive here — and wait in a TicketLink row until this collects
// them. They are claimed only after being applied, so a laptop that dies
// halfway re-reads the same links next time instead of losing a registration.
async function link() {
  if (!API) return 0;

  let payload;
  try {
    payload = await api("GET", "/tickets/links?limit=50");
  } catch (e) {
    console.log(stamp() + "  links: " + e.message);
    return 0;
  }

  const links = (payload && payload.data) || [];
  if (!links.length) return 0;

  const done = [];
  for (const l of links) {
    try {
      await linkChat(l.ticketCode, l.chatId, l.firstName || "");
      done.push(l.id);
    } catch (e) {
      // A link that cannot be applied right now — a locked table, a dropped
      // connection — is left unclaimed so the next pass tries it again.
      console.log(stamp() + "  could not apply " + l.ticketCode + ": " + e.message);
    }
  }

  if (done.length) {
    try { await api("POST", "/tickets/links/claim", { ids: done }); }
    catch (e) { console.log(stamp() + "  claim: " + e.message); }
  }
  return done.length;
}

async function linkChat(code, chatId, who) {
  // Only a ticket that is still open today. The payload carries no date, so a
  // slip scanned tomorrow morning would otherwise attach to a different
  // customer's ticket with the same number.
  const rows = await q(
    "select ticket_code, state, eta_lo, eta_hi, tg_chat_id from tickets " +
    "where ticket_day = curdate() and ticket_code = ? and state in ('OPEN','READY')", [code]);

  // The server already told them the ticket was registered, within a second of
  // them scanning. Everything below is a correction or an addition to that, so
  // the common case sends nothing at all and the customer gets one message
  // rather than two.
  if (!rows.length) {
    await reply(chatId,
      "Ticket " + code + " is not open today. If you have just been given this ticket, " +
      "please show it at the counter.");
    console.log(stamp() + "  scan for " + code + " — no open ticket today");
    return;
  }

  const t = rows[0];
  if (t.tg_chat_id !== null && String(t.tg_chat_id) !== String(chatId)) {
    await reply(chatId, "Ticket " + code + " is already being followed on another phone.");
    return;
  }

  await q("update tickets set tg_chat_id = ?, tg_linked_at = now() " +
    "where ticket_day = curdate() and ticket_code = ?", [chatId, code]);

  // Somebody who scanned after their goods were already ready would otherwise
  // wait for a message that is never coming: the notify pass only picks up
  // tickets that were linked before they were marked ready.
  if (t.state === "READY") {
    await reply(chatId, "Your goods are ready now — please come to the counter.");
    await q("update tickets set notified_at = now() " +
      "where ticket_day = curdate() and ticket_code = ? and notified_at is null", [code]);
  }

  console.log(stamp() + "  linked " + code + " to chat " + chatId);
}

async function reply(chatId, text) {
  try { await telegram("sendMessage", { chat_id: chatId, text: text }); }
  catch (e) { console.log(stamp() + "  reply failed: " + e.message); }
}

function stamp() {
  return new Date().toTimeString().slice(0, 8);
}

// ── Main loop ─────────────────────────────────────────────────────────

async function cycle() {
  await ensureConnected();
  await announce();
  await notify();
}

async function main() {
  if (SAY_ONLY) {
    console.log("Saying " + SAY_ONLY + ' as "' + speakable(SAY_ONLY) + '"');
    const ok = await say(SAY_ONLY);
    console.log(ok ? "Spoken." : "Speech failed.");
    return;
  }

  console.log(describeConfigSource(cfg));
  console.log("Database: " + cfg.database);
  console.log("Telegram: " + (TOKEN ? "on" : "OFF — speakers only" +
    (NO_TELEGRAM ? " (--no-telegram)" : ", no botToken in " + CONFIG_PATH)));
  console.log("Speaking: " + (NO_SPEAK ? "OFF (--no-speak) — the shop screen calls numbers" : "on"));
  console.log("Scans   : " + (API ? "collected from " + API + "/tickets/links" : "OFF — no api configured"));
  console.log("");

  if (TOKEN) {
    try {
      const me = await telegram("getMe", {});
      console.log("Bot: @" + me.username + " (" + me.first_name + ")");
    } catch (e) {
      console.log("Bot check failed: " + e.message);
    }
  }

  if (ONCE) {
    await cycle();
    if (API) await link();
    console.log("One pass done.");
    if (conn) conn.end();
    return;
  }

  console.log("Watching for tickets marked ready. Ctrl-C to stop.\n");

  // Two timers rather than one. Collecting scans talks to a server over the
  // shop's WiFi and can stall for as long as its timeout; announcements talk
  // only to MySQL over the cable. Sharing a loop would mean a customer standing
  // in front of a finished basket while the laptop waits on the internet.
  const beat = async () => {
    try { await cycle(); }
    catch (e) { console.log(stamp() + "  cycle: " + e.message); conn = null; }
    setTimeout(beat, POLL_MS);
  };
  const poll = async () => {
    try { await ensureConnected(); await link(); }
    catch (e) { console.log(stamp() + "  poll: " + e.message); conn = null; }
    setTimeout(poll, LINK_POLL_MS);
  };

  beat();
  poll();
}

main().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
