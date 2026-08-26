using System;
using System.Collections.Generic;
using System.Drawing;
using System.Reflection;
using System.Windows.Forms;

// Proves the theme cannot destroy the colours this application uses to mean
// things.
//
// There are 610 runtime BackColor assignments across 217 vendor forms, 496 of
// them meaningful — FPOS turns orderno red once a sale is posted, grids turn
// cells green when a line is verified. A restyle that reached those would be
// worse than no restyle at all, because the screen would still look fine while
// telling the cashier the wrong thing.
//
// So this builds a form carrying one of every control the theme might touch,
// paints some of them the way the application does, applies the theme, and
// checks what moved.
internal static class ThemeHarness
{
	private const BindingFlags Any =
		BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

	private static int failures;

	[STAThread]
	private static int Main()
	{
		Assembly asm = Assembly.LoadFrom("FumasV5.exe");
		Type tTheme = asm.GetType("FumasV5.Theme");
		if (tTheme == null) { Console.WriteLine("FATAL: no FumasV5.Theme"); return 2; }
		MethodInfo apply = tTheme.GetMethod("Apply", Any);

		// The switch, including the per-PC override, which is three-state:
		// absent means follow the shop.
		Type tMg = asm.GetType("FumasV5.mglobal");
		string host = Environment.GetEnvironmentVariable("MWALIMU_DB_HOST") ?? "10.10.10.4";
		string pw = Environment.GetEnvironmentVariable("MWALIMU_DB_PASSWORD") ?? "allowme";
		tMg.GetField("mMySQLConnectionString", Any).SetValue(null,
			"Server=" + host + ";Database=mwalimuinvest_test;User ID=root;port=3306;Password=" + pw +
			";charset=utf8; Convert Zero Datetime=True;Connect Timeout=15;");
		tMg.GetField("usercode", Any).SetValue(null, "HARNESS");

		Type tSet = asm.GetType("FumasV5.MwSettings");
		MethodInfo setKey = tSet.GetMethod("Set", Any);
		MethodInfo removeKey = tSet.GetMethod("Remove", Any);
		MethodInfo invalidate = tSet.GetMethod("Invalidate", Any);
		PropertyInfo enabled = tTheme.GetProperty("Enabled", Any);
		string pcKey = "theme.enabled." + Environment.MachineName;

		Console.WriteLine("-- the switch --");
		removeKey.Invoke(null, new object[] { pcKey });
		invalidate.Invoke(null, null);
		Check((bool)enabled.GetValue(null, null), "with no override, follows the shop (on)", "false");

		setKey.Invoke(null, new object[] { pcKey, "0", "HARNESS" });
		invalidate.Invoke(null, null);
		Check(!(bool)enabled.GetValue(null, null), "this PC can be put back to the old look", "still on");

		setKey.Invoke(null, new object[] { pcKey, "1", "HARNESS" });
		invalidate.Invoke(null, null);
		Check((bool)enabled.GetValue(null, null), "and switched on again for this PC", "still off");

		removeKey.Invoke(null, new object[] { pcKey });
		invalidate.Invoke(null, null);
		Check((bool)enabled.GetValue(null, null), "removing the override returns it to the shop setting", "wrong");
		Console.WriteLine();

		Form f = new Form();
		f.Size = new Size(900, 600);

		// The application's own idiom: a locked field is red and disabled.
		TextBox locked = new TextBox { Name = "orderno", Text = "SI0012345" };
		locked.BackColor = Color.Red;
		locked.Enabled = false;

		TextBox plain = new TextBox { Name = "descr", Text = "ordinary field" };
		Color plainBefore = plain.BackColor;

		ComboBox combo = new ComboBox { Name = "paymode" };
		combo.BackColor = Color.Yellow;      // "needs attention" in several screens

		DataGridView grid = new DataGridView { Name = "gpayint", Size = new Size(400, 200) };
		grid.Columns.Add("a", "Code");
		grid.Rows.Add();
		grid.Rows[0].Cells[0].Style.BackColor = Color.Green;   // verified line

		Button ordinary = new Button { Name = "bsave", Text = "Save" };
		Button deliberate = new Button { Name = "bdelete", Text = "Delete" };
		deliberate.BackColor = Color.Firebrick;

		ListView list = new ListView { Name = "lv", View = View.Details };
		list.Columns.Add("Item");

		f.Controls.Add(locked);
		f.Controls.Add(plain);
		f.Controls.Add(combo);
		f.Controls.Add(grid);
		f.Controls.Add(ordinary);
		f.Controls.Add(deliberate);
		f.Controls.Add(list);

		Color deliberateBefore = deliberate.BackColor;

		apply.Invoke(null, new object[] { f });

		Console.WriteLine("-- colours that must not move --");
		Check(locked.BackColor == Color.Red,
			"a red locked field stays red", locked.BackColor.ToString());
		Check(combo.BackColor == Color.Yellow,
			"a yellow combo stays yellow", combo.BackColor.ToString());
		Check(grid.Rows[0].Cells[0].Style.BackColor == Color.Green,
			"a green verified cell stays green", grid.Rows[0].Cells[0].Style.BackColor.ToString());
		Check(plain.BackColor == plainBefore,
			"an ordinary text box is left alone", plain.BackColor.ToString());
		Check(deliberate.BackColor == deliberateBefore,
			"a deliberately coloured button keeps its colour", deliberate.BackColor.ToString());

		Console.WriteLine();
		Console.WriteLine("-- what the theme should have changed --");
		Check(ordinary.FlatStyle == FlatStyle.Flat,
			"an ordinary button became flat", ordinary.FlatStyle.ToString());
		Check(ordinary.BackColor != SystemColors.Control,
			"an ordinary button was recoloured", ordinary.BackColor.ToString());
		Check(deliberate.FlatStyle == FlatStyle.Flat,
			"a coloured button still became flat", deliberate.FlatStyle.ToString());
		Check(grid.BorderStyle == BorderStyle.None,
			"the grid lost its 3D border", grid.BorderStyle.ToString());
		Check(!grid.EnableHeadersVisualStyles,
			"the grid header is ours to paint", grid.EnableHeadersVisualStyles.ToString());
		Check(grid.DefaultCellStyle.BackColor == Color.Empty ||
			  grid.DefaultCellStyle.BackColor == SystemColors.Window,
			"the grid's default CELL colour was NOT set", grid.DefaultCellStyle.BackColor.ToString());
		Check(list.BorderStyle == BorderStyle.None,
			"the list lost its 3D border", list.BorderStyle.ToString());
		Check(f.Font.Name == "Segoe UI",
			"the form font is Segoe UI", f.Font.Name);

		f.Dispose();
		Console.WriteLine();
		Console.WriteLine(failures == 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
		return failures == 0 ? 0 : 1;
	}

	private static void Check(bool ok, string what, string actual)
	{
		if (ok) Console.WriteLine("  ok   " + what);
		else { failures++; Console.WriteLine("  FAIL " + what + "   -- got " + actual); }
	}
}
