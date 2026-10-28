import { useEffect, useState } from "react";
import type { FixtureInsights } from "../../shared/src/types";

export type InsightsState =
  | { status: "loading" }
  | { status: "ready"; insights: FixtureInsights }
  | { status: "error"; message: string };

// Einmal geladen, bleibt es für die Sitzung: Der Server speichert beendete Spiele ohnehin 30 Tage,
// ein zweiter Abruf desselben Spiels kostet dort nichts, hier spart er nur das Warten.
const cache = new Map<number, FixtureInsights>();

/**
 * Detailkennzahlen eines Spiels (`/api/fixture/insights`) - nur, wenn die Ansicht sie braucht
 * (`fixtureId` gesetzt). Der erste Abruf eines Spiels kostet den Server rund vier API-Aufrufe.
 */
export function useInsights(fixtureId: number | null): InsightsState | null {
  const [state, setState] = useState<InsightsState | null>(null);
  useEffect(() => {
    if (fixtureId === null) { setState(null); return; }
    const known = cache.get(fixtureId);
    if (known) { setState({ status: "ready", insights: known }); return; }
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(`/api/fixture/insights?fixture=${fixtureId}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as (FixtureInsights & { message?: string }) | null;
        if (!response.ok || !body) throw new Error(body?.message ?? "Die Detailkennzahlen sind gerade nicht verfügbar.");
        cache.set(fixtureId, body);
        setState({ status: "ready", insights: body });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setState({ status: "error", message: error.message });
      });
    return () => controller.abort();
  }, [fixtureId]);
  return state;
}
