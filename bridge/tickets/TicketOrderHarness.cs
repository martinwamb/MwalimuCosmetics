using System;
using System.Reflection;
using MySql.Data.MySqlClient;

// Proves the ticket number exists BEFORE the receipt is printed.
//
// The number was only ever appearing on reprints, and the cause was ordering,
// not layout: FChangePaymentOptM printed the receipt and then minted the ticket.
// Modreports.StampTicket peeks for a ticket and never issues one — deliberately,
// so that reprinting a receipt cannot mint a second number for one sale — so on
// an original print there was nothing to peek at and the box came out blank.
//
// StampTicket itself is untouched and demonstrably works: it is what puts the
// number on every reprint the shop takes. What is worth testing is the thing
// that changed — that by the time the receipt is drawn, Peek has something to
// find, and that the cashier's "no slip" tick still means no ticket.
//
// Compile into FumasV5/bin/Release so MySql.Data.dll resolves:
//   csc.exe -nologo -target:exe -out:TicketOrderHarness.exe -r:System.dll
//           -r:MySql.Data.dll -r:FumasV5.exe TicketOrderHarness.cs
internal static class TicketOrderHarness
{
	private const BindingFlags Any =
		BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

	private const string RCT = "ZZTKT0001";

	private static Type tMglobal, tSlip, tSettings;
	private static string conn;
	private static int failures;

	private static int Main(string[] args)
	{
		string db = args.Length > 0 ? args[0] : "mwalimuinvest_test";
		if (db == "mwalimuinvest")
		{
			Console.WriteLine("REFUSED: this harness issues tickets. Not against the live database.");
			return 2;
		}

		Assembly asm = Assembly.LoadFrom("FumasV5.exe");
		tMglobal = asm.GetType("FumasV5.mglobal");
		tSlip = asm.GetType("FumasV5.TicketSlip");
		tSettings = asm.GetType("FumasV5.MwSettings");

		conn = "Server=10.10.10.4;Database=" + db + ";User ID=root;port=3306;Password=allowme;" +
			"charset=utf8; Convert Zero Datetime=True;Connect Timeout=120000;";
		tMglobal.GetField("mMySQLConnectionString", Any).SetValue(null, conn);
		tMglobal.GetField("usercode", Any).SetValue(null, "HARNESS");
		tMglobal.GetField("username", Any).SetValue(null, "HARNESS");

		Console.WriteLine("Database: " + db);
		Console.WriteLine();

		try
		{
			Setting("ticket.enabled", "1");
			Setting("ticket.allow_skip", "0");
			Seed();

			Console.WriteLine("-- the ordering fix --");
			Report(Peek(RCT) == null, "a fresh sale has no ticket yet");

			Invoke("IssueBeforeReceipt", RCT);
			object t = Peek(RCT);
			Report(t != null, "IssueBeforeReceipt mints one, so StampTicket has something to stamp");
			string first = Code(t);
			Console.WriteLine("       ticket code: " + first);
			Report(first.Length > 0, "  and it has a code the receipt can carry");

			// This is what IssueAndPrint does a few lines later. It must find the
			// same ticket, not mint a second one for the same sale.
			object again = Invoke("Issue", RCT);
			Report(Code(again) == first, "the Issue that follows returns the SAME ticket, not a second");
			Report(Count(RCT) == 1, "  and there is still exactly one ticket row for the sale");

			Console.WriteLine();
			Console.WriteLine("-- the cashier's no-slip tick --");
			Cleanup();
			Seed();
			Setting("ticket.allow_skip", "1");
			tSlip.GetField("SkipNextSlip", Any).SetValue(null, true);
			Invoke("IssueBeforeReceipt", RCT);
			Report(Peek(RCT) == null, "with the skip ticked, no ticket is minted");
			Report((bool)tSlip.GetField("SkipNextSlip", Any).GetValue(null),
				"  and the tick is left set for IssueAndPrint to clear");
			tSlip.GetField("SkipNextSlip", Any).SetValue(null, false);

			Console.WriteLine();
			Console.WriteLine("-- tickets switched off for the shop --");
			Cleanup();
			Seed();
			Setting("ticket.enabled", "0");
			Invoke("IssueBeforeReceipt", RCT);
			Report(Peek(RCT) == null, "no ticket, and nothing thrown at the till");
			Setting("ticket.enabled", "1");
		}
		finally
		{
			Setting("ticket.allow_skip", "0");
			Setting("ticket.enabled", "1");
			Cleanup();
		}

		Console.WriteLine();
		Console.WriteLine(failures == 0 ? "ALL PASSED" : failures + " FAILED");
		return failures == 0 ? 0 : 1;
	}

	private static object Invoke(string name, string arg)
	{
		return tSlip.GetMethod(name, Any).Invoke(null, new object[] { arg });
	}

	private static object Peek(string no)
	{
		return tSlip.GetMethod("Peek", Any).Invoke(null, new object[] { no });
	}

	private static string Code(object ticket)
	{
		if (ticket == null) return "";
		object v = ticket.GetType().GetField("Code", Any).GetValue(ticket);
		return v == null ? "" : Convert.ToString(v);
	}

	private static int Count(string no)
	{
		return Convert.ToInt32(Scalar("select count(*) from tickets where receiptno = '" + no + "'"));
	}

	private static void Seed()
	{
		Exec("insert into pos_header (receiptno, staff, pos, arcode, arname, posted, is_return, " +
			"amount, trandate, posdate, location) values ('" + RCT + "','HARNESS','TILL1'," +
			"'0700000001','HARNESS CUSTOMER',1,0,100,now(),curdate(),'SHOP')");
	}

	private static void Cleanup()
	{
		Exec("delete from tickets where receiptno = '" + RCT + "'");
		Exec("delete from pos_header where receiptno = '" + RCT + "'");
	}

	private static void Setting(string key, string value)
	{
		Exec("delete from mw_settings where skey = '" + key + "'");
		Exec("insert into mw_settings (skey, svalue, staff, updated) values ('" +
			key + "','" + value + "','HARNESS',now())");
		tSettings.GetMethod("Invalidate", Any).Invoke(null, null);
	}

	private static void Exec(string sql)
	{
		using (MySqlConnection c = new MySqlConnection(conn)) { c.Open(); new MySqlCommand(sql, c).ExecuteNonQuery(); }
	}

	private static object Scalar(string sql)
	{
		using (MySqlConnection c = new MySqlConnection(conn)) { c.Open(); return new MySqlCommand(sql, c).ExecuteScalar(); }
	}

	private static void Report(bool ok, string what)
	{
		if (ok) { Console.WriteLine("  ok   " + what); return; }
		failures++;
		Console.WriteLine("  FAIL " + what);
	}
}
