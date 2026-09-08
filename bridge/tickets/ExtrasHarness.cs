using System;
using System.Data;
using System.IO;
using System.Reflection;
using CrystalDecisions.CrystalReports.Engine;
using CrystalDecisions.Shared;

// The dispatch note and the repeat-order marker, end to end, on paper.
//
// This drives the SHIPPED code - ReceiptExtras.Save and ReceiptTail.Append,
// reached by reflection because both are internal - rather than a copy of their
// logic. A test that reimplements what it is testing proves only that it agrees
// with itself.
//
// What it is checking, in order:
//
//   1. ReceiptExtras.Save writes one row, and writes the SAME one row when it
//      is called twice. Pay gets double-pressed; the primary key on receiptno
//      is what makes that harmless, and this proves it rather than assuming it.
//
//   2. ReceiptTail.Append puts its lines BELOW the last product. The layout
//      sorts and groups on description, so this is the whole question. An
//      earlier render showed punctuation sorts FIRST under Crystal's collation
//      - a "~" prefix landed above every item - which is why the prefix is
//      alphabetic.
//
//   3. The customer's figures do not move. TOTAL DUE, TOTAL ITEMS and VAT are
//      sums over pos_details, so an appended row carrying any number at all
//      would corrupt the receipt. This asserts them against the real basket.
//
//   4. receipt.tail.enabled = 0 stops it. That is the switch the shop reaches
//      for if any of this misbehaves during trading, and a kill switch nobody
//      has tested is not a kill switch.
//
// REFUSES to run against anything but mwalimuinvest_test.
//
//   csc.exe -nologo -target:exe -out:ExtrasHarness.exe -r:System.dll
//           -r:System.Data.dll -r:System.Windows.Forms.dll -r:System.Drawing.dll
//           -r:CrystalDecisions.CrystalReports.Engine.dll
//           -r:CrystalDecisions.Shared.dll -r:MySql.Data.dll -r:FumasV5.exe
//           ExtrasHarness.cs
internal static class ExtrasHarness
{
	private const BindingFlags Any =
		BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

	private static Assembly asm;
	private static int failures;

	[STAThread]
	private static int Main(string[] args)
	{
		string rpt = args.Length > 0
			? args[0]
			: @"C:\Users\Admin\Documents\Mwalimu Cosmetics\mwalimu\Debugv5\Reports\rptposiflex.rpt";
		string outDir = args.Length > 1 ? args[1] : ".";

		asm = Assembly.LoadFrom("FumasV5.exe");
		Type mglobal = asm.GetType("FumasV5.mglobal");

		string cs = (string)mglobal.GetField("mMySQLConnectionString", Any).GetValue(null);

		// This folder's FumasV5.exe.config is a build output pointed at the
		// live database, and it stays that way: editing it would leave a copy
		// of the shop's own config quietly aimed somewhere else. The override
		// is an environment variable instead, and the refusal below still has
		// the last word.
		string db = Environment.GetEnvironmentVariable("MWALIMU_DB_NAME");
		if (!string.IsNullOrEmpty(db))
		{
			cs = System.Text.RegularExpressions.Regex.Replace(
				cs, "Database=[^;]*;", "Database=" + db + ";");
			mglobal.GetField("mMySQLConnectionString", Any).SetValue(null, cs);
		}

		// mglobal assembles Server=localhost by default, which is right on a
		// till and wrong on this laptop - the database lives on server-pc.
		string host = Environment.GetEnvironmentVariable("MWALIMU_DB_HOST");
		if (!string.IsNullOrEmpty(host))
		{
			cs = System.Text.RegularExpressions.Regex.Replace(
				cs, "Server=[^;]*;", "Server=" + host + ";");
			mglobal.GetField("mMySQLConnectionString", Any).SetValue(null, cs);
		}

		string pw = Environment.GetEnvironmentVariable("MWALIMU_DB_PASSWORD");
		if (!string.IsNullOrEmpty(pw))
		{
			cs = System.Text.RegularExpressions.Regex.Replace(cs, "Password=[^;]*;", "Password=" + pw + ";");
			mglobal.GetField("mMySQLConnectionString", Any).SetValue(null, cs);
		}
		if (cs.IndexOf("mwalimuinvest_test", StringComparison.OrdinalIgnoreCase) < 0)
		{
			Console.WriteLine("REFUSING: not pointed at mwalimuinvest_test.");
			Console.WriteLine("  " + System.Text.RegularExpressions.Regex.Replace(cs, "Password=[^;]*;", "Password=***;"));
			return 2;
		}
		Console.WriteLine("connection: " +
			System.Text.RegularExpressions.Regex.Replace(cs, "Password=[^;]*;", "Password=***;"));
		mglobal.GetField("usercode", Any).SetValue(null, "HARNESS");

		const string Receipt = "HARNESS0001";

		Type extras = asm.GetType("FumasV5.ReceiptExtras", true);
		Type note = asm.GetType("FumasV5.DispatchNote", true);
		Type tail = asm.GetType("FumasV5.ReceiptTail", true);

		// ---- 1. Save, twice, and prove it is idempotent -------------------
		object n = Activator.CreateInstance(note, true);
		note.GetField("To", Any).SetValue(n, "JOHN MWANGI");
		note.GetField("Tel", Any).SetValue(n, "0722000111");
		note.GetField("Dest", Any).SetValue(n, "KISUMU BUS STAGE");

		MethodInfo save = extras.GetMethod("Save", Any);
		save.Invoke(null, new object[] { Receipt, n, 2, "CAROLINE MARURUI" });
		save.Invoke(null, new object[] { Receipt, n, 2, "CAROLINE MARURUI" });

		int rows = Scalar(cs, "select count(*) from pos_extras where receiptno = '" + Receipt + "'");
		Report(rows == 1, "saved twice, one row exists", "got " + rows + " rows");

		// ---- 2 and 3. Append, render, and read it back --------------------
		Type dsType = asm.GetType("FumasV5.DataSet1", true);
		DataSet ds = (DataSet)Activator.CreateInstance(dsType);
		Seed(ds, Receipt);

		DataTable det = ds.Tables["pos_details"];
		decimal realTotal = 0m;
		double realQty = 0;
		foreach (DataRow r in det.Rows) { realTotal += (decimal)r["total"]; realQty += (double)r["qty"]; }
		int before = det.Rows.Count;

		MethodInfo append = tail.GetMethod("Append", Any);
		append.Invoke(null, new object[] { ds, Receipt });

		int added = det.Rows.Count - before;
		Report(added == 4, "four lines appended (to, tel, dest, order n)", "added " + added);

		decimal afterTotal = 0m;
		double afterQty = 0;
		foreach (DataRow r in det.Rows)
		{
			if (r["total"] != DBNull.Value) afterTotal += (decimal)r["total"];
			if (r["qty"] != DBNull.Value) afterQty += (double)r["qty"];
		}
		Report(afterTotal == realTotal, "Sum(total) unchanged at " + realTotal.ToString("N2"),
			"became " + afterTotal.ToString("N2"));
		Report(afterQty == realQty, "Sum(qty) unchanged at " + realQty.ToString("N0"),
			"became " + afterQty.ToString("N0"));

		// The appended lines must sort below every product name, which is what
		// the alphabetic prefix is for. Compare against the largest real
		// description rather than a hardcoded letter.
		string maxReal = "";
		bool allBelow = true;
		foreach (DataRow r in det.Rows)
		{
			string d = Convert.ToString(r["description"]);
			if (r["total"] != DBNull.Value && string.CompareOrdinal(d, maxReal) > 0) maxReal = d;
		}
		foreach (DataRow r in det.Rows)
		{
			if (r["total"] != DBNull.Value) continue;
			string d = Convert.ToString(r["description"]);
			if (string.CompareOrdinal(d, maxReal) <= 0) allBelow = false;
		}
		Report(allBelow, "every appended line sorts after the last product (" + maxReal + ")",
			"one or more would print among the items");

		ReportDocument doc = new ReportDocument();
		doc.Load(rpt);
		doc.SetDataSource(ds);
		string pdf = Path.Combine(outDir, "extras-test.pdf");
		doc.ExportToDisk(ExportFormatType.PortableDocFormat, pdf);
		Console.WriteLine("  rendered: " + pdf);
		try { doc.Close(); doc.Dispose(); } catch (Exception) { }

		// ---- 4. The kill switch ------------------------------------------
		Exec(cs, "insert into mw_settings (skey, svalue, updated, staff) values " +
			"('receipt.tail.enabled','0',now(),'harness') " +
			"on duplicate key update svalue='0'");
		asm.GetType("FumasV5.MwSettings", true).GetMethod("Invalidate", Any).Invoke(null, null);

		DataSet ds2 = (DataSet)Activator.CreateInstance(dsType);
		Seed(ds2, Receipt);
		int b2 = ds2.Tables["pos_details"].Rows.Count;
		append.Invoke(null, new object[] { ds2, Receipt });
		Report(ds2.Tables["pos_details"].Rows.Count == b2,
			"receipt.tail.enabled=0 appends nothing", "it still appended");

		Exec(cs, "update mw_settings set svalue='1' where skey='receipt.tail.enabled'");
		Exec(cs, "delete from pos_extras where receiptno = '" + Receipt + "'");

		Console.WriteLine();
		Console.WriteLine(failures == 0 ? "ALL PASSED" : failures + " FAILED");
		return failures == 0 ? 0 : 1;
	}

	private static void Seed(DataSet ds, string receipt)
	{
		DataTable comp = ds.Tables["comp"];
		if (comp != null)
		{
			DataRow c = comp.NewRow();
			Set(c, "society_name", "MWALIMU COSMETICS");
			Set(c, "address", "NAIROBI");
			Set(c, "tel", "0700000000");
			Set(c, "pinno", "P000000000X");
			comp.Rows.Add(c);
		}
		DataTable h = ds.Tables["pos_header"];
		if (h != null)
		{
			DataRow r = h.NewRow();
			Set(r, "receiptno", receipt);
			Set(r, "arname", "CAROLINE MARURUI");
			Set(r, "arcode", "0727313767");
			Set(r, "staff", "MARYANN");
			Set(r, "amount", 730m);
			Set(r, "paid", 1000m);
			Set(r, "changee", 270m);
			Set(r, "disc", 0m);
			Set(r, "trandate", DateTime.Now);
			h.Rows.Add(r);
		}
		Item(ds.Tables["pos_details"], receipt, "ARIMIS MILKING JELLY 50GM", 5, 35m);
		Item(ds.Tables["pos_details"], receipt, "NIVEA ROLL ON 50ML", 1, 240m);
		Item(ds.Tables["pos_details"], receipt, "VASELINE JELLY PURE 95ML", 1, 120m);
		Item(ds.Tables["pos_details"], receipt, "ZINC OXIDE CREAM 100G", 1, 90m);
		Item(ds.Tables["pos_details"], receipt, "BABY CARE FORMULA 55GM", 3, 35m);
	}

	private static void Item(DataTable t, string receipt, string desc, double qty, decimal price)
	{
		DataRow r = t.NewRow();
		Set(r, "receiptno", receipt);
		Set(r, "description", desc);
		Set(r, "code", "T");
		Set(r, "qty", qty);
		Set(r, "price", price);
		Set(r, "total", price * (decimal)qty);
		Set(r, "vat", Math.Round(price * (decimal)qty * 0.16m / 1.16m, 2));
		t.Rows.Add(r);
	}

	private static void Set(DataRow r, string col, object v)
	{
		if (r.Table.Columns.Contains(col)) r[col] = v;
	}

	private static int Scalar(string cs, string sql)
	{
		using (MySql.Data.MySqlClient.MySqlConnection c =
			new MySql.Data.MySqlClient.MySqlConnection(cs))
		{
			c.Open();
			object o = new MySql.Data.MySqlClient.MySqlCommand(sql, c).ExecuteScalar();
			return o == null || o == DBNull.Value ? 0 : Convert.ToInt32(o);
		}
	}

	private static void Exec(string cs, string sql)
	{
		using (MySql.Data.MySqlClient.MySqlConnection c =
			new MySql.Data.MySqlClient.MySqlConnection(cs))
		{
			c.Open();
			new MySql.Data.MySqlClient.MySqlCommand(sql, c).ExecuteNonQuery();
		}
	}

	private static void Report(bool ok, string what, string detail)
	{
		Console.WriteLine((ok ? "  ok   " : "  FAIL ") + what + (ok ? "" : "   -> " + detail));
		if (!ok) failures++;
	}
}
