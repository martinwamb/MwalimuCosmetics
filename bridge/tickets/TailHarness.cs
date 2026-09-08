using System;
using System.Data;
using System.IO;
using System.Reflection;
using CrystalDecisions.CrystalReports.Engine;
using CrystalDecisions.Shared;

// Can text be added to the bottom of a POS receipt?
//
// The layout is a binary .rpt with no designer here and no vendor to ask. Its
// only two empty text objects are already spent on the collection ticket
// number, and they sit mid-receipt anyway. The one surface left is the data:
// append rows to the in-memory pos_details table and let them print as extra
// item lines.
//
// Two things had to be true for that to work, and RptSurvey says one of them
// is not:
//
//   1. Crystal must render detail rows in DataTable order. IT DOES NOT.
//      rptposiflex.rpt carries a record SORT and a GROUP, both on
//      pos_details.description, so an appended row lands wherever its text
//      sorts to. This harness finds a prefix that sorts last.
//
//   2. A row with no money in it must not disturb the receipt. Section4 prints
//      Sum({pos_details.total}), Sum({pos_details.qty}) and
//      Sum({pos_details.vat}) - the customer's TOTAL DUE, item count and VAT.
//      An appended row carrying figures would corrupt all three. This harness
//      proves nulls and zeroes both leave them alone, and shows whether a null
//      renders as blank or as 0.00 in the qty/price/amount columns.
//
// NO DATABASE. The dataset is built by hand, so this can run anywhere, cannot
// touch the shop, and cannot be aimed at the wrong server by accident.
//
// Compile INTO a FumasV5 install folder so the Crystal assemblies and
// FumasV5.exe (for DataSet1) resolve:
//
//   csc.exe -nologo -target:exe -out:TailHarness.exe -r:System.dll
//           -r:System.Data.dll -r:System.Windows.Forms.dll
//           -r:CrystalDecisions.CrystalReports.Engine.dll
//           -r:CrystalDecisions.Shared.dll -r:FumasV5.exe TailHarness.cs
//
//   TailHarness.exe <path-to-rptposiflex.rpt> <out-dir>
internal static class TailHarness
{
	private const BindingFlags Any =
		BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

	// Candidate prefixes, cheapest first. Crystal sorts strings by the report's
	// collation, not by raw ASCII, and a culture-aware sort can ignore leading
	// punctuation entirely - which would put "~DISPATCH" among the D's. So this
	// tries several and prints where each landed rather than reasoning about it.
	private static readonly string[] Candidates = { "~", "zzz~", "ZZZZ", "\uFF5E" };

	[STAThread]
	private static int Main(string[] args)
	{
		string rpt = args.Length > 0
			? args[0]
			: @"C:\Users\Admin\Documents\Mwalimu Cosmetics\mwalimu\Debugv5\Reports\rptposiflex.rpt";
		string outDir = args.Length > 1 ? args[1] : ".";

		if (!File.Exists(rpt)) { Console.WriteLine("No such layout: " + rpt); return 2; }

		Assembly asm = Assembly.LoadFrom("FumasV5.exe");
		Type dsType = asm.GetType("FumasV5.DataSet1", true);
		DataSet ds = (DataSet)Activator.CreateInstance(dsType);

		DataTable head = ds.Tables["pos_header"];
		DataTable det = ds.Tables["pos_details"];
		DataTable comp = ds.Tables["comp"];
		if (det == null) { Console.WriteLine("no pos_details table in DataSet1"); return 2; }

		Console.WriteLine("pos_details columns: " + det.Columns.Count);
		Console.WriteLine("pos_header  present: " + (head != null));
		Console.WriteLine("comp        present: " + (comp != null));
		Console.WriteLine();

		const string Receipt = "TEST000001";

		if (comp != null)
		{
			DataRow c = comp.NewRow();
			Set(c, "society_name", "MWALIMU COSMETICS");
			Set(c, "address", "P.O. BOX 000 NAIROBI");
			Set(c, "tel", "0700000000");
			Set(c, "cperson", "TEST");
			Set(c, "pinno", "P000000000X");
			comp.Rows.Add(c);
		}

		if (head != null)
		{
			DataRow h = head.NewRow();
			Set(h, "receiptno", Receipt);
			Set(h, "arname", "CAROLINE MARURUI");
			Set(h, "arcode", "0727313767");
			Set(h, "staff", "MARYANN");
			Set(h, "amount", 705m);
			Set(h, "paid", 1000m);
			Set(h, "changee", 295m);
			Set(h, "disc", 0m);
			Set(h, "trandate", DateTime.Now);
			head.Rows.Add(h);
		}

		// Five real products, deliberately spanning A to Z so an appended row
		// has something to sort against at both ends.
		Item(det, Receipt, "ARIMIS MILKING JELLY 50GM", 5, 35m);
		Item(det, Receipt, "BABY CARE FORMULA 55GM", 3, 35m);
		Item(det, Receipt, "NIVEA ROLL ON 50ML", 1, 240m);
		Item(det, Receipt, "VASELINE JELLY PURE 95ML", 1, 120m);
		Item(det, Receipt, "ZINC OXIDE CREAM 100G", 1, 90m);

		decimal realTotal = 0m;
		double realQty = 0;
		foreach (DataRow r in det.Rows)
		{
			realTotal += (decimal)r["total"];
			realQty += (double)r["qty"];
		}
		Console.WriteLine("before appending: " + det.Rows.Count + " rows, total "
			+ realTotal.ToString("N2") + ", qty " + realQty.ToString("N0"));

		// One tail row per candidate prefix, every money column left DBNull.
		foreach (string p in Candidates)
		{
			Tail(det, Receipt, p + "DISPATCH TO: JOHN MWANGI");
		}
		// And one with explicit zeroes, to see which renders more cleanly.
		DataRow z = det.NewRow();
		Set(z, "receiptno", Receipt);
		Set(z, "description", "ZZZZZERO TEL: 0722000000");
		Set(z, "qty", 0.0); Set(z, "price", 0m); Set(z, "total", 0m); Set(z, "vat", 0m);
		det.Rows.Add(z);

		Console.WriteLine("after appending : " + det.Rows.Count + " rows");
		Console.WriteLine();

		ReportDocument doc = new ReportDocument();
		doc.Load(rpt);
		doc.SetDataSource(ds);

		string pdf = Path.Combine(outDir, "tail-test.pdf");
		doc.ExportToDisk(ExportFormatType.PortableDocFormat, pdf);
		Console.WriteLine("rendered: " + pdf);

		// Text as well as PDF. The PDF is what a person should look at, but the
		// text export is what answers the question mechanically: it lists the
		// detail lines in the order Crystal actually laid them out, which is
		// the whole point of this harness.
		string txt = Path.Combine(outDir, "tail-test.txt");
		try
		{
			doc.ExportToDisk(ExportFormatType.Text, txt);
			Console.WriteLine("rendered: " + txt);
		}
		catch (Exception ex)
		{
			Console.WriteLine("text export unavailable: " + ex.Message);
		}

		// The totals the customer reads. If appending moved either of these the
		// whole idea is dead, whatever the layout looks like.
		Console.WriteLine();
		Console.WriteLine("Sum(total) must still be " + realTotal.ToString("N2")
			+ " and Sum(qty) still " + realQty.ToString("N0") + " on the PDF.");
		Console.WriteLine("Look at the PDF for: where each prefix landed, and whether the");
		Console.WriteLine("null rows show blank or 0.00 in the QTY/PRICE/AMOUNT columns.");

		try { doc.Close(); doc.Dispose(); } catch (Exception) { }
		return 0;
	}

	private static void Item(DataTable t, string receipt, string desc, double qty, decimal price)
	{
		DataRow r = t.NewRow();
		Set(r, "receiptno", receipt);
		Set(r, "description", desc);
		Set(r, "code", "TEST");
		Set(r, "qty", qty);
		Set(r, "price", price);
		Set(r, "total", price * (decimal)qty);
		Set(r, "vat", Math.Round(price * (decimal)qty * 0.16m / 1.16m, 2));
		t.Rows.Add(r);
	}

	// A tail row: text in description, and NOTHING in any column the receipt
	// sums. Every cell is addressed by name - rpt_pos_R_re_print's details
	// query starts "select 1,receiptno,..." and Fill adds that unaliased
	// literal as a 21st column to this same table, so position 0 is not
	// reliably receiptno once a reprint has run.
	private static void Tail(DataTable t, string receipt, string text)
	{
		DataRow r = t.NewRow();
		Set(r, "receiptno", receipt);
		Set(r, "description", text);
		t.Rows.Add(r);
	}

	private static void Set(DataRow r, string col, object v)
	{
		if (r.Table.Columns.Contains(col)) r[col] = v;
	}
}
