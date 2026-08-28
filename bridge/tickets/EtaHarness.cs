// The wait-time arithmetic, on data chosen to break it.
//
// ── Why this runs without a database ──────────────────────────────────
//
// TicketEta's three discard rules are the whole difference between a printed
// wait that means something and one that is roughly double the truth:
//
//   * never measure across a trading-day boundary, or the overnight jump
//     from Friday's last ticket to Saturday's first becomes the largest
//     "gap" in the set;
//   * discard gaps longer than ticket.eta.max_gap, which are lunch and the
//     quiet hour after opening rather than the team working slowly;
//   * discard zero gaps, which are a picker marking several tickets ready in
//     one go — real work, but it says nothing about pace, and enough of them
//     drag the median to nothing.
//
// Waiting for the shop to happen to produce each of those is not a test. The
// gap builder is separated from the query so all three can be fed directly.
//
// Build INTO bin/Release so the reference to FumasV5.exe resolves:
//
//   csc.exe -nologo -target:exe -out:EtaHarness.exe -r:System.dll
//           -r:MySql.Data.dll -r:FumasV5.exe EtaHarness.cs

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;

internal static class EtaHarness
{
    private const BindingFlags Any =
        BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;

    private static Type tEta;
    private static int failures;

    private static int Main()
    {
        Assembly asm = Assembly.LoadFrom("FumasV5.exe");
        tEta = asm.GetType("FumasV5.TicketEta");
        if (tEta == null) { Console.WriteLine("FATAL: FumasV5.TicketEta not found"); return 2; }

        Gaps();
        Percentiles();
        Rounding();
        Estimates();

        Console.WriteLine();
        Console.WriteLine(failures == 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED");
        return failures == 0 ? 0 : 1;
    }

    // ── The three discard rules ───────────────────────────────────────

    private static void Gaps()
    {
        Console.WriteLine("-- gaps between completions --");

        DateTime mon = new DateTime(2026, 8, 24);
        DateTime tue = new DateTime(2026, 8, 25);

        // Four completions ten minutes apart, all on one day: three gaps.
        List<double> g = Build(45,
            C(mon, mon.AddHours(9)),
            C(mon, mon.AddHours(9).AddMinutes(10)),
            C(mon, mon.AddHours(9).AddMinutes(20)),
            C(mon, mon.AddHours(9).AddMinutes(30)));
        Report(g.Count == 3 && All(g, 10), "four completions ten minutes apart -> three 10-min gaps",
            Show(g));

        // The overnight jump must not appear. Monday's last is 17:00 and
        // Tuesday's first is 09:00 the next morning - a "gap" of sixteen hours
        // that would dominate everything else.
        g = Build(45,
            C(mon, mon.AddHours(16).AddMinutes(50)),
            C(mon, mon.AddHours(17)),
            C(tue, tue.AddHours(9)),
            C(tue, tue.AddHours(9).AddMinutes(10)));
        Report(g.Count == 2 && All(g, 10), "the overnight jump is not a gap", Show(g));

        // Lunch. A 90-minute pause with maxGap at 45 is discarded; the real
        // gaps on either side survive.
        g = Build(45,
            C(mon, mon.AddHours(11)),
            C(mon, mon.AddHours(11).AddMinutes(10)),
            C(mon, mon.AddHours(12).AddMinutes(40)),   // 90 minutes later
            C(mon, mon.AddHours(12).AddMinutes(50)));
        Report(g.Count == 2 && All(g, 10), "a 90-minute pause is discarded, its neighbours are not",
            Show(g));

        // A picker clearing five tickets in one go.
        g = Build(45,
            C(mon, mon.AddHours(10)),
            C(mon, mon.AddHours(10)),
            C(mon, mon.AddHours(10)),
            C(mon, mon.AddHours(10).AddMinutes(10)));
        Report(g.Count == 1 && All(g, 10), "tickets marked ready together do not count as zero-minute gaps",
            Show(g));

        // Exactly on the limit is kept; one second past it is not.
        g = Build(45, C(mon, mon.AddHours(9)), C(mon, mon.AddHours(9).AddMinutes(45)));
        Report(g.Count == 1, "a gap exactly on the limit is kept", Show(g));

        g = Build(45, C(mon, mon.AddHours(9)), C(mon, mon.AddHours(9).AddMinutes(45).AddSeconds(1)));
        Report(g.Count == 0, "a gap one second over the limit is discarded", Show(g));

        g = Build(45);
        Report(g.Count == 0, "no completions at all does not throw", Show(g));

        g = Build(45, C(mon, mon.AddHours(9)));
        Report(g.Count == 0, "a single completion yields no gap", Show(g));

        Console.WriteLine();
    }

    // ── Percentiles and rounding ──────────────────────────────────────

    private static void Percentiles()
    {
        Console.WriteLine("-- percentiles (nearest-rank) --");

        List<double> ten = new List<double>();
        for (int i = 1; i <= 10; i++) ten.Add(i);   // 1..10, already sorted

        // Nearest-rank: ceil(p * n), one-based, so p25 of 1..10 is the 3rd.
        Report(P(ten, 0.25) == 3, "p25 of 1..10 is 3", P(ten, 0.25).ToString(CultureInfo.InvariantCulture));
        Report(P(ten, 0.75) == 8, "p75 of 1..10 is 8", P(ten, 0.75).ToString(CultureInfo.InvariantCulture));
        Report(P(ten, 1.0) == 10, "p100 is the largest", P(ten, 1.0).ToString(CultureInfo.InvariantCulture));

        List<double> one = new List<double>();
        one.Add(7);
        Report(P(one, 0.25) == 7 && P(one, 0.75) == 7, "a single sample is both percentiles", "");

        // One forgotten ticket marked ready very late must not move p75. This
        // is the reason for percentiles over a mean.
        List<double> withOutlier = new List<double>();
        for (int i = 0; i < 19; i++) withOutlier.Add(10);
        withOutlier.Add(44);
        withOutlier.Sort();
        Report(P(withOutlier, 0.75) == 10, "one very late ticket does not move p75",
            P(withOutlier, 0.75).ToString(CultureInfo.InvariantCulture));

        Console.WriteLine();
    }

    private static void Rounding()
    {
        Console.WriteLine("-- rounding --");
        Report(R(0.1) == 5, "anything above zero is at least 5 minutes", R(0.1).ToString());
        Report(R(7) == 5, "7 rounds to 5", R(7).ToString());
        Report(R(8) == 10, "8 rounds to 10", R(8).ToString());
        Report(R(12.5) == 15, "12.5 rounds away from zero, to 15", R(12.5).ToString());
        Report(R(62) == 60, "62 rounds to 60", R(62).ToString());
        Report(R(0) == 0, "zero stays zero", R(0).ToString());
        Console.WriteLine();
    }

    // ── What a customer would actually be told ────────────────────────
    //
    // The arithmetic the slip depends on: (queue ahead + yourself) x the
    // measured minutes per ticket. Done here in the open so the numbers can
    // be checked by eye against what the slip prints.
    private static void Estimates()
    {
        Console.WriteLine("-- what the slip would say --");

        // A band finishing one ticket every 8 to 12 minutes.
        List<double> gaps = new List<double>();
        for (int i = 0; i < 30; i++) gaps.Add(8 + (i % 5));
        gaps.Sort();

        double lo = P(gaps, 0.25);
        double hi = P(gaps, 0.75);
        Console.WriteLine(string.Format(CultureInfo.InvariantCulture,
            "  measured pace: {0:0.0}-{1:0.0} minutes per ticket, {2} samples", lo, hi, gaps.Count));

        foreach (int ahead in new int[] { 0, 1, 3, 8 })
        {
            int mine = ahead + 1;
            Console.WriteLine(string.Format(CultureInfo.InvariantCulture,
                "  {0,2} ahead -> READY IN {1}-{2} MIN", ahead, R(lo * mine), R(hi * mine)));
        }

        // The point of the whole exercise: an empty queue and a busy one must
        // not produce the same promise.
        int quietHi = R(hi * 1);
        int busyHi = R(hi * 9);
        Report(busyHi > quietHi * 4,
            "a queue of eight promises a much longer wait than an empty one",
            quietHi + " vs " + busyHi);

        Console.WriteLine();
    }

    // ── Reflection plumbing ───────────────────────────────────────────

    private static KeyValuePair<DateTime, DateTime> C(DateTime day, DateTime ready)
    {
        return new KeyValuePair<DateTime, DateTime>(day, ready);
    }

    private static List<double> Build(int maxGap, params KeyValuePair<DateTime, DateTime>[] rows)
    {
        List<KeyValuePair<DateTime, DateTime>> list =
            new List<KeyValuePair<DateTime, DateTime>>(rows);
        MethodInfo m = tEta.GetMethod("BuildGaps", Any);
        return (List<double>)m.Invoke(null, new object[] { list, maxGap });
    }

    private static double P(List<double> sorted, double p)
    {
        MethodInfo m = tEta.GetMethod("Percentile", Any);
        return (double)m.Invoke(null, new object[] { sorted, p });
    }

    private static int R(double minutes)
    {
        MethodInfo m = tEta.GetMethod("Round5", Any);
        return (int)m.Invoke(null, new object[] { minutes });
    }

    private static bool All(List<double> g, double v)
    {
        foreach (double d in g) if (Math.Abs(d - v) > 0.001) return false;
        return true;
    }

    private static string Show(List<double> g)
    {
        string s = "";
        foreach (double d in g) s += (s.Length > 0 ? ", " : "") + d.ToString("0.#", CultureInfo.InvariantCulture);
        return "got [" + s + "]";
    }

    private static void Report(bool ok, string what, string detail)
    {
        Console.WriteLine("  " + (ok ? "ok    " : "FAIL  ") + what + (ok ? "" : "   -> " + detail));
        if (!ok) failures++;
    }
}
