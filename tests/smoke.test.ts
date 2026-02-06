import { describe, expect, it } from "vitest";
import { formatDeliveryNumber, formatInvoiceNumber } from "@/lib/sequence";

describe("smoke", () => {
  it("formats delivery numbers", async () => {
    const result = formatDeliveryNumber(new Date("2026-02-06"), 12);
    expect(result).toBe("DEL-202602-000012");
  });

  it("formats invoice numbers", async () => {
    const result = formatInvoiceNumber(new Date("2026-02-06"), 7);
    expect(result).toBe("INV-202602-000007");
  });
});
