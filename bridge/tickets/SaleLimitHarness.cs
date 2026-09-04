using System;
using System.Reflection;
using MySql.Data.MySqlClient;

// Exercises the sale limits against a real database.
//
// mglobal is internal and its limit checks are normally reached only by ringing
// something up on a till, so this reaches in by reflection — the same way the
// other harnesses in this folder do. Compile it into FumasV5/bin/Release so that
// MySql.Data.dll resolves:
//
//   csc.exe -nologo -target:exe -out:SaleLimitHarness.exe -r:System.dll
//           -r:MySql.Data.dll -r:FumasV5.exe SaleLimitHarness.cs
//
// Git Bash mangles /nologo and /r: into paths — use the - forms.
//
// It seeds its own products, receipts and limits under codes beginning ZZTEST,
// and clears them out at the end, so it is safe to run repeatedly against
// mwalimuinvest_test. It must never be pointed at mwalimuinvest.
internal static class SaleLimitHarness
{
	private const BindingFlags Any =
		BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

	private const string CODE = "ZZTESTLIMIT";
	private const string SELLER = "ZZTESTER";
	private const string OTHER = "ZZTESTER2";

	private static Assembly asm;
	private static Type tMglobal, tSettings;
	private static string conn;
	private static int failures;
	private static DateTime day;

	private static int Main(string[] args)
	{
		string db = args.Length > 0 ? args[0] : "mwalimuinvest_test";
		if (db == "mwalimuinvest")
		{
			Console.WriteLine("REFUSED: this harness writes receipts. Not against the live database.");
			return 2;
		}

		asm = Assembly.LoadFrom("FumasV5.exe");
		tMglobal = asm.GetType("FumasV5.mglobal");
		tSettings = asm.GetType("FumasV5.MwSettings");
		if (tMglobal == null || tSettings == null)
		{
			Console.WriteLine("FATAL: FumasV5.mglobal or FumasV5.MwSettings not found");
			return 2;
		}

		conn = "Server=10.10.10.4;Database=" + db + ";User ID=root;port=3306;Password=allowme;" +
			"charset=utf8; Convert Zero Datetime=True;Connect Timeout=120000;";
		SetStatic("mMySQLConnectionString", conn);
		SetStatic("usercode", "HARNESS");
		SetStatic("username", SELLER);

		// The trading day comes from the server, whose clock runs ahead of this
		// machine. Seeding against one day and asking about another would make
		// every count come back zero.
		day = Convert.ToDateTime(Scalar("select curdate()"));
		Console.WriteLine("Database  : " + db);
		Console.WriteLine("Trading day: " + day.ToString("yyyy-MM-dd"));
		Console.WriteLine();

		try
		{
			Seed();
			CustomerCap();
			SellerCap();
			AcrossTillsAndReceipts();
			ReturnsDoNotCreditBack();
			CartonsCountAsPieces();
			PinnedAndSwitchedOff();
			BasketAtPayment();
			FailsOpen();
		}
		finally
		{
			Cleanup();
		}

		Console.WriteLine();
		Console.WriteLine(failures == 0 ? "ALL PASSED" : failures + " FAILED");
		return failures == 0 ? 0 : 1;
	}

	// ── The cases ──────────────────────────────────────────────────

	private static void CustomerCap()
	{
		Console.WriteLine("-- the customer cap still works --");
		Reset();
		Report(Line(5, "PIECE", "0700000001", "ALICE") == "", "5 pieces to a new customer goes through");

		Sold("R1", SELLER, "TILL1", "0700000001", "ALICE", 12, "PIECE", false);
		string m = Line(1, "PIECE", "0700000001", "ALICE");
		Report(m.Contains("per customer per day"), "a 13th piece for the same customer is refused");
		Report(!m.Contains("One seller may sell"), "  and it is the customer message, not the seller one");

		Report(Line(1, "PIECE", "0700000002", "BETTY") == "",
			"the same seller may serve the next customer");
	}

	private static void SellerCap()
	{
		Console.WriteLine("-- the seller cap --");
		Reset();
		// Three customers, twelve each: the customer cap is satisfied every time
		// and the seller has now moved their 36 for the day. This is the shape of
		// the thing it was built for.
		Sold("R1", SELLER, "TILL1", "0700000001", "ALICE", 12, "PIECE", false);
		Sold("R2", SELLER, "TILL1", "0700000002", "BETTY", 12, "PIECE", false);
		Sold("R3", SELLER, "TILL1", "0700000003", "CLARA", 12, "PIECE", false);

		string m = Line(1, "PIECE", "0700000004", "DIANA");
		Report(m.Contains("One seller may sell"), "a fourth customer is refused on the seller cap");
		Report(m.Contains("36"), "  and the message names the cap: 36");
		Report(!m.ToLower().Contains("customer"), "  and says NOTHING about the customer");

		// The other half of the point: a colleague is not blocked by it.
		SetStatic("username", OTHER);
		Report(Line(1, "PIECE", "0700000004", "DIANA") == "",
			"a different seller is not blocked by the first one's day");
		SetStatic("username", SELLER);
	}

	private static void AcrossTillsAndReceipts()
	{
		Console.WriteLine("-- counted across receipts and tills --");
		Reset();
		Sold("R1", SELLER, "TILL1", "0700000001", "ALICE", 12, "PIECE", false);
		Sold("R2", SELLER, "TILL2", "0700000002", "BETTY", 12, "PIECE", false);
		Sold("R3", SELLER, "TILL3", "0700000003", "CLARA", 12, "PIECE", false);
		Report(Line(1, "PIECE", "0700000004", "DIANA").Contains("One seller may sell"),
			"three tills, three receipts, one seller: still 36");

		// The shop has receipts under both CHELOP and chelop. They are one person.
		SetStatic("username", SELLER.ToLower());
		Report(Line(1, "PIECE", "0700000004", "DIANA").Contains("One seller may sell"),
			"the same name in a different case is the same seller");
		SetStatic("username", SELLER);
	}

	private static void ReturnsDoNotCreditBack()
	{
		Console.WriteLine("-- returns --");
		Reset();
		Sold("R1", SELLER, "TILL1", "0700000001", "ALICE", 12, "PIECE", false);
		Sold("R2", SELLER, "TILL1", "0700000002", "BETTY", 12, "PIECE", false);
		Sold("R3", SELLER, "TILL1", "0700000003", "CLARA", 12, "PIECE", false);
		Sold("R4", SELLER, "TILL1", "0700000003", "CLARA", 12, "PIECE", true);
		Report(Line(1, "PIECE", "0700000004", "DIANA").Contains("One seller may sell"),
			"selling 36 and refunding 12 does not buy back 12 of the cap");
	}

	private static void CartonsCountAsPieces()
	{
		Console.WriteLine("-- packing units --");
		Reset();
		Sold("R1", SELLER, "TILL1", "0700000001", "ALICE", 3, "ZZCTN", false);   // 36 pieces
		Report(Line(1, "PIECE", "0700000002", "BETTY").Contains("One seller may sell"),
			"three cartons of twelve is 36 pieces, not 3");
	}

	private static void PinnedAndSwitchedOff()
	{
		Console.WriteLine("-- the shop multiple, and a product with its own figure --");
		Reset();
		Sold("R1", SELLER, "TILL1", "0700000001", "ALICE", 12, "PIECE", false);
		Sold("R2", SELLER, "TILL1", "0700000002", "BETTY", 12, "PIECE", false);

		// 24 sold. A pinned 20 is already past; the shop's 36 is not.
		Report(Line(1, "PIECE", "0700000003", "CLARA") == "", "24 of 36 leaves room");

		Exec("update sale_limits set seller_qty = 20 where code = '" + CODE + "'");
		Report(Line(1, "PIECE", "0700000003", "CLARA").Contains("One seller may sell"),
			"a product's own figure of 20 wins over the shop's 36");
		Report(Line(1, "PIECE", "0700000003", "CLARA").Contains("20"), "  and the message says 20");
		Exec("update sale_limits set seller_qty = null where code = '" + CODE + "'");

		Setting("0");
		Report(Line(1, "PIECE", "0700000003", "CLARA") == "",
			"a shop multiple of 0 switches the seller cap off");
		Report(Line(1, "PIECE", "0700000001", "ALICE").Contains("per customer per day"),
			"  and the customer cap is untouched by that");
		Setting("3");
	}

	private static void BasketAtPayment()
	{
		Console.WriteLine("-- the whole basket, at payment --");
		Reset();
		Sold("R1", SELLER, "TILL1", "0700000001", "ALICE", 12, "PIECE", false);
		Sold("R2", SELLER, "TILL1", "0700000002", "BETTY", 12, "PIECE", false);
		// An unposted basket is the sale being built. 14 of them is over the
		// customer's 12 on its own, and takes the seller to 38 of their 36 — both
		// caps at once, which is what the two separate headings are for.
		Sold("BASKET", SELLER, "TILL1", "0700000003", "CLARA", 14, "PIECE", false, false);

		bool sellerCap;
		string m = Basket("BASKET", "0700000003", "CLARA", out sellerCap);
		Report(m.Contains("More than this customer may take today"), "the customer heading is there");
		Report(m.Contains("More than one seller may sell in a day"), "the seller heading is there too");
		Report(sellerCap, "  and the caller is told a seller cap was among them");

		// A basket inside the customer's 12 but past the seller's 36. This is the
		// case the whole feature exists for: nothing about this sale looks wrong.
		Reset();
		Sold("R1", SELLER, "TILL1", "0700000001", "ALICE", 12, "PIECE", false);
		Sold("R2", SELLER, "TILL1", "0700000002", "BETTY", 12, "PIECE", false);
		Sold("R3", SELLER, "TILL1", "0700000003", "CLARA", 6, "PIECE", false);
		Sold("BASKET", SELLER, "TILL1", "0700000009", "ZOE", 12, "PIECE", false, false);

		m = Basket("BASKET", "0700000009", "ZOE", out sellerCap);
		Report(!m.Contains("More than this customer"), "a first-time customer raises no customer heading");
		Report(m.Contains("More than one seller"), "  but the seller's own day still bites");
		Report(sellerCap, "  and is reported as a seller cap");
	}

	private static void FailsOpen()
	{
		Console.WriteLine("-- a database without the table --");
		Reset();
		Sold("R1", SELLER, "TILL1", "0700000001", "ALICE", 12, "PIECE", false);
		Exec("rename table sale_limits to sale_limits_hidden");
		try
		{
			bool sellerCap;
			Report(Line(1, "PIECE", "0700000001", "ALICE") == "", "with no sale_limits table the till still sells");
			Report(Basket("R1", "0700000001", "ALICE", out sellerCap) == "", "  and payment still goes through");
		}
		finally
		{
			Exec("rename table sale_limits_hidden to sale_limits");
		}
	}

	// ── Calling the things under test ──────────────────────────────

	private static string Line(double qty, string punit, string arcode, string arname)
	{
		MethodInfo mi = tMglobal.GetMethod("check_sale_limit", Any);
		object[] a = new object[] {
			CODE, "TEST LIMITED ITEM", qty, punit, "BASKET",
			arcode, arname, GetStatic("username"), day, false };
		return (string)mi.Invoke(null, a);
	}

	private static string Basket(string orderno, string arcode, string arname, out bool sellerCap)
	{
		MethodInfo mi = tMglobal.GetMethod("check_sale_limits_pos", Any);
		object[] a = new object[] { orderno, arcode, arname, GetStatic("username"), day, false };
		string r = (string)mi.Invoke(null, a);
		sellerCap = (bool)a[5];
		return r;
	}

	// ── Seeding ────────────────────────────────────────────────────

	private static void Seed()
	{
		Cleanup();
		Exec("insert into pu (code, descr, factor) values ('PIECE','piece',1)");
		Exec("insert into pu (code, descr, factor) values ('ZZCTN','test carton',12)");
		Exec("insert into sale_limits (code, descr, limit_qty, seller_qty, active, staff, updated) " +
			"values ('" + CODE + "','TEST LIMITED ITEM',12,null,1,'HARNESS',now())");
		Setting("3");
		Console.WriteLine("seeded: limit 12 per customer, shop multiple 3, so 36 per seller");
		Console.WriteLine();
	}

	// The basket the line-level check counts against is left empty between cases;
	// only the posted history changes. Anything else and one case would be
	// reading the leftovers of the last.
	private static void Reset()
	{
		Exec("delete from pos_details where code = '" + CODE + "'");
		Exec("delete from pos_header where staff in ('" + SELLER + "','" + OTHER + "')");
		Exec("update sale_limits set seller_qty = null where code = '" + CODE + "'");
		Setting("3");
	}

	private static void Sold(string no, string staff, string till, string arcode, string arname,
		double qty, string punit, bool isReturn)
	{
		Sold(no, staff, till, arcode, arname, qty, punit, isReturn, true);
	}

	private static void Sold(string no, string staff, string till, string arcode, string arname,
		double qty, string punit, bool isReturn, bool posted)
	{
		Exec("insert into pos_header (receiptno, staff, pos, arcode, arname, posted, is_return, " +
			"trandate, posdate, location) values ('" + no + "','" + staff + "','" + till + "','" +
			arcode + "','" + arname + "'," + (posted ? 1 : 0) + "," + (isReturn ? 1 : 0) + "," +
			"'" + day.ToString("yyyy-MM-dd") + " 10:00:00','" + day.ToString("yyyy-MM-dd") + "','SHOP')");
		Exec("insert into pos_details (receiptno, code, description, qty, nunit, type, transign) " +
			"values ('" + no + "','" + CODE + "','TEST LIMITED ITEM'," + qty + ",'" + punit +
			"','Stocks','+')");
	}

	private static void Cleanup()
	{
		Exec("delete from pos_details where code = '" + CODE + "'");
		Exec("delete from pos_header where staff in ('" + SELLER + "','" + OTHER + "')");
		Exec("delete from sale_limits where code = '" + CODE + "'");
		Exec("delete from pu where code in ('PIECE','ZZCTN')");
	}

	// ── Plumbing ───────────────────────────────────────────────────

	private static void Setting(string value)
	{
		Exec("delete from mw_settings where skey = 'salelimit.seller.multiple'");
		Exec("insert into mw_settings (skey, svalue, staff, updated) " +
			"values ('salelimit.seller.multiple','" + value + "','HARNESS',now())");
		// The settings map is held for a minute, which is a lifetime in a test.
		tSettings.GetMethod("Invalidate", Any).Invoke(null, null);
	}

	private static void Exec(string sql)
	{
		using (MySqlConnection c = new MySqlConnection(conn))
		{
			c.Open();
			new MySqlCommand(sql, c).ExecuteNonQuery();
		}
	}

	private static object Scalar(string sql)
	{
		using (MySqlConnection c = new MySqlConnection(conn))
		{
			c.Open();
			return new MySqlCommand(sql, c).ExecuteScalar();
		}
	}

	private static void SetStatic(string name, object value)
	{
		FieldInfo f = tMglobal.GetField(name, Any);
		if (f == null) throw new Exception("no such mglobal field: " + name);
		f.SetValue(null, value);
	}

	private static object GetStatic(string name)
	{
		return tMglobal.GetField(name, Any).GetValue(null);
	}

	private static void Report(bool ok, string what)
	{
		if (ok) { Console.WriteLine("  ok   " + what); return; }
		failures++;
		Console.WriteLine("  FAIL " + what);
	}
}
