import { describe, expect, it } from "vitest";
import { formatDeliveryNumber } from "@/lib/sequence";

describe("smoke", () => {
  it("formats delivery numbers", async () => {
    const result = formatDeliveryNumber(new Date("2026-02-06"), 12);
    expect(result).toBe("DEL-202602-000012");
  });
});
