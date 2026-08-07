/**
 * Mwalimu Cosmetics — record a customer payment against an invoice.
 *
 * The twin of FumasV5/ArReceipt.cs. Both post the same three ledger legs,
 * copied from FPrepayment_debtors_alloc.cs:2182 (identically
 * FPrepayment_debtors.cs:1673) — NOT re-derived:
 *
 *   journal_transactions  cash/bank account    debit  amount
 *   journal_transactions  AR control account   credit amount
 *   debtors_transactions  the customer         credit amount
 *
 * Three legs, once. FPrepayment_debtors and FPrepayment_debtors_alloc are two
 * entry points for the same transaction rather than two steps of one, so
 * posting both would double-count. bridge/test-ar-parity.js asserts the count.
 *
 * The posting date is the BANKING date, not the receipt date. A cheque dated
 * three weeks out must hit the ledger on the day it is banked, or "cheques due
 * today" means nothing. For cash the two are the same day.
 *
 * FumasV5 also leaves the allocation — which invoice a receipt settles — to a
 * second screen that in practice nobody opens: invoices.paid is 0 on all 463
 * invoices ever raised while KES 4.4m sits open. This does the allocation in
 * the same transaction, because it always knows the invoice.
 *
 * This lives in its own module rather than inside pusher.js so the parity test
 * can exercise the real shipped code. pusher.js runs a full sync on require,
 * so importing it from a test would start an agent against production.
 */

function query(conn, sql, params, timeoutMs) {
  const spec = timeoutMs ? { sql, timeout: timeoutMs } : sql;
  return new Promise((res, rej) =>
    conn.query(spec, params || [], (e, r) => (e ? rej(e) : res(r))));
}

const beginTx    = (conn) => new Promise((res, rej) => conn.beginTransaction(e => e ? rej(e) : res()));
const commitTx   = (conn) => new Promise((res, rej) => conn.commit(e => e ? rej(e) : res()));
const rollbackTx = (conn) => new Promise(res => conn.rollback(() => res()));

async function nautoSetting(conn, col) {
  const [row] = await query(conn, `SELECT ${col} AS v FROM nauto`);
  return row?.v ?? "";
}

async function activePeriod(conn) {
  const [row] = await query(conn,
    `SELECT period FROM currency_periods WHERE active = 'YES' ORDER BY period DESC LIMIT 1`).catch(() => []);
  return row?.period ?? "";
}

async function isPeriodLocked(conn, dateStr) {
  const [row] = await query(conn,
    `SELECT locked FROM periods WHERE yr = YEAR(?) AND period = MONTH(?)`, [dateStr, dateStr]).catch(() => null);
  return !!row && String(row.locked).toUpperCase() !== "NO";
}

/**
 * Mirrors mglobal.get_control_ac(currency, debtors: true, code): the client's
 * own glcategory mapping, then the currency's default debtors account, then
 * nauto.debtorsacct. Every client in this database has glcategory 'NONE',
 * which matches nothing, so in practice the last of the three answers — but
 * the chain is reproduced in full so it keeps agreeing with FumasV5.
 */
async function debtorControlAc(conn, clientCode) {
  try {
    const [row] = await query(conn,
      `SELECT b.accountcode AS ac FROM clients a, glcategory b
        WHERE a.glcategory = b.code AND a.code = ? AND b.code <> ''`, [clientCode]);
    if (row?.ac) return row.ac;
  } catch {}
  try {
    const currency = await nautoSetting(conn, "currency_s");
    const [row] = await query(conn, `SELECT debtorsac AS ac FROM currency WHERE code = ?`, [currency]);
    if (row?.ac) return row.ac;
  } catch {}
  return (await nautoSetting(conn, "debtorsacct")) || "SUSPENSE";
}

/** Mirrors mglobal.get_auto("DEP", "Yes") — the CD receipt series. */
async function nextReceiptNo(conn) {
  await query(conn, "UPDATE nauto SET deposit = deposit + 1");
  const [row] = await query(conn, "SELECT CONCAT(pdeposit, deposit) AS pno FROM nauto");
  return row.pno;
}

/**
 * Cash goes to nauto.cashaccount. There is no nauto.bankaccount column, so the
 * bank is whichever account the shop has actually banked cheques through over
 * the last year — BANK-COOP carries 614 of the last 621, but reading it rather
 * than hardcoding means the default follows the shop if they change banks.
 */
async function defaultAccount(conn, rtype) {
  if (rtype === "C") return (await nautoSetting(conn, "cashaccount")) || "CASH";
  try {
    const [row] = await query(conn,
      `SELECT ap.account AS ac FROM ap_prepayment ap
         JOIN accounts a ON a.code = ap.account AND a.nb LIKE '%Cash At Bank%'
        WHERE ap.rtype = 'Q' AND ap.pdate >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        GROUP BY ap.account ORDER BY COUNT(*) DESC LIMIT 1`);
    if (row?.ac) return row.ac;
  } catch {}
  return "BANK-COOP";
}

/** FumasV5's single-letter codes: C cash, Q cheque, S bank transfer, M mobile. */
function rtypeOf(method) {
  return method === "CASH" ? "C" : method === "BANK" ? "S" : method === "MPESA" ? "M" : "Q";
}

/**
 * @param conn    an open mysql connection, already pointed at the right database
 * @param payload { invoiceNo, clientCode, clientName, method, amount, chequeNo,
 *                  bankName, branchName, bankingDate, receiptDate, account, remarks }
 * @param opts    { staff = "WEB", log }
 * @returns the receipt number (ar_prepayment.pno)
 */
async function postArPayment(conn, payload, opts = {}) {
  const staff = opts.staff || "WEB";
  const {
    invoiceNo, clientCode, clientName, method, amount: rawAmount,
    chequeNo, bankName, branchName, bankingDate, receiptDate, account, remarks,
  } = payload || {};

  const amount = Number(rawAmount);
  const rtype  = rtypeOf(method);
  const cheque = (chequeNo || "").trim();
  const note   = remarks || "";

  if (!invoiceNo || !clientCode) throw new Error("invoiceNo and clientCode are both required.");
  if (!(amount > 0)) throw new Error("The amount must be more than zero.");
  if (!bankingDate) throw new Error("A banking date is required.");
  if (rtype === "Q" && !cheque) {
    throw new Error("A cheque needs its number, so it can be matched on the bank statement.");
  }

  const [inv] = await query(conn,
    `SELECT invno, COALESCE(gtotal,0) gtotal, COALESCE(amountpaid,0) amountpaid,
            COALESCE(posted,0) posted, clientcode, clientname,
            DATE_FORMAT(invdate, '%Y-%m-%d') invdate
       FROM invoices WHERE invno = ?`, [invoiceNo]);
  if (!inv) throw new Error(`Invoice ${invoiceNo} was not found.`);
  if (Number(inv.posted) !== 1) throw new Error(`Invoice ${invoiceNo} has not been posted yet.`);

  const balance = Number(inv.gtotal) - Number(inv.amountpaid);
  // Half a shilling of slack, matching the guard on the supplier side, so a
  // rounded figure cannot be rejected as an overpayment.
  if (amount > balance + 0.5) {
    throw new Error(`That is more than invoice ${invoiceNo} has left to pay (balance ${balance.toFixed(2)}).`);
  }

  // Periods are opened a month at a time and most future months are shut, so a
  // post-dated cheque can land in a closed one. Say what to do about it.
  if (await isPeriodLocked(conn, bankingDate)) {
    throw new Error(
      `The accounting period for ${bankingDate} is closed, so a payment cannot be dated then. ` +
      `Someone with rights needs to open it under Accounts > Settings > Periods first.`);
  }

  const payAccount = account || await defaultAccount(conn, rtype);
  const controlAc  = await debtorControlAc(conn, clientCode);
  const currency   = await nautoSetting(conn, "currency_s");
  const cperiod    = await activePeriod(conn);
  const pdate      = receiptDate || bankingDate;
  const name       = clientName || inv.clientname || "";

  const [accRow] = await query(conn, "SELECT prepaid FROM accounts WHERE code = ?", [clientCode]).catch(() => []);
  const balbf = accRow?.prepaid ?? 0;

  // The narrative FumasV5 writes onto the journal legs
  // (FPrepayment_debtors.cs:1660-1671).
  const source    = rtype === "Q"
    ? `CHEQUE${note} Dated ${bankingDate} ${cheque}`
    : `SLIP NO.${cheque} ${note}`;
  const narrative = `${clientCode} ${name} ${note} AR-RECEIPT`;

  await beginTx(conn);
  try {
    const pno = await nextReceiptNo(conn);

    await query(conn,
      `INSERT INTO ar_prepayment
         (pno,pdate,ccode,cname,amount,account,cheque_no,remarks,balbf,prepaid,staff,staffdate,
          rtype,inword,bdate,cinvoices,dcurrency_s,cperiod,rate,csale,bankname,branchname,posted,amount_paid)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),?,'',?,?,?,?,1,1,?,?,1,?)`,
      [pno, pdate, clientCode, name, amount, payAccount, cheque, note, balbf, balbf, staff,
       rtype, bankingDate, invoiceNo, currency, cperiod, bankName || "", branchName || "", amount]);

    // 1) cash/bank leg — debit
    await query(conn,
      `INSERT INTO journal_transactions
         (code,remarks,amount,jtdate,trancode,trantype,staff,staffdate,transign,rec,r_amt,source,cheque_no,cost_center,dcurrency_s,cperiod,rate)
       VALUES (?,?,?,?,?,?,?,NOW(),'+','n',0,?,?,'',?,?,1)`,
      [payAccount, narrative, amount, bankingDate, pno, "AR-RECEIPT", staff, source, cheque, currency, cperiod]);

    // 2) AR control leg — credit
    await query(conn,
      `INSERT INTO journal_transactions
         (code,remarks,amount,jtdate,trancode,trantype,staff,staffdate,transign,rec,r_amt,source,cheque_no,cost_center,dcurrency_s,cperiod,rate)
       VALUES (?,?,?,?,?,?,?,NOW(),'-','n',0,?,?,'',?,?,1)`,
      [controlAc, narrative, amount, bankingDate, pno, "AR-RECEIPT", staff, source, cheque, currency, cperiod]);

    // 3) customer subledger — credit
    await query(conn,
      `INSERT INTO debtors_transactions
         (code,remarks,amount,jtdate,trancode,trantype,staff,staffdate,transign,rec,r_amt,source,cheque_no,dcurrency_s,cperiod,rate)
       VALUES (?,?,?,?,?,?,?,NOW(),'-','n',0,?,?,?,?,1)`,
      [clientCode, narrative, amount, bankingDate, pno, "AR-RECEIPT", staff, source, cheque, currency, cperiod]);

    // The allocation FumasV5 leaves to a screen nobody opens.
    await query(conn,
      `INSERT INTO ar_prepayment_details (rno,invno,invdate,amount,amountpaid,remarks,rate,code,name)
       VALUES (?,?,?,?,?,'INVOICE',1,?,?)`,
      [pno, invoiceNo, inv.invdate, inv.gtotal, amount, inv.clientcode, inv.clientname]);

    await query(conn,
      "UPDATE invoices SET amountpaid = COALESCE(amountpaid,0) + ? WHERE invno = ?", [amount, invoiceNo]);
    // paid is derived from the figures, so a part payment cannot close an invoice.
    await query(conn,
      "UPDATE invoices SET paid = IF(COALESCE(amountpaid,0) >= COALESCE(gtotal,0) - 0.5, 1, 0) WHERE invno = ?",
      [invoiceNo]);

    if (rtype === "Q") {
      await query(conn,
        `UPDATE invoices SET incheque_no = CONCAT(COALESCE(incheque_no,''),' ',?),
                             incheque_date = CONCAT(COALESCE(incheque_date,''),' ',?)
          WHERE invno = ?`, [cheque, bankingDate, invoiceNo]);
    }

    // A client invoiced but never paid may have no accounts row yet — the same
    // defensive step the supplier path needed.
    await query(conn,
      "INSERT IGNORE INTO accounts (code, description, nb, prepaid, active) VALUES (?,?,'Debtors',0,1)",
      [clientCode, name]);
    await query(conn,
      "UPDATE accounts SET prepaid = COALESCE(prepaid,0) + ? WHERE code = ?", [amount, clientCode]);

    if (rtype === "Q") {
      await query(conn,
        `INSERT IGNORE INTO cheque_clearing
           (side,pno,cheque_no,account,due_date,amount,party_code,party_name,status,staff,staffdate,remarks)
         VALUES ('IN',?,?,?,?,?,?,?,'PENDING',?,NOW(),?)`,
        [pno, cheque, payAccount, bankingDate, amount, clientCode, name, staff, `Invoice ${invoiceNo}`]);
    }

    await commitTx(conn);
    if (opts.log) {
      opts.log(`  AR payment posted: ${pno} — ${method} KES ${amount.toLocaleString("en-KE")} against ${invoiceNo}`);
    }
    return pno;
  } catch (e) {
    await rollbackTx(conn);
    throw e;
  }
}

module.exports = { postArPayment, rtypeOf, debtorControlAc, defaultAccount, isPeriodLocked };
