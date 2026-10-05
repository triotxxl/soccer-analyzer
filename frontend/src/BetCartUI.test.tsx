import { describe, expect, it } from "vitest";
import { menuPlacement } from "./BetCartUI";

/** Ein 26-px-Knopf an der Stelle (left, top). */
function trigger(left: number, top: number) {
  return { left, top, right: left + 26, bottom: top + 26 };
}

const viewport = { width: 1280, height: 800 };
const menu = { width: 260, height: 400 };

describe("menuPlacement", () => {
  it("setzt die Liste rechts neben den Knopf, oben auf Höhe der Zeile", () => {
    expect(menuPlacement(trigger(100, 200), menu, viewport)).toEqual({ left: 132, top: 196 });
  });

  it("klappt nach oben, wenn unten der Platz fehlt", () => {
    const placed = menuPlacement(trigger(100, 700), menu, viewport);
    // Die Unterkante der Liste schließt mit der Unterkante des Knopfs ab.
    expect(placed.top + menu.height).toBe(700 + 26 + 4);
  });

  it("stellt die Liste links vom Knopf, wenn rechts der Platz fehlt", () => {
    const placed = menuPlacement(trigger(1100, 200), menu, viewport);
    expect(placed.left + menu.width).toBeLessThanOrEqual(1100);
  });

  it("beginnt eine zu hohe Liste am oberen Rand, statt sie abzuschneiden", () => {
    expect(menuPlacement(trigger(100, 300), { width: 260, height: 900 }, viewport).top).toBe(8);
  });
});
