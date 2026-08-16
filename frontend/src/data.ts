import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardDocument } from "./types";

export type DashboardLoadState =
  | { status: "loading"; document: null; message: null }
  | { status: "ready"; document: DashboardDocument; message: null }
  | { status: "missing" | "error"; document: DashboardDocument | null; message: string };

function isDashboardDocument(value: unknown): value is DashboardDocument {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DashboardDocument>;
  return candidate.schemaVersion === 1
    && !!candidate.meta
    && typeof candidate.meta.createdAt === "string"
    && typeof candidate.meta.timezone === "string"
    && Array.isArray(candidate.fixtures)
    && candidate.fixtures.every((fixture) =>
      !!fixture
      && typeof fixture.fixtureId === "number"
      && typeof fixture.kickoff === "string"
      && Array.isArray(fixture.markets)
    );
}

export async function fetchDashboard(signal?: AbortSignal): Promise<DashboardDocument> {
  const response = await fetch(`/api/dashboard/latest?t=${Date.now()}`, { cache: "no-store", signal });
  if (response.status === 404) throw new Error("DASHBOARD_MISSING");
  if (!response.ok) throw new Error("DASHBOARD_UNAVAILABLE");
  const value: unknown = await response.json();
  if (!isDashboardDocument(value)) throw new Error("DASHBOARD_INVALID");
  return value;
}

export function useDashboardData(pollInterval = 5_000): DashboardLoadState {
  const [state, setState] = useState<DashboardLoadState>({ status: "loading", document: null, message: null });
  const currentCreatedAt = useRef<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const document = await fetchDashboard(signal);
      const changed = currentCreatedAt.current !== document.meta.createdAt;
      currentCreatedAt.current = document.meta.createdAt;
      setState((previous) => ({
        status: "ready",
        document: changed || !previous.document ? document : previous.document,
        message: null
      }));
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return;
      const missing = (error as Error).message === "DASHBOARD_MISSING";
      setState((previous) => ({
        status: missing ? "missing" : "error",
        document: previous.document,
        message: missing
          ? "Noch keine Analyse vorhanden. Starte zuerst einen Dashboard-Lauf im Chat."
          : "Die Dashboard-Daten konnten nicht gelesen werden."
      }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const interval = window.setInterval(() => void load(controller.signal), pollInterval);
    const onFocus = () => void load(controller.signal);
    window.addEventListener("focus", onFocus);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, pollInterval]);
  return state;
}
