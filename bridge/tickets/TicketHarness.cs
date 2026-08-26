using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.Reflection;

// Exercises TicketSlip against mwalimuinvest_test.
//
// FumasV5's own classes are internal and normally reachable only by clicking
// through the application, so this reaches in by reflection — the same method
// already used to test the AR posting path. It is compiled into bin\Release so
// MySql.Data.dll and the rest resolve, and deleted afterwards.
//
// It never calls Print(). Printing would go to a real printer on a real till;
// Render() draws the identical layout through the identical Draw(), so what
// this writes to a PNG is what a customer would be handed.
internal static class TicketHarness
{
	private static Assembly asm;
	private static Type tMglobal;
	private static Type tSlip;
	private static int failures;

	private const BindingFlags Any =
		BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

	private static int Main(string[] args)
	{
		string db = args.Length > 0 ? args[0] : "mwalimuinvest_test";
		string outDir = args.Length > 1 ? args[1] : ".";

		asm = Assembly.LoadFrom("FumasV5.exe");
		tMglobal = asm.GetType("FumasV5.mglobal");
		tSlip = asm.GetType("FumasV5.TicketSlip");
		if (tMglobal == null || tSlip == null)
		{
			Console.WriteLine("FATAL: could not find FumasV5.mglobal or FumasV5.TicketSlip");
			return 2;
		}

		// Set the few statics directly. get_settings() puts a dialog on screen
		// and would hang a console process.
		SetStatic("mMySQLConnectionString",
			"Server=10.10.10.4;Database=" + db + ";User ID=root;port=3306;Password=allowme;" +
			"charset=utf8; Convert Zero Datetime=True;Connect Timeout=120000;");
		SetStatic("usercode", "HARNESS");
		SetStatic("username", "HARNESS");

		Console.WriteLine("Database: " + db);
		Console.WriteLine();

		BandingBoundaries();
		IssueRealReceipts(outDir);
		Idempotence();
		RealPrinter(outDir);

		Console.WriteLine();
		Console.WriteLine(failures == 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
		return failures == 0 ? 0 : 1;
	}

	// ── The express rule, at its edges ────────────────────────────────
	//
	// Express is "at most 2,000 AND at most 5 items". The interesting cases are
	// all one step either side of those two numbers, and the pair that proves
	// it is an AND rather than an OR: a cheap basket with too many things in
	// it, and a small basket that costs too much.
	private static void BandingBoundaries()
	{
		Console.WriteLine("-- banding --");
		Band(2000m, 5, 'E', "on both limits exactly");
		Band(1999m, 4, 'E', "inside both");
		Band(2001m, 5, 'B', "one shilling over the value limit");
		Band(2000m, 6, 'B', "one item over the item limit");
		Band(1500m, 9, 'B', "cheap but nine things to fetch");
		Band(15000m, 4, 'C', "only four things but a large order");
		Band(10000m, 20, 'B', "on the standard ceiling exactly");
		Band(10001m, 20, 'C', "one shilling over the standard ceiling");
		Band(0m, 0, 'E', "an empty basket does not crash the rule");
		Console.WriteLine();
	}

	private static void Band(decimal amount, int lines, char expect, string why)
	{
		MethodInfo m = tSlip.GetMethod("Classify", Any);
		char got = (char)m.Invoke(null, new object[] { amount, lines, (decimal)lines });
		Report(got == expect,
			string.Format(CultureInfo.InvariantCulture,
				"{0,8:N0} / {1,2} items -> {2}   ({3})", amount, lines, got, why),
			"expected " + expect);
	}

	// ── Real sales, copied out of the live database ───────────────────

	private static void IssueRealReceipts(string outDir)
	{
		Console.WriteLine("-- issuing against real receipts --");
		foreach (string r in new string[] { "NPOS276317", "JPOS276318", "CPOS276249" })
		{
			object t = Issue(r);
			if (t == null)
			{
				Report(false, r, "Issue returned null");
				continue;
			}

			string code = (string)Get(t, "Code");
			char band = (char)Get(t, "Band");
			decimal amount = (decimal)Get(t, "Amount");
			int lineCount = (int)Get(t, "LineCount");
			decimal units = (decimal)Get(t, "Units");
			int lo = (int)Get(t, "EtaLo");
			int hi = (int)Get(t, "EtaHi");
			string who = (string)Get(t, "Arname");
			DateTime day = (DateTime)Get(t, "Day");

			Console.WriteLine(string.Format(CultureInfo.InvariantCulture,
				"  {0,-11} {1,-6} {2,9:N0}  {3,2} lines  {4,5:N0} units  eta {5}-{6}min  day {7:yyyy-MM-dd}  {8}",
				r, code, amount, lineCount, units, lo, hi, day, who));

			Report(code.StartsWith(band + "-") && code.Length == 5, "    code is well formed: " + code, "expected like E-001");
			Report(hi > 0 && hi >= lo, "    eta is sane", "got " + lo + "-" + hi);
			Report(lineCount > 0, "    line count is real", "got " + lineCount);

			// Draw the slip the customer would be handed.
			MethodInfo render = tSlip.GetMethod("Render", Any);
			using (Bitmap bmp = (Bitmap)render.Invoke(null, new object[] { t, 300 }))
			{
				string path = System.IO.Path.Combine(outDir, "ticket-" + code + ".png");
				bmp.Save(path, ImageFormat.Png);
				Console.WriteLine("    slip rendered: " + path + "  (" + bmp.Width + "x" + bmp.Height + " px at 300dpi)");
				// 72mm at 300dpi is 850px. Anything else means the page width
				// drifted and the slip would not fit the roll.
				Report(bmp.Width == 850, "    slip is 72mm wide", "got " + bmp.Width + "px, expected 850");
			}
		}
		Console.WriteLine();
	}

	// ── One sale, one number, however many times it is asked for ──────

	private static void Idempotence()
	{
		Console.WriteLine("-- idempotence --");
		object first = Issue("JPOS276318");
		object second = Issue("JPOS276318");
		if (first == null || second == null)
		{
			Report(false, "  two issues on one receipt", "one of them returned null");
			Console.WriteLine();
			return;
		}

		string a = (string)Get(first, "Code");
		string b = (string)Get(second, "Code");
		bool reissued = (bool)Get(second, "Reissued");

		Report(a == b, "  same receipt gives the same number twice: " + a + " / " + b, "they differ");
		Report(reissued, "  the second one knows it was already issued", "Reissued was false");

		object missing = Issue("NO-SUCH-RECEIPT-9999");
		Report(missing == null, "  a receipt that does not exist gets no ticket", "something was returned");
		Console.WriteLine();
	}

	// ── Through a real printer driver ─────────────────────────────────
	//
	// Render() draws to a bitmap and never touches a printer. That proves the
	// layout but not the plumbing: page size, margins, and the PrintPage
	// handler are all only exercised once a driver is involved. Microsoft
	// Print to PDF is a real driver and is on every machine here, so the slip
	// goes through the whole path and lands as a file that can be opened.
	private static void RealPrinter(string outDir)
	{
		Console.WriteLine("-- through a real printer driver --");
		object t = Issue("NPOS276317");
		if (t == null)
		{
			Report(false, "  print to PDF", "no ticket to print");
			return;
		}

		try
		{
			MethodInfo build = tSlip.GetMethod("BuildDocument", Any);
			System.Drawing.Printing.PrintDocument doc =
				(System.Drawing.Printing.PrintDocument)build.Invoke(null, new object[] { t });

			string path = System.IO.Path.Combine(outDir, "ticket-print-test.pdf");
			if (System.IO.File.Exists(path)) System.IO.File.Delete(path);

			doc.PrinterSettings.PrinterName = "Microsoft Print to PDF";
			if (!doc.PrinterSettings.IsValid)
			{
				Console.WriteLine("  skipped: Microsoft Print to PDF is not installed here");
				return;
			}
			doc.PrinterSettings.PrintToFile = true;
			doc.PrinterSettings.PrintFileName = path;

			System.Drawing.Printing.PaperSize ps = doc.DefaultPageSettings.PaperSize;
			Console.WriteLine("  page: " + ps.Width + " x " + ps.Height +
				" hundredths of an inch  (" +
				(ps.Width / 100.0 * 25.4).ToString("F1") + " x " +
				(ps.Height / 100.0 * 25.4).ToString("F1") + " mm)");
			// 72mm is 283 hundredths. Drifting off that means the slip no
			// longer matches the roll it is printed on.
			Report(ps.Width == 283, "  page is 72mm wide", "got " + ps.Width + " hundredths");

			doc.Print();

			bool made = System.IO.File.Exists(path) && new System.IO.FileInfo(path).Length > 0;
			Report(made, "  printed to " + path, "no file was produced");
			if (made)
			{
				Console.WriteLine("  pdf is " + new System.IO.FileInfo(path).Length + " bytes");
			}
		}
		catch (Exception ex)
		{
			Exception real = ex is TargetInvocationException && ex.InnerException != null
				? ex.InnerException : ex;
			Report(false, "  print to PDF", real.GetType().Name + ": " + real.Message);
		}
		Console.WriteLine();
	}

	// ── plumbing ──────────────────────────────────────────────────────

	private static object Issue(string receiptno)
	{
		MethodInfo m = tSlip.GetMethod("Issue", Any);
		try
		{
			return m.Invoke(null, new object[] { receiptno });
		}
		catch (TargetInvocationException ex)
		{
			Console.WriteLine("  Issue(" + receiptno + ") threw: " +
				(ex.InnerException == null ? ex.Message : ex.InnerException.Message));
			return null;
		}
	}

	private static object Get(object o, string field)
	{
		FieldInfo f = o.GetType().GetField(field, Any);
		if (f != null) return f.GetValue(o);
		PropertyInfo p = o.GetType().GetProperty(field, Any);
		return p == null ? null : p.GetValue(o, null);
	}

	private static void SetStatic(string name, object value)
	{
		FieldInfo f = tMglobal.GetField(name, Any);
		if (f == null) throw new Exception("no such mglobal field: " + name);
		f.SetValue(null, value);
	}

	private static void Report(bool ok, string what, string ifNot)
	{
		if (ok)
		{
			Console.WriteLine("  ok   " + what);
		}
		else
		{
			failures++;
			Console.WriteLine("  FAIL " + what + "  -- " + ifNot);
		}
	}
}
