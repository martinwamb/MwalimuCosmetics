using System;
using System.Drawing;
using System.Reflection;
using System.Windows.Forms;

// Renders FDashboard to a PNG so the layout can actually be looked at.
//
// The leaderboard and the "Show more" button were both reported missing, and
// neither could be confirmed from the source alone: one was a missing call, the
// other a control positioned by an event that may or may not fire. A picture
// settles both. DrawToBitmap paints the real control tree after a real Load
// against the real test database, so what comes out is what a user would see.
//
// Compiled into a FumasV5 install folder so MySql.Data.dll resolves. STA,
// because this is Windows Forms.
internal static class DashboardHarness
{
	private const BindingFlags Any =
		BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

	[STAThread]
	private static int Main(string[] args)
	{
		string db   = args.Length > 0 ? args[0] : "mwalimuinvest_test";
		string user = args.Length > 1 ? args[1] : "martin";
		string outp = args.Length > 2 ? args[2] : "dashboard.png";

		if (!db.EndsWith("_test", StringComparison.OrdinalIgnoreCase))
		{
			Console.WriteLine("REFUSING: " + db + " is not a _test database.");
			return 2;
		}

		Assembly asm = Assembly.LoadFrom("FumasV5.exe");
		Type mglobal = asm.GetType("FumasV5.mglobal");

		string host = Environment.GetEnvironmentVariable("MWALIMU_DB_HOST") ?? "10.10.10.4";
		string pw   = Environment.GetEnvironmentVariable("MWALIMU_DB_PASSWORD") ?? "allowme";
		mglobal.GetField("mMySQLConnectionString", Any).SetValue(null,
			"Server=" + host + ";Database=" + db + ";User ID=root;port=3306;Password=" + pw +
			";charset=utf8; Convert Zero Datetime=True;Connect Timeout=15;");
		mglobal.GetField("usercode", Any).SetValue(null, user);
		mglobal.GetField("username", Any).SetValue(null, user);

		Application.EnableVisualStyles();

		Form dash = (Form)asm.CreateInstance("FumasV5.FDashboard");
		if (dash == null) { Console.WriteLine("FATAL: no FumasV5.FDashboard"); return 2; }

		// A real size, not the maximized-on-a-headless-desktop default, so the
		// picture matches what a till at 1366x768 would show.
		dash.WindowState = FormWindowState.Normal;
		dash.StartPosition = FormStartPosition.Manual;
		dash.Location = new Point(0, 0);
		dash.Size = new Size(1366, 768);
		dash.Show();

		// Load runs its queries synchronously; the pumps let docking settle.
		for (int i = 0; i < 12; i++) { Application.DoEvents(); System.Threading.Thread.Sleep(120); }

		// Captured off the screen, not via DrawToBitmap.
		//
		// DrawToBitmap asks each control to repaint into a buffer, and it does
		// not do so faithfully for every control: a docked Button inside a
		// docked Panel came out missing entirely while its own Bounds said it
		// was there and visible. CopyFromScreen photographs what Windows
		// actually put on the glass, which is the only thing worth asserting on.
		dash.Activate();
		Application.DoEvents();
		using (Bitmap bmp = new Bitmap(dash.Width, dash.Height))
		using (Graphics g = Graphics.FromImage(bmp))
		{
			g.CopyFromScreen(dash.Location, Point.Empty, dash.Size);
			bmp.Save(outp, System.Drawing.Imaging.ImageFormat.Png);
		}

		Console.WriteLine("user      : " + user);
		Console.WriteLine("rendered  : " + outp + "  (" + dash.Width + "x" + dash.Height + ")");
		Report(dash, "lblRights");
		Report(dash, "btnShowMore");
		Report(dash, "dayNav");
		Report(dash, "pnlLeaderboard");
		Report(dash, "lvLeaderboard");

		// Walk up from the button. If any ancestor is invisible or has no size,
		// that is why it does not appear, and DrawToBitmap being unfaithful is a
		// red herring. Also ask the parent what control actually occupies the
		// button's own centre point — the definitive "is it really there".
		Ancestry(dash, "btnShowMore");

		dash.Dispose();
		return 0;
	}

	private static void Ancestry(Form f, string field)
	{
		FieldInfo fi = f.GetType().GetField(field, Any);
		Control c = fi == null ? null : fi.GetValue(f) as Control;
		if (c == null) { Console.WriteLine("  ancestry: " + field + " MISSING"); return; }

		Console.WriteLine("  ancestry of " + field + ":");
		Control walk = c;
		int depth = 0;
		while (walk != null && depth < 10)
		{
			Console.WriteLine("    " + new string(' ', depth * 2) + walk.GetType().Name +
				"  visible=" + walk.Visible +
				"  bounds=" + walk.Bounds.X + "," + walk.Bounds.Y + " " +
				walk.Bounds.Width + "x" + walk.Bounds.Height +
				(walk.Parent == null ? "  (no parent)" : ""));
			walk = walk.Parent;
			depth++;
		}

		Control parent = c.Parent;
		if (parent != null)
		{
			Point mid = new Point(c.Left + c.Width / 2, c.Top + c.Height / 2);
			Control at = parent.GetChildAtPoint(mid);
			Console.WriteLine("    control occupying its centre: " +
				(at == null ? "NOTHING" : at.GetType().Name + " / " + at.Name) +
				(ReferenceEquals(at, c) ? "   <- it is the button" : "   <- NOT the button"));
			Console.WriteLine("    z-order index in parent: " + parent.Controls.GetChildIndex(c) +
				" of " + parent.Controls.Count);
		}
	}

	// Where a control actually ended up, in screen-relative terms, and how much
	// is in it. This is the part that catches "it exists but is at (0,0)".
	private static void Report(Form f, string field)
	{
		FieldInfo fi = f.GetType().GetField(field, Any);
		object o = fi == null ? null : fi.GetValue(f);
		Control c = o as Control;
		if (c == null) { Console.WriteLine("  " + field.PadRight(16) + "MISSING"); return; }

		Point p = c.Parent == null ? c.Location : c.Parent.PointToScreen(c.Location);
		Point origin = f.PointToScreen(Point.Empty);
		string extra = "";
		ListView lv = c as ListView;
		if (lv != null) extra = "  items=" + lv.Items.Count;
		Label lb = c as Label;
		if (lb != null) extra = "  text=\"" + lb.Text + "\"";

		Console.WriteLine("  " + field.PadRight(16) +
			"visible=" + c.Visible +
			"  at=(" + (p.X - origin.X) + "," + (p.Y - origin.Y) + ")" +
			"  size=" + c.Width + "x" + c.Height + extra);
	}
}
