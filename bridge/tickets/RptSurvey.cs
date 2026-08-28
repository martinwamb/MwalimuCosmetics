// What is actually ON a Crystal receipt layout.
//
// ── Why this exists ───────────────────────────────────────────────────
//
// The ticket number has to appear on the customer's real receipt, not only on
// the slip beside it. The receipt is a binary .rpt — a ZIP-compressed Crystal
// layout nobody here can open, since the shop has no Crystal designer and the
// vendor is not in the picture.
//
// The way through is to write the number into a pos_header column the layout
// ALREADY prints, so no editing is needed. But "already prints" is two
// separate questions, and only asking both gives a usable answer:
//
//   1. Is the column in the report's dataset?  — necessary, not sufficient.
//   2. Is a field object bound to it actually PLACED in a section?
//
// A column can be bound and never drawn, in which case writing to it produces
// a receipt that looks exactly the same and a morning wasted wondering why.
// This lists both, side by side, so the difference is visible.
//
// Loading a report and reading its definition needs no database, which is why
// this can run with the shop LAN unplugged.
//
// Build INTO a folder holding the Crystal assemblies:
//
//   csc.exe -nologo -target:exe -out:RptSurvey.exe -r:System.dll
//           -r:CrystalDecisions.CrystalReports.Engine.dll
//           -r:CrystalDecisions.Shared.dll RptSurvey.cs
//
//   RptSurvey.exe <path-to.rpt> [more.rpt ...]

using System;
using System.Collections.Generic;
using System.IO;
using CrystalDecisions.CrystalReports.Engine;

internal static class RptSurvey
{
    private static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.WriteLine("usage: RptSurvey.exe <report.rpt> [...]");
            return 2;
        }

        foreach (string path in args)
        {
            Console.WriteLine();
            Console.WriteLine("================================================================");
            Console.WriteLine(Path.GetFileName(path));
            Console.WriteLine("================================================================");

            if (!File.Exists(path)) { Console.WriteLine("  missing"); continue; }

            // Surveyed through a COPY, never the shipping file. Crystal's
            // OpenReportByTempCopy overload would do the same, but referencing
            // it drags in CrystalDecisions.Enterprise.InfoStore and
            // .Framework, which this install does not carry - so the copy is
            // made here instead, where it costs one line and no assemblies.
            string temp = Path.Combine(Path.GetTempPath(),
                "rptsurvey-" + Guid.NewGuid().ToString("N") + ".rpt");
            File.Copy(path, temp, true);

            ReportDocument doc = new ReportDocument();
            try
            {
                doc.Load(temp);
            }
            catch (Exception ex)
            {
                Console.WriteLine("  could not load: " + ex.Message);
                continue;
            }

            try
            {
                Survey(doc);
            }
            catch (Exception ex)
            {
                Console.WriteLine("  survey failed: " + ex.Message);
            }
            finally
            {
                try { doc.Close(); doc.Dispose(); } catch (Exception) { }
                try { File.Delete(temp); } catch (Exception) { }
            }
        }

        return 0;
    }

    private static void Survey(ReportDocument doc)
    {
        // ── 1. What the dataset offers ────────────────────────────────
        Console.WriteLine();
        Console.WriteLine("-- tables and fields in the dataset --");
        Dictionary<string, string> available = new Dictionary<string, string>();

        foreach (Table t in doc.Database.Tables)
        {
            Console.WriteLine("  " + t.Name + "   (" + t.Location + ")");
            foreach (DatabaseFieldDefinition f in t.Fields)
            {
                string key = f.Name.ToLowerInvariant();
                if (!available.ContainsKey(key)) available[key] = t.Name;
                Console.WriteLine("      " + f.Name.PadRight(24) + f.ValueType);
            }
        }

        // ── 2. What is actually drawn ─────────────────────────────────
        //
        // The part that matters. Walking sections rather than the field
        // collection, because being in the collection is not being on the page.
        Console.WriteLine();
        Console.WriteLine("-- objects placed on the layout, by section --");

        Dictionary<string, bool> placed = new Dictionary<string, bool>();

        foreach (Section s in doc.ReportDefinition.Sections)
        {
            // Height and suppression, because an empty text object in a
            // suppressed section is not an opportunity - it is never printed at
            // all, and would be a very quiet way to waste an afternoon.
            string supp;
            try
            {
                supp = s.SectionFormat.EnableSuppress ? "SUPPRESSED" : "printed";
            }
            catch (Exception)
            {
                supp = "suppression unknown";
            }

            Console.WriteLine();
            Console.WriteLine("  [" + s.Name + "]  h" + s.Height + "  " + supp);

            foreach (ReportObject o in s.ReportObjects)
            {
                string kind = o.Kind.ToString().Replace("Object", "");

                if (o is FieldObject)
                {
                    FieldObject fo = (FieldObject)o;
                    string src = fo.DataSource == null ? "(unbound)" : fo.DataSource.Name;
                    string formula = fo.DataSource == null ? "" : fo.DataSource.FormulaName;

                    if (fo.DataSource != null)
                    {
                        string key = fo.DataSource.Name.ToLowerInvariant();
                        placed[key] = true;
                        // Formula fields reference columns indirectly; the name
                        // alone will not say which, so print the formula too.
                        if (!string.IsNullOrEmpty(formula) && formula != fo.DataSource.Name)
                            src += "   <- " + formula;
                    }

                    Console.WriteLine("    " + kind.PadRight(10) + o.Name.PadRight(22) + src);
                }
                else if (o is TextObject)
                {
                    TextObject to = (TextObject)o;
                    string text = (to.Text ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
                    if (text.Length > 46) text = text.Substring(0, 46) + "...";

                    // Geometry, but only for the empty ones. A blank text
                    // object is a place to put something only if it has room:
                    // Crystal keeps positions in twips, 1440 to the inch, so a
                    // 72mm till roll is about 4080 of them across.
                    string geom = string.Format("  [x{0} y{1} w{2} h{3}]",
                        o.Left, o.Top, o.Width, o.Height);

                    Console.WriteLine("    " + kind.PadRight(10) + o.Name.PadRight(22)
                        + "\"" + text + "\"" + (text.Length == 0 ? geom : ""));
                }
                else
                {
                    Console.WriteLine("    " + kind.PadRight(10) + o.Name);
                }
            }
        }

        // ── 3. The answer ─────────────────────────────────────────────
        //
        // Columns that are in the dataset but appear nowhere on the page.
        // Writing to one of these changes nothing a customer would ever see —
        // which is exactly the trap this tool exists to keep anyone out of.
        Console.WriteLine();
        Console.WriteLine("-- pos_header columns: bound but NOT drawn --");
        int hidden = 0;
        foreach (KeyValuePair<string, string> kv in available)
        {
            if (placed.ContainsKey(kv.Key)) continue;
            // Only the header is interesting: the detail table is line items.
            if (kv.Value.ToLowerInvariant().IndexOf("header") < 0) continue;
            Console.WriteLine("    " + kv.Key);
            hidden++;
        }
        if (hidden == 0) Console.WriteLine("    (none - every header column bound is also placed)");

        Console.WriteLine();
        Console.WriteLine("-- summary --");
        Console.WriteLine("    " + available.Count + " field(s) in the dataset, "
            + placed.Count + " placed on the layout.");

        // ── 4. Can the empty boxes actually be written to? ────────────
        //
        // Modreports.StampTicket puts the collection ticket number into Text25
        // and Text27 at runtime, which is the whole reason the layout does not
        // need editing. Whether that WORKS is a separate question from whether
        // the objects exist: an object can be present and not be a TextObject,
        // or be one the engine will not let you set.
        //
        // Proven here by setting them and reading them back, which needs no
        // database — so it can be checked on a layout before that layout ever
        // reaches a till.
        Console.WriteLine();
        Console.WriteLine("-- can Text25 / Text27 be stamped at runtime? --");
        foreach (string name in new string[] { "Text25", "Text27" })
        {
            try
            {
                TextObject t = doc.ReportDefinition.ReportObjects[name] as TextObject;
                if (t == null)
                {
                    Console.WriteLine("    " + name + ": not a text object here");
                    continue;
                }
                string probe = "TICKET C-999";
                t.Text = probe;
                bool ok = t.Text == probe;
                Console.WriteLine("    " + name + ": " + (ok ? "writable, reads back" : "set did not stick"));
            }
            catch (Exception ex)
            {
                Console.WriteLine("    " + name + ": " + ex.Message);
            }
        }
    }
}
