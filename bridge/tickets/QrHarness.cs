// Prove the in-exe QR encoder, at the size it will actually print.
//
// ── Why this is not a casual check ────────────────────────────────────
//
// QrCode.cs carries transcribed tables from ISO/IEC 18004 - block counts,
// error-correction codeword counts, alignment centres. A single mistyped
// number produces a symbol that looks entirely convincing to a human and
// decodes to nothing, or worse, decodes on the developer's phone and not on
// a customer's. Reading the tables again is not verification; it is the same
// pair of eyes making the same mistake twice.
//
// So this writes out two things per case:
//
//   * the module matrix as text, which verify-qr.js compares BIT FOR BIT
//     against the `qrcode` npm package - an independent implementation. If
//     both agree on version, mask and every module, the tables are right.
//
//   * a PNG rendered through QrCode.Draw at 203 dpi with the QR sized as the
//     slip sizes it, which verify-qr.js decodes with jsqr. Rendering at some
//     convenient large scale would prove only that the maths is right; the
//     question that matters is whether a phone can read it off a till roll,
//     where a module is about five pixels wide.
//
// Build INTO bin/Release so the reference to FumasV5.exe resolves:
//
//   csc.exe -nologo -target:exe -out:QrHarness.exe -r:System.dll
//           -r:System.Drawing.dll -r:FumasV5.exe QrHarness.cs
//
// QrCode is internal, so everything goes through reflection.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Text;

internal static class QrHarness
{
    // What the ticket slip uses. Changing the slip means changing this, or
    // the test stops testing the thing that ships.
    private const float SlipQrSidePoints = 58f;
    private const float ThermalDpi = 203f;

    private static Type qr;
    private static Type eccType;
    private static MethodInfo encode;
    private static MethodInfo draw;

    private static int Main(string[] args)
    {
        string outDir = args.Length > 0
            ? args[0]
            : Path.Combine(Directory.GetCurrentDirectory(), "qr-verify");
        Directory.CreateDirectory(outDir);

        Assembly asm = Assembly.LoadFrom(Path.Combine(
            AppDomain.CurrentDomain.BaseDirectory, "FumasV5.exe"));

        qr = asm.GetType("FumasV5.QrCode");
        if (qr == null) { Console.WriteLine("FAIL: FumasV5.QrCode not found"); return 1; }

        eccType = qr.GetNestedType("Ecc", BindingFlags.NonPublic | BindingFlags.Public);
        encode = qr.GetMethod("Encode", BindingFlags.NonPublic | BindingFlags.Static);
        draw = qr.GetMethod("Draw", BindingFlags.NonPublic | BindingFlags.Static);

        if (eccType == null || encode == null || draw == null)
        {
            Console.WriteLine("FAIL: Ecc={0} Encode={1} Draw={2}",
                eccType != null, encode != null, draw != null);
            return 1;
        }

        List<Case> cases = BuildCases();

        StringBuilder manifest = new StringBuilder();
        int failures = 0;

        foreach (Case c in cases)
        {
            bool[,] m = (bool[,])encode.Invoke(null,
                new object[] { c.Text, Enum.Parse(eccType, c.Ecc) });

            if (m == null)
            {
                if (c.ExpectTooLong)
                {
                    Console.WriteLine("  {0,-26} {1}  refused, as intended", c.Name, c.Ecc);
                    manifest.AppendLine("CASE\t" + c.Name + "\t" + c.Ecc + "\tREFUSED\t" + c.Text);
                    continue;
                }
                Console.WriteLine("  {0,-26} {1}  FAIL - encoder returned null", c.Name, c.Ecc);
                failures++;
                continue;
            }

            if (c.ExpectTooLong)
            {
                Console.WriteLine("  {0,-26} {1}  FAIL - should not have fitted", c.Name, c.Ecc);
                failures++;
                continue;
            }

            int n = m.GetLength(0);
            int version = (n - 17) / 4;

            string png = Path.Combine(outDir, c.Name + "_" + c.Ecc + ".png");
            RenderAtPrintSize(m, png);

            manifest.AppendLine("CASE\t" + c.Name + "\t" + c.Ecc + "\t" + version + "\t" + c.Text);
            manifest.AppendLine("PNG\t" + Path.GetFileName(png));
            for (int r = 0; r < n; r++)
            {
                StringBuilder row = new StringBuilder(n);
                for (int col = 0; col < n; col++) row.Append(m[r, col] ? '1' : '0');
                manifest.AppendLine("ROW\t" + row);
            }

            using (Bitmap probe = new Bitmap(png))
            {
                Console.WriteLine("  {0,-26} {1}  v{2,-2} {3}x{3} modules -> {4}x{4} px",
                    c.Name, c.Ecc, version, n, probe.Width);
            }
        }

        File.WriteAllText(Path.Combine(outDir, "matrices.txt"), manifest.ToString());

        Console.WriteLine();
        Console.WriteLine("Wrote {0}", Path.Combine(outDir, "matrices.txt"));
        Console.WriteLine(failures == 0
            ? "Encoder produced a symbol for every case."
            : failures + " case(s) failed outright.");
        return failures == 0 ? 0 : 1;
    }

    // Exactly what the printer does: points on a 203 dpi surface, the QR at
    // the size the slip gives it, drawn through the shipping Draw method.
    private static void RenderAtPrintSize(bool[,] m, string path)
    {
        int n = m.GetLength(0);
        float step = SlipQrSidePoints / n;
        float quiet = 4f * step;                      // the specified quiet zone
        float totalPoints = SlipQrSidePoints + (quiet * 2f);
        int px = (int)Math.Ceiling(totalPoints / 72f * ThermalDpi);

        using (Bitmap bmp = new Bitmap(px, px, PixelFormat.Format24bppRgb))
        {
            bmp.SetResolution(ThermalDpi, ThermalDpi);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.PageUnit = GraphicsUnit.Point;
                g.Clear(Color.White);
                draw.Invoke(null, new object[] { g, m, quiet, quiet, SlipQrSidePoints });
            }
            bmp.Save(path, ImageFormat.Png);
        }
    }

    private sealed class Case
    {
        internal string Name;
        internal string Text;
        internal string Ecc;
        internal bool ExpectTooLong;
    }

    private static List<Case> BuildCases()
    {
        List<Case> list = new List<Case>();

        // The two payloads that actually ship.
        string telegram = "t.me/MwalimuCosmeticsBot?start=E001";
        string receipt = "https://mwalimucosmetics.com/r/8f3kQ2mZpR7vN1xL4tB6wY";

        string[] levels = new string[] { "L", "M", "Q", "H" };

        foreach (string lv in levels)
        {
            list.Add(New("telegram", telegram, lv, false));
            list.Add(New("receipt", receipt, lv, false));
        }

        // Lengths chosen to land on different versions and, importantly, to
        // cross into the versions that use TWO block groups of different
        // sizes (5-Q upward) and the ones that carry version information
        // blocks (7 upward). Those are where a table error hides.
        int[] lengths = new int[] { 1, 2, 16, 17, 32, 40, 55, 70, 90, 110, 150, 200 };
        foreach (int len in lengths)
        {
            string text = Filler(len);
            list.Add(New("len" + len, text, "M", false));
            // Version 10 at level H carries 122 data codewords, of which the
            // mode indicator and length take 12 bits - so 120 bytes fit and
            // 121 do not. Getting this boundary wrong is how a "failure" turns
            // out to be the test being wrong rather than the encoder.
            list.Add(New("len" + len + "h", text, "H", len > 120));
        }

        // Characters that must survive byte mode unmangled.
        list.Add(New("punct", "https://a.b/c?d=e&f=g#h+i%20j_k-l.m~n", "M", false));

        return list;
    }

    private static Case New(string name, string text, string ecc, bool tooLong)
    {
        Case c = new Case();
        c.Name = name;
        c.Text = text;
        c.Ecc = ecc;
        c.ExpectTooLong = tooLong;
        return c;
    }

    // Varied rather than repeated: a run of one character compresses into
    // very regular modules and would not exercise the mask scoring at all.
    private static string Filler(int len)
    {
        const string alphabet = "abcdefghijklmnopqrstuvwxyz0123456789-_/:.";
        StringBuilder sb = new StringBuilder(len);
        for (int i = 0; i < len; i++) sb.Append(alphabet[(i * 7) % alphabet.Length]);
        return sb.ToString();
    }
}
