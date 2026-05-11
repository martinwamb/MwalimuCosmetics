import { Router } from "express";
import fs from "fs";
import path from "path";
import { requireRoles } from "../lib/authz.js";

export const router = Router();

const BACKUP_DIR = process.env.BACKUP_DIR ?? "/home/admin/apps/mwalimu-backups";

function readTable(date: string, table: string): any[] {
  const filePath = path.join(BACKUP_DIR, date, `${table}.json`);
  if (!fs.existsSync(filePath)) return [];
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return []; }
}

// List all available backup dates
router.get("/dates", requireRoles(["ADMIN", "ACCOUNTS"]), (_req, res) => {
  if (!fs.existsSync(BACKUP_DIR)) return res.json([]);
  const dates = fs.readdirSync(BACKUP_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();
  return res.json(dates);
});

// Daily summary: totals, payment breakdown, top staff
router.get("/summary/:date", requireRoles(["ADMIN", "ACCOUNTS"]), (req, res) => {
  const headers: any[] = readTable(req.params.date, "pos_header");
  const ppd: any[]     = readTable(req.params.date, "pos_payment_details");
  const grn: any[]     = readTable(req.params.date, "grn");

  const posted = headers.filter(h => h.posted === 1 && (h.is_return === 0 || h.is_return === null));
  const drafts = headers.filter(h => h.posted === 0 && (h.is_return === 0 || h.is_return === null));

  const totalSales       = posted.reduce((s, h) => s + Number(h.amount || 0), 0);
  const totalTax         = posted.reduce((s, h) => s + Number(h.tax || 0), 0);
  const totalPurchases   = grn.filter(g => g.posted === 1).reduce((s, g) => s + Number(g.gtotal || 0), 0);

  // Payment breakdown from ppd (join by receiptno)
  const postedNos = new Set(posted.map(h => h.receiptno));
  const ppdPosted = ppd.filter(p => postedNos.has(p.receiptno));
  const breakdown: Record<string, { transactions: number; total: number }> = {};
  for (const p of ppdPosted) {
    const name = p.payname || "Unknown";
    if (!breakdown[name]) breakdown[name] = { transactions: 0, total: 0 };
    breakdown[name].transactions++;
    breakdown[name].total += Number(p.pamount || 0);
  }

  // Staff performance
  const staffMap: Record<string, { transactions: number; total: number; returns: number }> = {};
  for (const h of headers) {
    const s = h.staff || "Unknown";
    if (!staffMap[s]) staffMap[s] = { transactions: 0, total: 0, returns: 0 };
    if (h.is_return === 1) {
      staffMap[s].returns += Number(h.amount || 0);
    } else if (h.posted === 1) {
      staffMap[s].transactions++;
      staffMap[s].total += Number(h.amount || 0);
    }
  }

  return res.json({
    date:         req.params.date,
    transactions: posted.length,
    totalSales:   Math.round(totalSales),
    totalTax:     Math.round(totalTax),
    totalPurchases: Math.round(totalPurchases),
    draftCount:   drafts.length,
    draftTotal:   Math.round(drafts.reduce((s, h) => s + Number(h.amount || 0), 0)),
    paymentBreakdown: Object.entries(breakdown)
      .map(([name, v]) => ({ name, ...v, total: Math.round(v.total) }))
      .sort((a, b) => b.total - a.total),
    byStaff: Object.entries(staffMap)
      .map(([staff, v]) => ({ staff, ...v, total: Math.round(v.total), returns: Math.round(v.returns) }))
      .sort((a, b) => b.total - a.total),
  });
});

// Transactions list with filters and pagination
router.get("/transactions/:date", requireRoles(["ADMIN", "ACCOUNTS"]), (req, res) => {
  const headers: any[]  = readTable(req.params.date, "pos_header");
  const details: any[]  = readTable(req.params.date, "pos_details");
  const ppd: any[]      = readTable(req.params.date, "pos_payment_details");

  const { staff, method, minAmount, search, page = "1", posted: postedFilter } = req.query as Record<string, string>;
  const pageNum  = Math.max(1, parseInt(page) || 1);
  const pageSize = 50;

  // Build lookup maps
  const detailsByRct: Record<string, any[]> = {};
  for (const d of details) {
    if (!detailsByRct[d.receiptno]) detailsByRct[d.receiptno] = [];
    detailsByRct[d.receiptno].push(d);
  }
  const methodByRct: Record<string, string[]> = {};
  for (const p of ppd) {
    if (!methodByRct[p.receiptno]) methodByRct[p.receiptno] = [];
    if (!methodByRct[p.receiptno].includes(p.payname)) methodByRct[p.receiptno].push(p.payname);
  }

  let rows = headers;
  if (postedFilter === "1") rows = rows.filter(h => h.posted === 1);
  if (postedFilter === "0") rows = rows.filter(h => h.posted === 0);
  if (staff)     rows = rows.filter(h => h.staff?.toLowerCase().includes(staff.toLowerCase()));
  if (minAmount) rows = rows.filter(h => Number(h.amount) >= Number(minAmount));
  if (method)    rows = rows.filter(h => methodByRct[h.receiptno]?.some(m => m.toLowerCase().includes(method.toLowerCase())));
  if (search)    rows = rows.filter(h =>
    h.receiptno?.toLowerCase().includes(search.toLowerCase()) ||
    detailsByRct[h.receiptno]?.some(d => d.description?.toLowerCase().includes(search.toLowerCase()))
  );

  const total = rows.length;
  const sliced = rows
    .sort((a, b) => new Date(b.trandate || 0).getTime() - new Date(a.trandate || 0).getTime())
    .slice((pageNum - 1) * pageSize, pageNum * pageSize);

  return res.json({
    total,
    page:  pageNum,
    pages: Math.ceil(total / pageSize),
    rows: sliced.map(h => ({
      receiptno: h.receiptno,
      trandate:  h.trandate,
      staff:     h.staff,
      amount:    Number(h.amount || 0),
      posted:    h.posted,
      is_return: h.is_return,
      methods:   methodByRct[h.receiptno] ?? [],
      items:     (detailsByRct[h.receiptno] ?? []).map(d => ({
        code:        d.code,
        description: d.description,
        qty:         Number(d.qty || 0),
        price:       Number(d.price || 0),
        total:       Number(d.total || 0),
      })),
    })),
  });
});

// Stock movements with filters
router.get("/stock/:date", requireRoles(["ADMIN", "ACCOUNTS"]), (req, res) => {
  const stran: any[] = readTable(req.params.date, "stran");

  const { search, type, page = "1" } = req.query as Record<string, string>;
  const pageNum  = Math.max(1, parseInt(page) || 1);
  const pageSize = 100;

  let rows = stran;
  if (search) rows = rows.filter(s =>
    s.CODE?.toLowerCase().includes(search.toLowerCase()) ||
    s.descr?.toLowerCase().includes(search.toLowerCase())
  );
  if (type === "in")  rows = rows.filter(s => s.tt === "r");
  if (type === "out") rows = rows.filter(s => s.tt === "SALES" || Number(s.qty) < 0);
  if (type === "adj") rows = rows.filter(s => s.tt === "ADJ");

  const total  = rows.length;
  const sliced = rows
    .sort((a, b) => new Date(b.stdate || 0).getTime() - new Date(a.stdate || 0).getTime())
    .slice((pageNum - 1) * pageSize, pageNum * pageSize);

  return res.json({
    total,
    page:  pageNum,
    pages: Math.ceil(total / pageSize),
    rows: sliced.map(s => ({
      code:     s.CODE,
      descr:    s.descr,
      stdate:   s.stdate,
      qty:      Number(s.qty || 0),
      price:    Number(s.price || 0),
      total:    Number(s.total || 0),
      tt:       s.tt,
      trandesc: s.trandesc,
      staff:    s.staff,
    })),
  });
});
