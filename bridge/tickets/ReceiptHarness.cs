using System;
using System.IO;
using System.Reflection;
using CrystalDecisions.CrystalReports.Engine;
using CrystalDecisions.Shared;

// Prints a real receipt and its collection ticket, for one real sale.
//
// This is the test that matters: the receipt is a Crystal report loaded from a
// binary .rpt, and the ticket is drawn by hand. They are two completely
// different printing systems that have to come out of the same printer, one
// after the other, without either disturbing the other. Nothing short of
// running the shop's own rpt_pos_R_auto proves that.
//
// It runs FumasV5's real code by reflection — no copy of their logic here — and
// exports what came out rather than printing it, so it can be looked at.
//
// Must be compiled INTO a FumasV5 install folder, so that Reports\*.rpt, the
// Crystal assemblies and MySql.Data.dll all resolve, and must run STA because
// Crystal's viewer is a Windows Forms control.
internal static class ReceiptHarness
{
	private const BindingFlags Any =
		BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

	private static Assembly asm;
	private static int failures;

	[STAThread]
	private static int Main(string[] args)
	{
		string receipt = args.Length > 0 ? args[0] : "NPOS276317";
		string outDir = args.Length > 1 ? args[1] : ".";

		asm = Assembly.LoadFrom("FumasV5.exe");
		Type mglobal = asm.GetType("FumasV5.mglobal");

		// The connection string is built from this folder's FumasV5.exe.config,
		// which points at mwalimuinvest_test. Read it back and prove that,
		// rather than trusting it: a harness that silently ran against the live
		// database would be the worst possible outcome here.
		string cs = (string)mglobal.GetField("mMySQLConnectionString", Any).GetValue(null);
		Console.WriteLine("connection: " + Scrub(cs));
		if (cs.IndexOf("mwalimuinvest_test", StringComparison.OrdinalIgnoreCase) < 0)
		{
			Console.WriteLine("REFUSING: connection string is not pointed at mwalimuinvest_test.");
			return 2;
		}

		// The password baked into FumasV5.exe.config authenticates the tills,
		// but not this laptop: MySQL has a host-specific root@10.10.10.50
		// account with its own password, and a specific host match beats
		// root@'%'. So the string is rebuilt here with credentials that work
		// from this machine. Everything else about it — including the database
		// checked above — is left exactly as the shop's config produced it.
		string pw = Environment.GetEnvironmentVariable("MWALIMU_DB_PASSWORD");
		if (!string.IsNullOrEmpty(pw))
		{
			cs = System.Text.RegularExpressions.Regex.Replace(
				cs, "Password=[^;]*;", "Password=" + pw + ";",
				System.Text.RegularExpressions.RegexOptions.IgnoreCase);
			string host = Environment.GetEnvironmentVariable("MWALIMU_DB_HOST");
			if (!string.IsNullOrEmpty(host))
			{
				cs = System.Text.RegularExpressions.Regex.Replace(
					cs, "Server=[^;]*;", "Server=" + host + ";",
					System.Text.RegularExpressions.RegexOptions.IgnoreCase);
			}
			mglobal.GetField("mMySQLConnectionString", Any).SetValue(null, cs);

			// Modreports keeps its own long-lived connection, built from the
			// same string but at type-load time, so it needs telling too.
			Type mr = asm.GetType("FumasV5.Modreports");
			object mconn = mr.GetField("connection", Any).GetValue(null);
			if (mconn != null)
			{
				mconn.GetType().GetProperty("ConnectionString").SetValue(mconn, cs, null);
			}
			Console.WriteLine("credentials: overridden for this machine");
		}

		mglobal.GetField("username", Any).SetValue(null, "admin");
		mglobal.GetField("usercode", Any).SetValue(null, "admin");
		Console.WriteLine("receipt   : " + receipt);
		Console.WriteLine();

		string pdf = Path.Combine(outDir, "receipt-" + receipt + ".pdf");
		ReceiptThroughCrystal(receipt, pdf);
		TicketBesideIt(receipt, outDir);

		Console.WriteLine();
		Console.WriteLine(failures == 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
		return failures == 0 ? 0 : 1;
	}

	// ── The receipt, through the shop's own code ──────────────────────

	private static void ReceiptThroughCrystal(string receipt, string pdf)
	{
		Console.WriteLine("-- the receipt (Crystal) --");
		Type mglobal = asm.GetType("FumasV5.mglobal");
		Type modreports = asm.GetType("FumasV5.Modreports");

		// print_direct_pos=false makes rpt_pos_R_auto hand the finished document
		// to the on-screen viewer instead of a printer. That is the whole trick
		// here: the document can then be taken off the viewer and exported,
		// while everything upstream of it — the queries, the .rpt chosen, the
		// company header — is the shop's real code, untouched.
		mglobal.GetField("print_direct_pos", Any).SetValue(null, false);

		// Stepped rather than one call, because when this path stalls it does
		// so silently — no dialog, no error — and the only way to find out
		// where is to watch it go past each stage.
		try
		{
			// get_comp_settings starts with MyProject.Forms.Report.Close(),
			// which is the first thing that builds a Crystal viewer control.
			// Touched separately so a stall there is not blamed on the SQL
			// above it.
			Trace("touching MyProject.Forms.Report");
			object probe = DocumentFromViewerRaw();
			Trace("MyProject.Forms.Report reached: " + (probe == null ? "null source" : probe.GetType().Name));

			// The first four statements of get_comp_settings, run individually,
			// because the method swallows everything into a MessageBox and
			// gives no clue which line it stopped on.
			Trace("Report.Close()");
			object formsObj = Value(asm.GetType("FumasV5.My.MyProject"), null, "Forms");
			object rep = Value(formsObj.GetType(), formsObj, "Report");
			rep.GetType().GetMethod("Close", Any).Invoke(rep, null);
			Trace("Report.Close() returned");

			Trace("custDB.Clear()");
			object custDB = Value(modreports, null, "custDB");
			custDB.GetType().GetMethod("Clear", Any).Invoke(custDB, null);
			Trace("custDB.Clear() returned");

			object mconn = Value(modreports, null, "connection");
			Trace("Modreports.connection = " + (mconn == null ? "null" : mconn.GetType().Name +
				" state=" + Value(mconn.GetType(), mconn, "State")));
			Trace("connection.Close()");
			mconn.GetType().GetMethod("Close", Any).Invoke(mconn, null);
			Trace("connection.Open()");
			mconn.GetType().GetMethod("Open", Any).Invoke(mconn, null);
			Trace("connection open, state=" + Value(mconn.GetType(), mconn, "State"));

			Trace("get_comp_settings");
			MethodInfo gcs = modreports.GetMethod("get_comp_settings", Any);
			if (gcs != null) gcs.Invoke(null, new object[] { "", "" });
			Trace("get_comp_settings returned");

			MethodInfo m = modreports.GetMethod("rpt_pos_R_auto", Any);
			if (m == null) { Report(false, "rpt_pos_R_auto found", "no such method"); return; }
			Trace("rpt_pos_R_auto");
			m.Invoke(null, new object[] { receipt, false });
			Trace("rpt_pos_R_auto returned");
			Report(true, "rpt_pos_R_auto ran without throwing", "");
		}
		catch (Exception ex)
		{
			Report(false, "rpt_pos_R_auto ran", Unwrap(ex));
			return;
		}

		ReportDocument doc = DocumentFromViewer();
		if (doc == null) { Report(false, "a report document reached the viewer", "viewer was empty"); return; }

		Console.WriteLine("  report    : " + (doc.FileName == null ? "(compiled)" : Path.GetFileName(doc.FileName)));

		try
		{
			if (File.Exists(pdf)) File.Delete(pdf);
			doc.ExportToDisk(ExportFormatType.PortableDocFormat, pdf);
			bool made = File.Exists(pdf) && new FileInfo(pdf).Length > 0;
			Report(made, "exported to " + pdf, "nothing was written");
			if (made) Console.WriteLine("  pdf       : " + new FileInfo(pdf).Length + " bytes");
		}
		catch (Exception ex)
		{
			Report(false, "exported the receipt", Unwrap(ex));
		}
	}

	private static ReportDocument DocumentFromViewer()
	{
		try
		{
			Type myProject = asm.GetType("FumasV5.My.MyProject");
			object forms = Value(myProject, null, "Forms");
			object reportForm = Value(forms.GetType(), forms, "Report");
			object viewer = Value(reportForm.GetType(), reportForm, "CrystalReportViewer1");
			object source = Value(viewer.GetType(), viewer, "ReportSource");
			return source as ReportDocument;
		}
		catch (Exception ex)
		{
			Console.WriteLine("  could not reach the viewer: " + Unwrap(ex));
			return null;
		}
	}

	private static object DocumentFromViewerRaw()
	{
		Type myProject = asm.GetType("FumasV5.My.MyProject");
		object forms = Value(myProject, null, "Forms");
		object reportForm = Value(forms.GetType(), forms, "Report");
		object viewer = Value(reportForm.GetType(), reportForm, "CrystalReportViewer1");
		return Value(viewer.GetType(), viewer, "ReportSource");
	}

	private static object Value(Type t, object instance, string name)
	{
		PropertyInfo p = t.GetProperty(name, Any);
		if (p != null) return p.GetValue(instance, null);
		FieldInfo f = t.GetField(name, Any);
		if (f != null) return f.GetValue(instance);
		throw new Exception("no member " + name + " on " + t.Name);
	}

	// ── The ticket, beside it ─────────────────────────────────────────

	private static void TicketBesideIt(string receipt, string outDir)
	{
		Console.WriteLine();
		Console.WriteLine("-- the collection ticket --");
		Type slip = asm.GetType("FumasV5.TicketSlip");
		try
		{
			object t = slip.GetMethod("Issue", Any).Invoke(null, new object[] { receipt });
			if (t == null) { Report(false, "a ticket was issued", "Issue returned null"); return; }

			string code = (string)t.GetType().GetField("Code", Any).GetValue(t);
			Console.WriteLine("  ticket    : " + code);

			using (System.Drawing.Bitmap bmp =
				(System.Drawing.Bitmap)slip.GetMethod("Render", Any).Invoke(null, new object[] { t, 300 }))
			{
				string png = Path.Combine(outDir, "slip-" + code + ".png");
				bmp.Save(png, System.Drawing.Imaging.ImageFormat.Png);
				double mm = bmp.Height / 300.0 * 25.4;
				Console.WriteLine("  slip      : " + png);
				Console.WriteLine("  paper     : " + mm.ToString("F0") + " mm of roll");
				Report(bmp.Width == 850, "  72mm wide", "got " + bmp.Width + "px");
			}
		}
		catch (Exception ex)
		{
			Report(false, "the ticket was produced", Unwrap(ex));
		}
	}

	// ── plumbing ──────────────────────────────────────────────────────

	private static string Scrub(string cs)
	{
		if (cs == null) return "(null)";
		int i = cs.IndexOf("Password=", StringComparison.OrdinalIgnoreCase);
		if (i < 0) return cs;
		int j = cs.IndexOf(';', i);
		return cs.Substring(0, i) + "Password=***" + (j < 0 ? "" : cs.Substring(j));
	}

	private static string Unwrap(Exception ex)
	{
		Exception e = ex;
		while (e is TargetInvocationException && e.InnerException != null) e = e.InnerException;
		return e.GetType().Name + ": " + e.Message;
	}

	private static readonly DateTime started = DateTime.Now;

	private static void Trace(string what)
	{
		Console.WriteLine("  [" + (DateTime.Now - started).TotalSeconds.ToString("F1").PadLeft(6) + "s] " + what);
		Console.Out.Flush();
	}

	private static void Report(bool ok, string what, string ifNot)
	{
		if (ok) Console.WriteLine("  ok   " + what);
		else { failures++; Console.WriteLine("  FAIL " + what + (ifNot.Length > 0 ? "  -- " + ifNot : "")); }
	}
}
