using System;
using System.Reflection;
using System.Windows.Forms;

// Checks the predicate that decides whether an open POS window can be reused.
//
// The whole POS freeze came down to this one question being asked the wrong way:
// the old test looked at the order number, which after a paid sale holds a real
// receipt number, so a finished window was never recognised as spare and a fresh
// FPOS was constructed instead. Constructing FPOS is the multi-second freeze.
//
// FPOS is only constructed here, never shown: its Load handler sets MdiParent to
// MyProject.Forms.Fmain, which would drag in the login form. The constructor
// alone is enough to give the grid its template row, which is what the predicate
// reads.
internal static class PosReuseHarness
{
	private const BindingFlags Any =
		BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

	private static int failures;

	[STAThread]
	private static int Main()
	{
		Assembly asm = Assembly.LoadFrom("FumasV5.exe");
		Type tFmain = asm.GetType("FumasV5.Fmain");
		Type tFpos = asm.GetType("FumasV5.FPOS");

		MethodInfo hasLines = tFmain.GetMethod("sale_has_lines", Any);
		if (hasLines == null)
		{
			Console.WriteLine("FAIL: Fmain.sale_has_lines not found");
			return 1;
		}
		Console.WriteLine("found Fmain.sale_has_lines(FPOS)");

		Form pos = (Form)Activator.CreateInstance(tFpos);
		object grid = tFpos.GetProperty("dggrante", Any).GetValue(pos, null);
		DataGridView dg = grid as DataGridView;
		Console.WriteLine("a freshly constructed FPOS has dggrante.RowCount = " +
			(dg == null ? "(null grid)" : dg.RowCount.ToString()));

		bool empty = (bool)hasLines.Invoke(null, new object[] { pos });
		Check(!empty, "an empty till window is offered for reuse");

		// Ring something up: one real row beside the template row.
		if (dg != null)
		{
			dg.Rows.Add();
			Console.WriteLine("after adding one line, RowCount = " + dg.RowCount);
			bool busy = (bool)hasLines.Invoke(null, new object[] { pos });
			Check(busy, "a window with a line in it is NOT reused");

			dg.Rows.Clear();
			bool clearedAgain = (bool)hasLines.Invoke(null, new object[] { pos });
			Check(!clearedAgain, "clearing the lines makes it reusable again");
		}

		pos.Dispose();
		Console.WriteLine();
		Console.WriteLine(failures == 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
		return failures == 0 ? 0 : 1;
	}

	private static void Check(bool ok, string what)
	{
		if (ok) Console.WriteLine("  ok   " + what);
		else { failures++; Console.WriteLine("  FAIL " + what); }
	}
}
