import { describe, expect, it } from "vitest";
import { radialAngles, radialItemSize, radialRadius } from "./BetCartUI";

/** Abstand zweier benachbarter Kreise auf einem Ring mit count Einträgen. */
function neighbourDistance(radius: number, count: number): number {
  return 2 * radius * Math.sin(Math.PI / count);
}

describe("radialAngles", () => {
  it("legt die Märkte als geschlossenen Ring um die Nabe, beginnend oben", () => {
    const angles = radialAngles(7);
    expect(angles[0]).toBe(-90);
    expect(angles).toHaveLength(7);
    const steps = angles.slice(1).map((angle, index) => angle - angles[index]);
    for (const step of steps) expect(step).toBeCloseTo(360 / 7, 10);
    // Der letzte Schritt zurück zum ersten Eintrag schließt den Kreis.
    expect(angles[6] - angles[0] + 360 / 7).toBeCloseTo(360, 10);
  });

  it("verteilt auch wenige Märkte über den vollen Kreis", () => {
    expect(radialAngles(4)).toEqual([-90, 0, 90, 180]);
  });
});

describe("radialRadius", () => {
  it("hält benachbarte Kreise auseinander", () => {
    const item = 54;
    for (const count of [3, 5, 7]) {
      expect(neighbourDistance(radialRadius(count, item, 36), count)).toBeGreaterThan(item);
    }
  });

  it("lässt die Nabe in der Mitte frei", () => {
    // Selbst bei zwei Einträgen darf kein Kreis auf dem Auslöser aufsitzen.
    expect(radialRadius(2, 54, 36)).toBeGreaterThanOrEqual(18 + 27);
    expect(radialRadius(7, 40, 36)).toBeGreaterThanOrEqual(18 + 20);
  });
});

describe("radialItemSize", () => {
  it("nutzt die volle Größe, wenn rundum Platz ist", () => {
    expect(radialItemSize(7, 54, 300, 36)).toBe(54);
  });

  it("schrumpft den Ring, statt ihn vom Knopf wegzuschieben", () => {
    // Nabe dicht am linken Fensterrand: 65 Pixel freier Platz.
    const item = radialItemSize(7, 54, 65, 36);
    expect(item).toBeLessThan(54);
    expect(radialRadius(7, item, 36) + item / 2).toBeLessThanOrEqual(65);
  });

  it("fällt nicht unter die Lesbarkeitsgrenze", () => {
    expect(radialItemSize(7, 54, 0, 36)).toBe(34);
  });
});
