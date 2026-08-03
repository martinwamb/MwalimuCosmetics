import { describe, it, expect } from "vitest";
import {
  toCents, fromCents, centsToSqlString, parseMoney,
  computeLine, headerAmount, sumVat,
  assertBalanced, UnbalancedLedgerError,
  balanceWithRounding, RoundingTooLargeError,
  type GlLeg,
} from "../src/money";

const VAT = 0.16; // nauto.vat / 100

describe("cents conversion", () => {
  it("round-trips without float drift", () => {
    for (const v of [0, 0.01, 1, 19.99, 1234.56, 2_000_000]) {
      expect(fromCents(toCents(v))).toBe(v);
    }
  });

  it("formats for SQL with two decimal places", () => {
    expect(centsToSqlString(0)).toBe("0.00");
    expect(centsToSqlString(5)).toBe("0.05");
    expect(centsToSqlString(123456)).toBe("1234.56");
    expect(centsToSqlString(-250)).toBe("-2.50");
  });

  it("parses money arriving from MySQL as a string", () => {
    expect(parseMoney("1234.56")).toBe(123456);
    expect(parseMoney(null)).toBe(0);
    expect(parseMoney("")).toBe(0);
  });
});

describe("VAT-exclusive line", () => {
  // 2 x 100.00, no discount. VAT is added on top.
  const line = computeLine(
    { qty: 2, unitPrice: toCents(100), discount: 0, taxable: true, inclusive: false },
    VAT,
  );

  it("totals gross of VAT and before discount", () => {
    expect(line.total).toBe(toCents(200));
  });

  it("adds VAT on top of the base", () => {
    expect(line.vat).toBe(toCents(32));
  });

  it("nets to total + vat - discount", () => {
    expect(line.net).toBe(toCents(232));
  });
});

describe("VAT-inclusive line", () => {
  // 2 x 116.00 inclusive => 200.00 net + 32.00 VAT.
  const line = computeLine(
    { qty: 2, unitPrice: toCents(116), discount: 0, taxable: true, inclusive: true },
    VAT,
  );

  it("extracts VAT out of the price rather than adding it", () => {
    expect(line.vat).toBe(toCents(32));
  });

  it("nets to total - discount, since VAT is already inside total", () => {
    expect(line.net).toBe(toCents(232));
  });
});

describe("discount is applied before VAT", () => {
  it("reduces the VAT base on an exclusive line", () => {
    // 200.00 less 50.00 discount = 150.00 base; 16% of that is 24.00.
    const line = computeLine(
      { qty: 2, unitPrice: toCents(100), discount: toCents(50), taxable: true, inclusive: false },
      VAT,
    );
    expect(line.vat).toBe(toCents(24));
    expect(line.net).toBe(toCents(174)); // 200 + 24 - 50
  });

  it("reduces the VAT base on an inclusive line", () => {
    // 232.00 less 32.00 = 200.00 base; VAT inside that is 200 * 16/116 = 27.59.
    const line = computeLine(
      { qty: 2, unitPrice: toCents(116), discount: toCents(32), taxable: true, inclusive: true },
      VAT,
    );
    expect(line.vat).toBe(2759);
    expect(line.net).toBe(toCents(200)); // 232 - 32
  });

  it("leaves total gross of the discount", () => {
    const line = computeLine(
      { qty: 1, unitPrice: toCents(100), discount: toCents(10), taxable: true, inclusive: false },
      VAT,
    );
    // total must NOT have the discount taken off; that only happens in net.
    expect(line.total).toBe(toCents(100));
  });
});

describe("non-taxable line", () => {
  it("charges no VAT", () => {
    const line = computeLine(
      { qty: 3, unitPrice: toCents(50), discount: 0, taxable: false, inclusive: false },
      VAT,
    );
    expect(line.vat).toBe(0);
    expect(line.net).toBe(toCents(150));
  });
});

describe("header amount", () => {
  it("rounds up to whole shillings, matching the legacy CEILING", () => {
    const lines = [
      computeLine({ qty: 1, unitPrice: toCents(10.10), discount: 0, taxable: true, inclusive: false }, VAT),
    ];
    // 10.10 + 1.62 VAT = 11.72 -> ceils to 12.00
    expect(lines[0]!.net).toBe(1172);
    expect(headerAmount(lines)).toBe(toCents(12));
  });

  it("leaves an already-whole amount untouched", () => {
    const lines = [
      computeLine({ qty: 1, unitPrice: toCents(100), discount: 0, taxable: false, inclusive: false }, VAT),
    ];
    expect(headerAmount(lines)).toBe(toCents(100));
  });

  it("sums a mixed basket before rounding, not line by line", () => {
    const lines = [
      computeLine({ qty: 1, unitPrice: toCents(10.10), discount: 0, taxable: false, inclusive: false }, VAT),
      computeLine({ qty: 1, unitPrice: toCents(10.20), discount: 0, taxable: false, inclusive: false }, VAT),
    ];
    // 20.30 ceils once to 21.00; rounding each line first would give 22.00.
    expect(headerAmount(lines)).toBe(toCents(21));
    expect(sumVat(lines)).toBe(0);
  });
});

describe("balanceWithRounding", () => {
  const leg = (account: string, amount: number, debit: boolean): GlLeg =>
    ({ account, amount: toCents(amount), debit, remarks: "test" });

  it("leaves an already-balanced entry untouched", () => {
    const legs = [leg("CASH", 100, true), leg("SALES", 100, false)];
    const out = balanceWithRounding(legs, "ROUNDING");
    expect(out).toHaveLength(2);
    expect(() => assertBalanced(out)).not.toThrow();
  });

  it("closes the gap when the cash debit was rounded up", () => {
    // Customer pays a whole 12/=, the lines only justify 11.72.
    const legs = [leg("CASH", 12, true), leg("SALES", 11.72, false)];
    const out = balanceWithRounding(legs, "ROUNDING");

    expect(out).toHaveLength(3);
    const rounding = out[2]!;
    expect(rounding.account).toBe("ROUNDING");
    expect(rounding.amount).toBe(28);     // 0.28
    expect(rounding.debit).toBe(false);   // credit, to offset the extra debit
    expect(() => assertBalanced(out)).not.toThrow();
  });

  it("closes the gap in the other direction too", () => {
    const legs = [leg("CASH", 11.72, true), leg("SALES", 12, false)];
    const out = balanceWithRounding(legs, "ROUNDING");
    expect(out[2]!.debit).toBe(true);
    expect(out[2]!.amount).toBe(28);
    expect(() => assertBalanced(out)).not.toThrow();
  });

  it("handles the largest possible rounding gap of 99 cents", () => {
    const legs = [leg("CASH", 100, true), leg("SALES", 99.01, false)];
    const out = balanceWithRounding(legs, "ROUNDING");
    expect(out[2]!.amount).toBe(99);
    expect(() => assertBalanced(out)).not.toThrow();
  });

  it("refuses a full shilling — that is no longer rounding", () => {
    const legs = [leg("CASH", 101, true), leg("SALES", 100, false)];
    expect(() => balanceWithRounding(legs, "ROUNDING")).toThrow(RoundingTooLargeError);
  });

  it("refuses the worst residual seen in production rather than hiding it", () => {
    // 240/= is a real calculation fault in the legacy app. A plug account with
    // no ceiling would absorb it silently, which is the failure this guards.
    const legs = [leg("CASH", 1240, true), leg("SALES", 1000, false)];
    expect(() => balanceWithRounding(legs, "ROUNDING")).toThrow(RoundingTooLargeError);
    try {
      balanceWithRounding(legs, "ROUNDING");
    } catch (e) {
      expect((e as RoundingTooLargeError).message).toContain("240");
      expect((e as RoundingTooLargeError).message).toContain("not a rounding remainder");
    }
  });

  it("always yields a balanced entry across a sweep of gaps", () => {
    // The property that matters: for any sub-shilling gap, the result balances.
    for (let cents = -99; cents <= 99; cents++) {
      const legs: GlLeg[] = [
        { account: "CASH",  amount: toCents(100) + cents, debit: true,  remarks: "t" },
        { account: "SALES", amount: toCents(100),         debit: false, remarks: "t" },
      ];
      expect(() => assertBalanced(balanceWithRounding(legs, "ROUNDING"))).not.toThrow();
    }
  });
});

describe("assertBalanced", () => {
  const leg = (account: string, amount: number, debit: boolean): GlLeg =>
    ({ account, amount: toCents(amount), debit, remarks: "test" });

  it("accepts a balanced entry", () => {
    expect(() => assertBalanced([
      leg("CASH", 232, true),
      leg("SALES", 200, false),
      leg("VAT-OUT", 32, false),
    ])).not.toThrow();
  });

  it("accepts an empty entry", () => {
    expect(() => assertBalanced([])).not.toThrow();
  });

  it("throws when debits and credits differ, even by one cent", () => {
    expect(() => assertBalanced([
      leg("CASH", 100.01, true),
      leg("SALES", 100, false),
    ])).toThrow(UnbalancedLedgerError);
  });

  it("reports both sides and the difference so the fault is diagnosable", () => {
    try {
      assertBalanced([leg("CASH", 232, true), leg("SALES", 200, false)]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnbalancedLedgerError);
      const err = e as UnbalancedLedgerError;
      expect(err.debits).toBe(toCents(232));
      expect(err.credits).toBe(toCents(200));
      expect(err.message).toContain("out by 32");
      expect(err.message).toContain("CASH Dr 232");
    }
  });
});
