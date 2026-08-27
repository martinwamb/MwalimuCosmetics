using System;
using System.IO;
using System.Reflection;
using CrystalDecisions.CrystalReports.Engine;
using CrystalDecisions.Shared;

// Reprints a real receipt and reads what actually came out.
//
// A reprinted receipt is supposed to carry a line at the bottom marking it as a
// reprint, so it cannot be mistaken for an original. rptPosiflex_reprint.rpt
// exists and is loaded, but the line is driven by pos_header.reprint and
// nothing ever incremented it — every receipt in the shop read zero.
//
// Exporting to HTML rather than PDF is the point: Crystal compresses text
// inside a PDF, so the only way to assert on the words the customer would see
// is to ask Crystal for them in a readable form. This build of Crystal has no
// plain-text export, so HTML32 it is. A PDF is written too, to look at.
internal static class ReprintHarness
{
	private const BindingFlags Any =
		BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

	private static Assembly asm;
	private static int failures;

	[STAThread]
	private static int Main(string[] args)
	{
		string receipt = args.Length > 0 ? args[0] : "JPOS276318";
		string outDir = args.Length > 1 ? args[1] : ".";

		// Loaded by its own folder, not the working directory, so this harness
		// can be run from anywhere — which is the whole point of the test it
		// now performs: reports must be found however the program was started.
		asm = Assembly.LoadFrom(System.IO.Path.Combine(
			AppDomain.CurrentDomain.BaseDirectory, "FumasV5.exe"));
		Console.WriteLine("working dir: " + Environment.CurrentDirectory);
		Type mglobal = asm.GetType("FumasV5.mglobal");

		string cs = (string)mglobal.GetField("mMySQLConnectionString", Any).GetValue(null);
		if (cs.IndexOf("mwalimuinvest_test", StringComparison.OrdinalIgnoreCase) < 0)
		{
			Console.WriteLine("REFUSING: not pointed at mwalimuinvest_test.");
			return 2;
		}

		string pw = Environment.GetEnvironmentVariable("MWALIMU_DB_PASSWORD");
		string host = Environment.GetEnvironmentVariable("MWALIMU_DB_HOST");
		if (!string.IsNullOrEmpty(pw))
		{
			cs = System.Text.RegularExpressions.Regex.Replace(cs, "Password=[^;]*;", "Password=" + pw + ";",
				System.Text.RegularExpressions.RegexOptions.IgnoreCase);
			if (!string.IsNullOrEmpty(host))
				cs = System.Text.RegularExpressions.Regex.Replace(cs, "Server=[^;]*;", "Server=" + host + ";",
					System.Text.RegularExpressions.RegexOptions.IgnoreCase);
			mglobal.GetField("mMySQLConnectionString", Any).SetValue(null, cs);
			Type mr0 = asm.GetType("FumasV5.Modreports");
			object mc = mr0.GetField("connection", Any).GetValue(null);
			if (mc != null) mc.GetType().GetProperty("ConnectionString").SetValue(mc, cs, null);
		}
		mglobal.GetField("username", Any).SetValue(null, "admin");
		mglobal.GetField("usercode", Any).SetValue(null, "admin");
		mglobal.GetField("print_direct_pos", Any).SetValue(null, false);

		Console.WriteLine("receipt: " + receipt);
		Console.WriteLine("counter before : " + Counter(receipt));

		Type mr = asm.GetType("FumasV5.Modreports");
		try
		{
			mr.GetMethod("rpt_pos_R_re_print", Any).Invoke(null, new object[] { receipt, false });
		}
		catch (Exception ex)
		{
			Exception real = ex is TargetInvocationException && ex.InnerException != null ? ex.InnerException : ex;
			Console.WriteLine("FAIL rpt_pos_R_re_print threw: " + real.GetType().Name + ": " + real.Message);
			return 1;
		}

		int after = Counter(receipt);
		Console.WriteLine("counter after  : " + after);
		Check(after > 0, "the reprint was counted");

		ReportDocument doc = FromViewer();
		if (doc == null) { Check(false, "a report reached the viewer"); return 1; }
		Console.WriteLine("report used    : " +
			(doc.FileName == null ? "(compiled fallback)" : Path.GetFileName(doc.FileName)));
		Check(doc.FileName != null && doc.FileName.ToLower().Contains("reprint"),
			"the REPRINT report was chosen, not the plain receipt");

		// What the .rpt actually binds to. If the marker is missing, either the
		// report has no field for it, or it has one this query never fills.
		try
		{
			Console.WriteLine();
			Console.WriteLine("---- fields the report expects ----");
			foreach (CrystalDecisions.CrystalReports.Engine.Table t in doc.Database.Tables)
			{
				Console.WriteLine("   table: " + t.Name);
				foreach (CrystalDecisions.CrystalReports.Engine.DatabaseFieldDefinition fd in t.Fields)
				{
					string n = fd.Name.ToLower();
					if (n.Contains("print") || n.Contains("copy") || n.Contains("dup"))
						Console.WriteLine("      * " + fd.Name + "  (" + fd.ValueType + ")");
				}
			}
			Console.WriteLine("   -- formulas --");
			foreach (CrystalDecisions.CrystalReports.Engine.FormulaFieldDefinition ff in doc.DataDefinition.FormulaFields)
			{
				string n = ff.Name.ToLower();
				string txtf = ff.Text == null ? "" : ff.Text.ToLower();
				if (n.Contains("print") || n.Contains("copy") || n.Contains("dup") ||
					txtf.Contains("print") || txtf.Contains("copy") || txtf.Contains("dup"))
					Console.WriteLine("      * " + ff.Name + " = " + Flatten(ff.Text));
			}
			Console.WriteLine("   -- text objects mentioning reprint/copy --");
			foreach (CrystalDecisions.CrystalReports.Engine.Section sec in doc.ReportDefinition.Sections)
			{
				foreach (CrystalDecisions.CrystalReports.Engine.ReportObject ro in sec.ReportObjects)
				{
					CrystalDecisions.CrystalReports.Engine.TextObject to =
						ro as CrystalDecisions.CrystalReports.Engine.TextObject;
					if (to == null) continue;
					string s = to.Text == null ? "" : to.Text;
					if (s.ToLower().Contains("print") || s.ToLower().Contains("copy") || s.ToLower().Contains("dup"))
						Console.WriteLine("      [" + sec.Name + "] " + s.Trim());
				}
			}
			Console.WriteLine("-----------------------------------");
		}
		catch (Exception ex) { Console.WriteLine("   (could not inspect: " + ex.Message + ")"); }

		string txt = Path.Combine(outDir, "reprint-" + receipt + ".html");
		string pdf = Path.Combine(outDir, "reprint-" + receipt + ".pdf");
		doc.ExportToDisk(ExportFormatType.HTML32, txt);
		doc.ExportToDisk(ExportFormatType.PortableDocFormat, pdf);

		// HTML32 writes a folder of files; the exported path is the entry page.
		string body = File.Exists(txt) ? File.ReadAllText(txt) : "";
		if (body.Length == 0)
		{
			string dir = Path.GetDirectoryName(txt);
			foreach (string f in Directory.GetFiles(dir, "*.htm*"))
			{
				if (File.GetLastWriteTime(f) > DateTime.Now.AddMinutes(-2)) body += File.ReadAllText(f);
			}
		}
		body = System.Text.RegularExpressions.Regex.Replace(body, "<[^>]+>", " ");
		bool marked = body.IndexOf("RE-PRINT", StringComparison.OrdinalIgnoreCase) >= 0 ||
					  body.IndexOf("REPRINT", StringComparison.OrdinalIgnoreCase) >= 0 ||
					  body.IndexOf("DUPLICATE", StringComparison.OrdinalIgnoreCase) >= 0 ||
					  body.IndexOf("COPY", StringComparison.OrdinalIgnoreCase) >= 0;
		Check(marked, "the printed receipt SAYS it is a reprint");

		Console.WriteLine();
		Console.WriteLine("---- what actually prints (last 18 non-blank lines) ----");
		string[] lines = body.Replace("\r", "").Split('\n');
		int shown = 0;
		for (int i = lines.Length - 1; i >= 0 && shown < 18; i--)
		{
			if (lines[i].Trim().Length == 0) continue;
			Console.WriteLine("   | " + lines[i].TrimEnd());
			shown++;
		}
		Console.WriteLine("--------------------------------------------------------");
		Console.WriteLine("pdf: " + pdf);

		Console.WriteLine();
		Console.WriteLine(failures == 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
		return failures == 0 ? 0 : 1;
	}

	private static int Counter(string receipt)
	{
		try
		{
			Type mg = asm.GetType("FumasV5.mglobal");
			string cs = (string)mg.GetField("mMySQLConnectionString", Any).GetValue(null);
			using (MySql.Data.MySqlClient.MySqlConnection c = new MySql.Data.MySqlClient.MySqlConnection(cs))
			{
				c.Open();
				MySql.Data.MySqlClient.MySqlCommand cmd = new MySql.Data.MySqlClient.MySqlCommand(
					"select coalesce(reprint,0) from pos_header where receiptno=?r", c);
				cmd.Parameters.AddWithValue("?r", receipt);
				object v = cmd.ExecuteScalar();
				return v == null || v == DBNull.Value ? -1 : Convert.ToInt32(v);
			}
		}
		catch (Exception ex) { Console.WriteLine("  (counter read failed: " + ex.Message + ")"); return -1; }
	}

	private static ReportDocument FromViewer()
	{
		try
		{
			Type myProject = asm.GetType("FumasV5.My.MyProject");
			object forms = myProject.GetProperty("Forms", Any).GetValue(null, null);
			object rep = forms.GetType().GetProperty("Report", Any).GetValue(forms, null);
			object viewer = Member(rep, "CrystalReportViewer1");
			return Member(viewer, "ReportSource") as ReportDocument;
		}
		catch (Exception ex) { Console.WriteLine("  (viewer unreachable: " + ex.Message + ")"); return null; }
	}

	// These are generated members and are not consistently a field or a
	// property across the vendor's forms, so ask for both.
	private static object Member(object o, string name)
	{
		if (o == null) return null;
		PropertyInfo p = o.GetType().GetProperty(name, Any);
		if (p != null) return p.GetValue(o, null);
		FieldInfo f = o.GetType().GetField(name, Any);
		return f == null ? null : f.GetValue(o);
	}

	// Formula text carries real line breaks; flattened so one formula stays
	// on one line of output.
	private static string Flatten(string s)
	{
		if (s == null) return "";
		return s.Replace("\r", " ").Replace("\n", " ");
	}

	private static void Check(bool ok, string what)
	{
		if (ok) Console.WriteLine("  ok   " + what);
		else { failures++; Console.WriteLine("  FAIL " + what); }
	}
}
