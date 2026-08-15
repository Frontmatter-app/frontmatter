import { describe, expect, it } from "vitest";
import { reviewCardClass } from "./reviewCards";

/**
 * Scrolling the right card into view was the whole of the old answer to "which
 * one is selected", and it is not an answer: the card arrives in the middle of
 * a column of cards that look exactly like it. The active card is lifted off
 * the page instead, and these tests are what stops that quietly reverting to a
 * tint and a hairline shadow.
 */
describe("reviewCardClass", () => {
  const active = reviewCardClass(true, "border-rose-400/40");
  const resting = reviewCardClass(false, "border-rose-400/40");

  it("tilts and scales the active card", () => {
    expect(active).toContain("-rotate-3");
    expect(active).toContain("scale-[1.03]");
  });

  it("raises it above its neighbours, so the shadow falls on them", () => {
    expect(active).toContain("relative");
    expect(active).toContain("z-10");
    expect(active).toMatch(/shadow-\[/);
  });

  it("leaves every other card square and flat", () => {
    expect(resting).not.toMatch(/rotate/);
    expect(resting).not.toMatch(/scale-/);
    expect(resting).not.toMatch(/z-10/);
  });

  it("keeps the category accent either way, so colour still says what it is", () => {
    expect(active).toContain("border-rose-400/40");
    expect(resting).toContain("border-rose-400/40");
  });

  it("animates the lift, and does not for anyone who asked for less motion", () => {
    expect(active).toContain("transition-[transform,box-shadow,background-color,border-color]");
    expect(active).toContain("motion-reduce:transition-none");
  });

  it("only the active card offers the hover treatment", () => {
    expect(resting).toContain("hover:bg-[var(--editor-bg-color)]");
    expect(active).not.toContain("hover:bg-[var(--editor-bg-color)]");
  });
});
