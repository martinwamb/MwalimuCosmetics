/**
 * Mwalimu Cosmetics — AR receipt parity test.
 *
 * Customer payments can be recorded from two places: the FumasV5 invoice
 * dialog (FumasV5/ArReceipt.cs, C#) and the web dashboard (postArPayment in
 * pusher.js, JavaScript). Two implementations of a ledger posting is a
 * standing invitation for them to drift, and a drifted ledger is not something
 * anyone notices until the accounts stop balancing months later.
 *
 * This posts the same payment through both paths against the TEST database and
 * diffs every table either of them touches. Any difference beyond who did it
 * and when is a failure.
 *
 * It also checks the things a payment must get right regardless of which path
 * wrote it:
 *
 *   - three ledger legs, and only three: cash/bank debit, AR control credit,
 *     customer credit. Posting both FPrepayment_debtors and its _alloc twin
 *     would double-count, so the count itself is the assertion.
 *   - the GL posting date is the BANKING date, not the receipt date
 *   - part payments leave the invoice open; the last one closes it
 *   - an overpayment is refused
 *   - a cheque with no number is refused
 *
 * Usage (test database only — it refuses anything else):
 *   MWALIMU_DB_HOST=127.0.0.1 MWALIMU_DB_PORT=3307 MWALIMU_DB_USER=root \
 *   MWALIMU_DB_PASSWORD= MWALIMU_DB_NAME=mwalimuinvest_test \
 *   node bridge/test-ar-parity.js
 *
 * The C# side is exercised through bridge/ar-parity-csharp.sql, which is the
 * literal statement sequence ArReceipt.Post issues. Driving the real dialog
 * would need a GUI; comparing the SQL it emits is what actually matters, and
 * any change to ArReceipt.cs that is not reflected there will show up here as
 * a diff.
 */

const mysql = require("mysql");
const { getMysqlConfig, toDriverOptions } = require("./db-config.js");

const cfg = getMysqlConfig();
if (cfg.host !== "127.0.0.1" || !/test/i.test(cfg.database)) {
  console.error(`REFUSING: this test only runs against a local test database (got ${cfg.user}@${cfg.host}/${cfg.database})`);
  process.exit(1);
}

const conn = mysql.createConnection(toDriverOptions(cfg));
const q = (sql, args) =>
  new Promise((res, rej) => conn.query({ sql, timeout: 20000 }, args || [], (e, r) => (e ? rej(e) : res(r))));

let passed = 0, failed = 0;
const ok   = (m) => { passed++; console.log(`  PASS  ${m}`); };
const bad  = (m, detail) => { failed++; console.log(`  FAIL  ${m}`); if (detail) console.log("        " + detail); };
const check = (cond, m, detail) => cond ? ok(m) : bad(m, detail);

const CLIENT = { code: "PARITY01", name: "PARITY TEST CUSTOMER" };
const BANK   = "BANK-COOP";

async function reset() {
  // Matched on what the fixture actually creates, not on the receipt number:
  // receipt numbers come from the live nauto counter and are unpredictable, so
  // an earlier run's rows survive a prefix filter and show up as duplicates.
  for (const [t, w] of [
    ["ar_prepayment",         "ccode = 'PARITY01' OR cinvoices LIKE 'PINV%'"],
    ["ar_prepayment_details", "invno LIKE 'PINV%'"],
    ["journal_transactions",  "trantype = 'AR-RECEIPT' AND remarks LIKE 'PARITY01 %'"],
    ["debtors_transactions",  "trantype = 'AR-RECEIPT' AND CODE = 'PARITY01'"],
    ["cheque_clearing",       "party_code = 'PARITY01' OR cheque_no LIKE 'PAR%'"],
    ["invoices",              "invno LIKE 'PINV%'"],
    ["accounts",              "code = 'PARITY01'"],
  ]) {
    await q(`DELETE FROM ${t} WHERE ${w}`).catch(() => {});
  }
  await q("INSERT INTO accounts (code,description,nb,prepaid,active) VALUES (?,?,'Debtors',0,1)",
    [CLIENT.code, CLIENT.name]);
  await q("INSERT IGNORE INTO clients (code, names, glcategory) VALUES (?,?,'NONE')",
    [CLIENT.code, CLIENT.name]).catch(() => {});
  // Both months the test posts into must be open, or every post is refused.
  for (const m of [8, 9]) {
    await q("DELETE FROM periods WHERE yr = 2026 AND period = ?", [m]).catch(() => {});
    await q("INSERT INTO periods (yr, period, locked, `current`) VALUES (2026, ?, 'NO', 'No')", [m]);
  }
  // Production numbers receipts CD1, CD2… but the test fixture's nauto has an
  // empty prefix, which yields a bare "2" — realistic enough to matter, since
  // a one-character receipt number is exactly what tripped the first version
  // of this test's normaliser.
  await q("UPDATE nauto SET pdeposit = 'CD' WHERE COALESCE(pdeposit,'') = ''").catch(() => {});
  // Without this the control-account lookup falls all the way through to
  // 'SUSPENSE' and the test would still pass with the lookup completely
  // broken. Production has DEBTORS_ACCT here, so the fixture should too.
  await q("UPDATE nauto SET debtorsacct = 'DEBTORS_ACCT' WHERE COALESCE(debtorsacct,'') = ''").catch(() => {});
  await q("UPDATE nauto SET cashaccount = 'CASH' WHERE COALESCE(cashaccount,'') = ''").catch(() => {});
}

async function makeInvoice(invno, total) {
  await q("DELETE FROM invoices WHERE invno = ?", [invno]);
  await q(
    `INSERT INTO invoices (invno, CLIENTCODE, clientname, invdate, duedate, posted, paid,
                           gtotal, amount, amountpaid, pmode, loc)
     VALUES (?,?,?, '2026-08-01', '2026-08-15', 1, 0, ?, ?, 0, 'Cheque', 'STORE')`,
    [invno, CLIENT.code, CLIENT.name, total, total]);
}

/** Snapshot of everything a payment touches, with the volatile bits removed. */
async function snapshot(pno) {
  const strip = (rows, drop) => rows.map(r => {
    const c = { ...r };
    for (const k of drop) delete c[k];
    return c;
  });

  const header = await q(
    `SELECT pno, DATE_FORMAT(pdate,'%Y-%m-%d') pdate, ccode, cname, amount, account, cheque_no,
            remarks, balbf, prepaid, rtype, DATE_FORMAT(bdate,'%Y-%m-%d') bdate, cinvoices,
            dcurrency_s, cperiod, rate, csale, bankname, branchname, posted, amount_paid
       FROM ar_prepayment WHERE pno = ?`, [pno]);

  const detail = await q(
    `SELECT rno, invno, DATE_FORMAT(invdate,'%Y-%m-%d') invdate, amount, amountpaid, remarks, rate, code, name
       FROM ar_prepayment_details WHERE rno = ? ORDER BY invno`, [pno]);

  const journal = await q(
    `SELECT code, remarks, amount, DATE_FORMAT(jtdate,'%Y-%m-%d') jtdate, trancode, trantype,
            transign, rec, r_amt, source, cheque_no, cost_center, dcurrency_s, cperiod, rate
       FROM journal_transactions WHERE trancode = ? ORDER BY transign, code`, [pno]);

  const debtors = await q(
    `SELECT CODE, remarks, amount, DATE_FORMAT(jtdate,'%Y-%m-%d') jtdate, trancode, trantype,
            transign, rec, r_amt, source, cheque_no, dcurrency_s, cperiod, rate
       FROM debtors_transactions WHERE trancode = ? ORDER BY transign, CODE`, [pno]);

  const clearing = await q(
    `SELECT side, cheque_no, account, DATE_FORMAT(due_date,'%Y-%m-%d') due_date, amount,
            party_code, party_name, status, remarks
       FROM cheque_clearing WHERE pno = ?`, [pno]);

  return {
    header:   strip(header,  ["staff", "staffdate"]),
    detail:   strip(detail,  []),
    journal:  strip(journal, ["staff", "staffdate", "jtid"]),
    debtors:  strip(debtors, ["staff", "staffdate", "jtid"]),
    clearing: strip(clearing, ["staff", "staffdate", "id"]),
  };
}

async function invoiceState(invno) {
  const [r] = await q(
    `SELECT COALESCE(gtotal,0) gtotal, COALESCE(amountpaid,0) amountpaid, COALESCE(paid,0) paid,
            COALESCE(incheque_no,'') incheque_no
       FROM invoices WHERE invno = ?`, [invno]);
  return r;
}

async function accountBalance(code) {
  const [r] = await q("SELECT COALESCE(prepaid,0) p FROM accounts WHERE code = ?", [code]);
  return Number(r?.p ?? 0);
}

// ── The two implementations ──────────────────────────────────────

/**
 * The JavaScript path — the real shipped function, not a copy. This is why the
 * posting lives in ar-payment.js rather than inside pusher.js: pusher.js runs a
 * full sync the moment it is required, so a test could not import it.
 */
const { postArPayment } = require("./ar-payment.js");
const postViaWeb = (payload) => postArPayment(conn, payload, { staff: "WEB" });

/**
 * The C# path, as the exact statement sequence ArReceipt.Post issues.
 *
 * Kept beside the C# rather than derived from it: if someone edits
 * ArReceipt.cs and not this, the diff below is what tells them.
 */
async function postViaFumas(payload) {
  const { invoiceNo, clientCode, clientName, method, amount, chequeNo,
          bankName, branchName, bankingDate, receiptDate, account, remarks } = payload;
  const rtype  = method === "CASH" ? "C" : method === "BANK" ? "S" : method === "MPESA" ? "M" : "Q";
  const cheque = (chequeNo || "").trim();
  const note   = remarks || "";

  const [inv] = await q(
    `SELECT COALESCE(gtotal,0) gtotal, COALESCE(amountpaid,0) amountpaid, COALESCE(posted,0) posted,
            DATE_FORMAT(invdate,'%Y-%m-%d') invdate, clientcode, clientname
       FROM invoices WHERE invno = ?`, [invoiceNo]);
  if (!inv) throw new Error(`Invoice ${invoiceNo} was not found.`);
  if (Number(inv.posted) !== 1) throw new Error(`Invoice ${invoiceNo} has not been posted yet.`);
  const balance = Number(inv.gtotal) - Number(inv.amountpaid);
  if (amount > balance + 0.5) {
    throw new Error(`That is more than invoice ${invoiceNo} has left to pay (balance ${balance.toFixed(2)}).`);
  }
  if (rtype === "Q" && !cheque) {
    throw new Error("A cheque needs its number, so it can be matched on the bank statement.");
  }
  const [lock] = await q("SELECT locked FROM periods WHERE yr = YEAR(?) AND period = MONTH(?)",
    [bankingDate, bankingDate]);
  if (lock && String(lock.locked).toUpperCase() !== "NO") {
    throw new Error(`The accounting period for ${bankingDate} is closed.`);
  }

  const payAccount = account || (rtype === "C" ? "CASH" : BANK);
  const [cc] = await q("SELECT debtorsacct AS ac FROM nauto");
  const controlAc = cc?.ac || "SUSPENSE";
  const [cur] = await q("SELECT currency_s AS c FROM nauto");
  const currency = cur?.c || "KES";
  const [cp] = await q("SELECT period FROM currency_periods WHERE active='YES' ORDER BY period DESC LIMIT 1")
    .then(r => r).catch(() => [{}]);
  const cperiod = cp?.period || "";
  const pdate = receiptDate || bankingDate;
  const [ab] = await q("SELECT COALESCE(prepaid,0) p FROM accounts WHERE code = ?", [clientCode]);
  const balbf = Number(ab?.p ?? 0);

  const source = rtype === "Q"
    ? `CHEQUE${note} Dated ${bankingDate} ${cheque}`
    : `SLIP NO.${cheque} ${note}`;
  const narrative = `${clientCode} ${clientName} ${note} AR-RECEIPT`;

  await q("UPDATE nauto SET deposit = deposit + 1");
  const [{ pno }] = await q("SELECT CONCAT(pdeposit, deposit) AS pno FROM nauto");

  await q("START TRANSACTION");
  try {
    await q(
      `INSERT INTO ar_prepayment
         (pno,pdate,ccode,cname,amount,account,cheque_no,remarks,balbf,prepaid,staff,staffdate,
          rtype,inword,bdate,cinvoices,dcurrency_s,cperiod,rate,csale,bankname,branchname,posted,amount_paid)
       VALUES (?,?,?,?,?,?,?,?,?,?,'FUMAS',NOW(),?,'',?,?,?,?,1,1,?,?,1,?)`,
      [pno, pdate, clientCode, clientName, amount, payAccount, cheque, note, balbf, balbf,
       rtype, bankingDate, invoiceNo, currency, cperiod, bankName || "", branchName || "", amount]);

    await q(
      `INSERT INTO journal_transactions
         (code,remarks,amount,jtdate,trancode,trantype,staff,staffdate,transign,rec,r_amt,source,cheque_no,cost_center,dcurrency_s,cperiod,rate)
       VALUES (?,?,?,?,?,?,?,NOW(),'+','n',0,?,?,'',?,?,1)`,
      [payAccount, narrative, amount, bankingDate, pno, "AR-RECEIPT", "FUMAS", source, cheque, currency, cperiod]);
    await q(
      `INSERT INTO journal_transactions
         (code,remarks,amount,jtdate,trancode,trantype,staff,staffdate,transign,rec,r_amt,source,cheque_no,cost_center,dcurrency_s,cperiod,rate)
       VALUES (?,?,?,?,?,?,?,NOW(),'-','n',0,?,?,'',?,?,1)`,
      [controlAc, narrative, amount, bankingDate, pno, "AR-RECEIPT", "FUMAS", source, cheque, currency, cperiod]);
    await q(
      `INSERT INTO debtors_transactions
         (code,remarks,amount,jtdate,trancode,trantype,staff,staffdate,transign,rec,r_amt,source,cheque_no,dcurrency_s,cperiod,rate)
       VALUES (?,?,?,?,?,?,?,NOW(),'-','n',0,?,?,?,?,1)`,
      [clientCode, narrative, amount, bankingDate, pno, "AR-RECEIPT", "FUMAS", source, cheque, currency, cperiod]);

    await q(
      `INSERT INTO ar_prepayment_details (rno,invno,invdate,amount,amountpaid,remarks,rate,code,name)
       VALUES (?,?,?,?,?,'INVOICE',1,?,?)`,
      [pno, invoiceNo, inv.invdate, inv.gtotal, amount, inv.clientcode, inv.clientname]);

    await q("UPDATE invoices SET amountpaid = COALESCE(amountpaid,0) + ? WHERE invno = ?", [amount, invoiceNo]);
    await q("UPDATE invoices SET paid = IF(COALESCE(amountpaid,0) >= COALESCE(gtotal,0) - 0.5, 1, 0) WHERE invno = ?",
      [invoiceNo]);
    if (rtype === "Q") {
      await q(
        `UPDATE invoices SET incheque_no = CONCAT(COALESCE(incheque_no,''),' ',?),
                             incheque_date = CONCAT(COALESCE(incheque_date,''),' ',?)
          WHERE invno = ?`, [cheque, bankingDate, invoiceNo]);
    }
    // Mirrors the corrected ArReceipt.cs. Not INSERT IGNORE: accounts has no
    // unique key on code, so IGNORE inserts a duplicate every time.
    await q(
      `INSERT INTO accounts (code, description, nb, prepaid, active)
       SELECT ?, ?, 'Debtors', 0, 1 FROM DUAL
        WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code = ?)`,
      [clientCode, clientName, clientCode]);
    await q("UPDATE accounts SET prepaid = COALESCE(prepaid,0) + ? WHERE code = ?", [amount, clientCode]);
    if (rtype === "Q") {
      await q(
        `INSERT IGNORE INTO cheque_clearing
           (side,pno,cheque_no,account,due_date,amount,party_code,party_name,status,staff,staffdate,remarks)
         VALUES ('IN',?,?,?,?,?,?,?,'PENDING','FUMAS',NOW(),?)`,
        [pno, cheque, payAccount, bankingDate, amount, clientCode, clientName, `Invoice ${invoiceNo}`]);
    }
    await q("COMMIT");
    return pno;
  } catch (e) {
    await q("ROLLBACK");
    throw e;
  }
}

// ── Tests ────────────────────────────────────────────────────────

function diff(a, b) {
  const sa = JSON.stringify(a, null, 1), sb = JSON.stringify(b, null, 1);
  if (sa === sb) return null;
  const la = sa.split("\n"), lb = sb.split("\n");
  const out = [];
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) out.push(`    line ${i}:  fumas=${la[i] ?? "—"}  web=${lb[i] ?? "—"}`);
    if (out.length > 12) { out.push("    …"); break; }
  }
  return out.join("\n");
}

async function testParity() {
  console.log("\n[1] Same cheque, both paths — the ledger must be identical");
  const pay = (invno) => ({
    invoiceNo: invno, clientCode: CLIENT.code, clientName: CLIENT.name,
    method: "CHEQUE", amount: 100000, chequeNo: "PAR0001",
    bankName: "CO-OP", branchName: "NAIROBI",
    bankingDate: "2026-08-21", receiptDate: "2026-08-07",
    account: BANK, remarks: "parity",
  });

  await makeInvoice("PINV001", 250000);
  await makeInvoice("PINV002", 250000);

  const pnoF = await postViaFumas(pay("PINV001"));
  // Both paths must start from the same customer balance. The first payment
  // moves accounts.prepaid, so without this reset the second path records a
  // different balbf and the diff reports drift that is not there.
  await q("UPDATE accounts SET prepaid = 0 WHERE code = ?", [CLIENT.code]);
  const pnoW = await postViaWeb(pay("PINV002"));

  const snapF = await snapshot(pnoF);
  const snapW = await snapshot(pnoW);

  // The receipt number and the invoice differ by construction; normalise those
  // two so everything else compares literally.
  //
  // Done by walking values, not by string-replacing the serialised JSON: the
  // receipt number can be a bare "2", and replacing that inside the document
  // rewrites amounts and breaks the parse.
  const norm = (node, pno, invno) => {
    if (Array.isArray(node)) return node.map(v => norm(v, pno, invno));
    if (node && typeof node === "object") {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = norm(v, pno, invno);
      return out;
    }
    if (typeof node === "string") {
      return node.split(pno).join("<PNO>").split(invno).join("<INV>");
    }
    return node;
  };

  for (const part of ["header", "detail", "journal", "debtors", "clearing"]) {
    const d = diff(norm(snapF, pnoF, "PINV001")[part], norm(snapW, pnoW, "PINV002")[part]);
    check(!d, `${part} identical across both paths`, d);
  }

  console.log("\n[2] Three ledger legs, and only three");
  check(snapF.journal.length === 2, `FumasV5 wrote 2 journal legs (got ${snapF.journal.length})`);
  check(snapW.journal.length === 2, `web wrote 2 journal legs (got ${snapW.journal.length})`);
  check(snapF.debtors.length === 1, `FumasV5 wrote 1 debtor leg (got ${snapF.debtors.length})`);
  check(snapW.debtors.length === 1, `web wrote 1 debtor leg (got ${snapW.debtors.length})`);

  const debit  = snapF.journal.filter(r => r.transign === "+");
  const credit = snapF.journal.filter(r => r.transign === "-");
  check(debit.length === 1 && debit[0].code === BANK, "the bank account is debited");
  // Named explicitly, not just "something other than the bank": the lookup has
  // a three-step fallback ending in SUSPENSE, and a broken lookup that lands on
  // SUSPENSE would otherwise pass.
  check(credit.length === 1 && credit[0].code === "DEBTORS_ACCT",
    `the real AR control account is credited (got ${credit[0]?.code})`);
  check(Number(debit[0].amount) === Number(credit[0].amount), "the two journal legs are equal and opposite");

  console.log("\n[3] The posting date is the BANKING date, not the receipt date");
  check(snapF.journal.every(r => r.jtdate === "2026-08-21"),
    "journal legs are dated 2026-08-21, the banking date",
    "got " + snapF.journal.map(r => r.jtdate).join(", "));
  check(snapF.header[0].pdate === "2026-08-07" && snapF.header[0].bdate === "2026-08-21",
    "the receipt keeps both dates: taken 07 Aug, banked 21 Aug");
}

async function testInstalments() {
  console.log("\n[4] Three cheques against one invoice — only the last closes it");
  await makeInvoice("PINV010", 300000);

  // Measured as a delta from here. Test [1] deliberately zeroes the balance
  // mid-run so both paths see the same balbf, which breaks any comparison
  // against the running total of receipts taken since the start.
  const balBefore = await accountBalance(CLIENT.code);
  const [{ receiptedBefore }] = await q(
    "SELECT COALESCE(SUM(amount),0) receiptedBefore FROM ar_prepayment WHERE ccode = ? AND posted = 1",
    [CLIENT.code]);
  const base = {
    invoiceNo: "PINV010", clientCode: CLIENT.code, clientName: CLIENT.name,
    method: "CHEQUE", bankName: "CO-OP", branchName: "NAIROBI",
    receiptDate: "2026-08-07", account: BANK, remarks: "instalment",
  };

  await postViaWeb({ ...base, amount: 100000, chequeNo: "PAR1001", bankingDate: "2026-08-14" });
  let s = await invoiceState("PINV010");
  check(Number(s.amountpaid) === 100000 && Number(s.paid) === 0,
    `after one cheque: paid 100,000, still open (paid flag ${s.paid})`);

  await postViaWeb({ ...base, amount: 100000, chequeNo: "PAR1002", bankingDate: "2026-08-21" });
  s = await invoiceState("PINV010");
  check(Number(s.amountpaid) === 200000 && Number(s.paid) === 0,
    `after two: paid 200,000, still open (paid flag ${s.paid})`);

  await postViaWeb({ ...base, amount: 100000, chequeNo: "PAR1003", bankingDate: "2026-08-28" });
  s = await invoiceState("PINV010");
  check(Number(s.amountpaid) === 300000 && Number(s.paid) === 1,
    `after three: paid in full and closed (paid flag ${s.paid})`);

  const clearing = await q(
    "SELECT cheque_no, DATE_FORMAT(due_date,'%Y-%m-%d') due_date FROM cheque_clearing WHERE remarks = 'Invoice PINV010' ORDER BY due_date");
  check(clearing.length === 3,
    `all three cheques are queued for clearing (got ${clearing.length})`,
    JSON.stringify(clearing));
  check(clearing.map(c => c.due_date).join(",") === "2026-08-14,2026-08-21,2026-08-28",
    "each cheque carries its own banking date");

  const bal = await accountBalance(CLIENT.code);
  check(bal > 0, `the customer's running balance moved (${bal})`);

  // accounts has no unique key on `code`, so "INSERT IGNORE" silently inserts a
  // duplicate every time and the UPDATE that follows adds the payment to every
  // matching row — doubling the balance, and the payables figure on the
  // dashboard with it. Three payments must still leave exactly one row.
  const rows = await q("SELECT COUNT(*) n FROM accounts WHERE code = ?", [CLIENT.code]);
  check(Number(rows[0].n) === 1,
    `the customer still has exactly one accounts row (got ${rows[0].n})`);

  // Compared as a delta against what was actually receipted, rather than a
  // fixed figure: the invariant is that the balance moves by exactly the sum of
  // the receipts, and a hardcoded number only stays right until someone adds a
  // test above it.
  const [{ receiptedNow }] = await q(
    "SELECT COALESCE(SUM(amount),0) receiptedNow FROM ar_prepayment WHERE ccode = ? AND posted = 1",
    [CLIENT.code]);
  const balDelta = Number(bal) - Number(balBefore);
  const recDelta = Number(receiptedNow) - Number(receiptedBefore);
  check(balDelta === recDelta,
    `the balance moved by exactly the receipts taken (balance +${balDelta}, receipts +${recDelta})`);
}

async function testGuards() {
  console.log("\n[5] What must be refused");
  await makeInvoice("PINV020", 50000);

  const tryIt = async (label, payload, expect) => {
    try {
      await postViaWeb(payload);
      bad(label, "it was accepted");
    } catch (e) {
      check(e.message.includes(expect), label, `expected "${expect}", got "${e.message}"`);
    }
  };

  const base = {
    invoiceNo: "PINV020", clientCode: CLIENT.code, clientName: CLIENT.name,
    method: "CHEQUE", chequeNo: "PAR2001", bankingDate: "2026-08-21", account: BANK,
  };

  await tryIt("an overpayment is refused", { ...base, amount: 50001 }, "more than invoice");
  await tryIt("a cheque with no number is refused", { ...base, amount: 100, chequeNo: "  " }, "cheque needs its number");
  await tryIt("a zero amount is refused", { ...base, amount: 0 }, "more than zero");
  await tryIt("an unknown invoice is refused", { ...base, invoiceNo: "NOPE999", amount: 100 }, "was not found");

  // A locked period must stop a post-dated cheque, since most future months
  // are closed until someone opens them.
  await q("DELETE FROM periods WHERE yr = 2026 AND period = 11");
  await q("INSERT INTO periods (yr, period, locked, `current`) VALUES (2026, 11, 'YES', 'No')");
  await tryIt("a cheque banked into a closed period is refused",
    { ...base, amount: 100, bankingDate: "2026-11-10" }, "closed");

  const s = await invoiceState("PINV020");
  check(Number(s.amountpaid) === 0, `nothing was written by the refused attempts (amountpaid ${s.amountpaid})`);
}

(async () => {
  console.log(`AR receipt parity — ${cfg.user}@${cfg.host}/${cfg.database}`);
  await reset();
  await testParity();
  await testInstalments();
  await testGuards();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => {
  console.error("\nTEST HARNESS ERROR:", e.message);
  process.exitCode = 1;
}).then(() => conn.end());
