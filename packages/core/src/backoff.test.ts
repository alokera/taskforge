import { describe, expect, it } from "vitest";
import { computeBackoff } from "./backoff";

describe("computeBackoff", () => {
  it("is 0 without a backoff option", () => {
    expect(computeBackoff(undefined, 3)).toBe(0);
  });

  it("is constant for fixed backoff", () => {
    expect([1, 2, 3].map((n) => computeBackoff({ type: "fixed", delay: 500 }, n))).toEqual([500, 500, 500]);
  });

  it("doubles each attempt for exponential backoff", () => {
    expect([1, 2, 3, 4].map((n) => computeBackoff({ type: "exponential", delay: 100 }, n))).toEqual([100, 200, 400, 800]);
  });
});
