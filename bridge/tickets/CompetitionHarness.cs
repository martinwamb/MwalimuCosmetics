using System;
using System.Collections;
using System.Reflection;
using MySql.Data.MySqlClient;

// Exercises FocusProduct against mwalimuinvest_test: the weekday pattern, the
// automatic pick, the manual override, and the standing.
//
// Compiled into a FumasV5 install folder so MySql.Data.dll resolves. Points are
// counted from real sale lines, so whatever this prints is what the dashboard
// would print given the same database.
internal static class CompetitionHarness
{
	private const BindingFlags Any =
		BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

	private static Assembly asm;
	private static Type tFocus;
	private static int failures;

	private static int Main(string[] args)
	{
		string db = args.Length > 0 ? args[0] : "mwalimuinvest_test";
		if (!db.EndsWith("_test", StringComparison.OrdinalIgnoreCase))
		{
			Console.WriteLine("REFUSING: " + db + " is not a _test database.");
			return 2;
		}

		asm = Assembly.LoadFrom("FumasV5.exe");
		Type mglobal = asm.GetType("FumasV5.mglobal");
		tFocus = asm.GetType("FumasV5.FocusProduct");

		string host = Environment.GetEnvironmentVariable("MWALIMU_DB_HOST") ?? "10.10.10.4";
		string pw = Environment.GetEnvironmentVariable("MWALIMU_DB_PASSWORD") ?? "allowme";
		mglobal.GetField("mMySQLConnectionString", Any).SetValue(null,
			"Server=" + host + ";Database=" + db + ";User ID=root;port=3306;Password=" + pw +
			";charset=utf8; Convert Zero Datetime=True;Connect Timeout=15;");
		mglobal.GetField("usercode", Any).SetValue(null, "martin");
		mglobal.GetField("username", Any).SetValue(null, "martin");

		Console.WriteLine("Database: " + db);
		Console.WriteLine();

		WeekdayPattern();
		PickAndBoard();

		Console.WriteLine();
		Console.WriteLine(failures == 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
		return failures == 0 ? 0 : 1;
	}

	// Three days fast, three days slow, and Sunday never asked because the shop
	// does not trade.
	private static void WeekdayPattern()
	{
		Console.WriteLine("-- weekday pattern --");
		MethodInfo mode = tFocus.GetMethod("ModeFor", Any);
		int fast = 0, slow = 0;
		DateTime d = new DateTime(2026, 8, 24);   // a Monday
		for (int i = 0; i < 6; i++)
		{
			string m = (string)mode.Invoke(null, new object[] { d });
			Console.WriteLine("  " + d.ToString("ddd") + "  " + m);
			if (m == "FAST") fast++; else slow++;
			d = d.AddDays(1.0);
		}
		Report(fast == 3 && slow == 3, "  three fast days and three slow, Monday to Saturday",
			"got " + fast + " fast, " + slow + " slow");
		Console.WriteLine();
	}

	private static void PickAndBoard()
	{
		Console.WriteLine("-- choosing and scoring --");
		Type mglobal = asm.GetType("FumasV5.mglobal");
		string cs = (string)mglobal.GetField("mMySQLConnectionString", Any).GetValue(null);

		// MySqlConnection lives in MySql.Data.dll, not in FumasV5.exe, so it is
		// referenced directly rather than looked up in the loaded assembly.
		MySqlConnection conn = new MySqlConnection(cs);
		conn.Open();
		try
		{
			DateTime today = DateTime.Today;

			object focus = tFocus.GetMethod("For", Any).Invoke(null, new object[] { conn, today });
			if (focus == null)
			{
				// Thin test data can legitimately offer no candidate: nothing in
				// stock has sold inside the window. That is a real outcome, not
				// a failure, so it is reported rather than asserted away.
				Console.WriteLine("  no candidate in this database — nothing in stock has sold in the window");
				Console.WriteLine("  (expected on a test database holding only a handful of receipts)");
				return;
			}

			string code = (string)Field(focus, "Code");
			string name = (string)Prop(focus, "Name");
			string source = (string)Field(focus, "Source");
			Console.WriteLine("  chosen : " + code + "  " + name + "   (" + source + ")");
			Report(code.Length > 0, "  a product was chosen", "code was blank");

			// Asking twice must not choose twice.
			object again = tFocus.GetMethod("For", Any).Invoke(null, new object[] { conn, today });
			Report((string)Field(again, "Code") == code,
				"  asking again returns the same product", "it changed");

			IList board = (IList)tFocus.GetMethod("Board", Any)
				.Invoke(null, new object[] { conn, today, code });
			Console.WriteLine("  standing: " + board.Count + " salesperson(s)");
			for (int i = 0; i < board.Count; i++)
			{
				object r = board[i];
				Console.WriteLine("    " + (i + 1) + ". " + Field(r, "Who") +
					"   " + Field(r, "Points") + " points   " + Field(r, "Receipts") + " receipts");
			}

			// A manual choice must overrule the automatic one.
			tFocus.GetMethod("SetManual", Any)
				.Invoke(null, new object[] { conn, today, "TEST-MANUAL", "A product chosen by hand", "harness" });
			object manual = tFocus.GetMethod("Read", Any).Invoke(null, new object[] { conn, today });
			Report((string)Field(manual, "Code") == "TEST-MANUAL" && (string)Field(manual, "Source") == "MANUAL",
				"  a manual choice overrules the automatic one",
				"got " + Field(manual, "Code") + " / " + Field(manual, "Source"));

			// Put it back so the test database is not left holding a fake code.
			tFocus.GetMethod("SetManual", Any)
				.Invoke(null, new object[] { conn, today, code, name, "harness-restore" });
			Console.WriteLine("  restored to " + code);
		}
		finally
		{
			conn.Close();
		}
	}

	private static object Field(object o, string name)
	{
		FieldInfo f = o.GetType().GetField(name, Any);
		return f == null ? null : f.GetValue(o);
	}

	private static object Prop(object o, string name)
	{
		PropertyInfo p = o.GetType().GetProperty(name, Any);
		return p == null ? null : p.GetValue(o, null);
	}

	private static void Report(bool ok, string what, string ifNot)
	{
		if (ok) Console.WriteLine("  ok " + what);
		else { failures++; Console.WriteLine("  FAIL" + what + "  -- " + ifNot); }
	}
}
