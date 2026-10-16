import { describe, it, expect } from "vitest";
import { placeMenu, placeSubmenu } from "./menuPlacement";

const view = { vw: 1000, vh: 800, margin: 8 };

describe("placeMenu", () => {
  it("opens at the pointer when it fits", () => {
    expect(placeMenu({ x: 100, y: 100, width: 200, height: 300, ...view })).toEqual({ left: 100, top: 100, maxHeight: null });
  });

  it("near the bottom edge it opens upwards from the pointer", () => {
    expect(placeMenu({ x: 100, y: 700, width: 200, height: 300, ...view })).toEqual({ left: 100, top: 400, maxHeight: null });
  });

  it("when neither direction fits it sits against the bottom margin", () => {
    expect(placeMenu({ x: 100, y: 200, width: 200, height: 700, ...view })).toEqual({ left: 100, top: 92, maxHeight: null });
  });

  it("a menu taller than the window is capped and scrolls", () => {
    expect(placeMenu({ x: 100, y: 400, width: 200, height: 900, ...view })).toEqual({ left: 100, top: 8, maxHeight: 784 });
  });

  it("near the right edge it opens to the left of the pointer", () => {
    expect(placeMenu({ x: 950, y: 100, width: 200, height: 100, ...view }).left).toBe(750);
    expect(placeMenu({ x: 150, y: 100, width: 995, height: 100, ...view }).left).toBe(8);
  });
});

describe("placeSubmenu", () => {
  const parent = { top: 100, bottom: 130, left: 300, right: 500 };

  it("opens to the right, aligned with its parent item, when it fits", () => {
    expect(placeSubmenu({ parent, width: 200, height: 150, ...view })).toEqual({ side: "right", shiftY: 0 });
  });

  it("flips left when the right side has no room", () => {
    expect(placeSubmenu({ parent: { ...parent, left: 700, right: 900 }, width: 200, height: 150, ...view }).side).toBe("left");
  });

  it("moves up by the overflow near the bottom, but not past the top margin", () => {
    expect(placeSubmenu({ parent: { ...parent, top: 700, bottom: 730 }, width: 200, height: 150, ...view }).shiftY).toBe(-58);
    expect(placeSubmenu({ parent: { ...parent, top: 100, bottom: 130 }, width: 200, height: 900, ...view }).shiftY).toBe(-92);
  });
});
