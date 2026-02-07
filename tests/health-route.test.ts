import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("health route", () => {
  it("returns ok true", async () => {
    const response = await GET();
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(typeof data.ts).toBe("string");
  });
});
