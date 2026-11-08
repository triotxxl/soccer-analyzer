import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardDocument } from "./types";

export type DashboardLoadState =
  | { status: "loading"; document: null; message: null }
  | { status: "ready"; document: DashboardDocument; message: null }
  | { status: "missing" | "error"; document: DashboardDocument | null; message: string };

function isDashboardDocument(value: unknown): value is DashboardDocument {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DashboardDocument>;
  return (candidate.schemaVersion === 1 || candidate.schemaVersion === 2 || candidate.schemaVersion === 3 || candidate.schemaVersion === 4 || candidate.schemaVersion === 5 || candidate.schemaVersion === 6 || candidate.schemaVersion === 7 || candidate.schemaVersion === 8 || candidate.schemaVersion === 9 || candidate.schemaVersion === 10 || candidate.schemaVersion === 11 || candidate.schemaVersion === 12 || candidate.schemaVersion === 13 || candidate.schemaVersion === 14)
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
  return (await fetchDashboardIfChanged(null, signal))!.document;
}

/**
 * Wie `fetchDashboard`, aber mit dem ETag der letzten Antwort: Hat sich die Datei nicht geändert,
 * antwortet der Server 304 ohne Inhalt, und das Ergebnis ist null. Ohne ETag (ältere Server, Tests)
 * kommt wie bisher immer das ganze Dokument.
 */
export async function fetchDashboardIfChanged(
  etag: string | null,
  signal?: AbortSignal
): Promise<{ document: DashboardDocument; etag: string | null } | null> {
  const response = await fetch(`/api/dashboard/latest?t=${Date.now()}`, {
    cache: "no-store",
    signal,
    ...(etag ? { headers: { "If-None-Match": etag } } : {})
  });
  if (response.status === 304) return null;
  if (response.status === 404) throw new Error("DASHBOARD_MISSING");
  if (!response.ok) throw new Error("DASHBOARD_UNAVAILABLE");
  const value: unknown = await response.json();
  if (!isDashboardDocument(value)) throw new Error("DASHBOARD_INVALID");
  return { document: value, etag: response.headers?.get("ETag") ?? null };
}

export function useDashboardData(pollInterval = 5_000): DashboardLoadState {
  const [state, setState] = useState<DashboardLoadState>({ status: "loading", document: null, message: null });
  const currentCreatedAt = useRef<string | null>(null);
  const currentEtag = useRef<string | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await fetchDashboardIfChanged(currentEtag.current, signal);
      // Unverändert: kein neuer Zustand, also auch kein neues Rendern der ganzen Ansicht. Nur ein
      // vorheriger Fehler wird zurückgenommen - der Server antwortet ja wieder.
      if (!result) {
        setState((previous) => previous.status === "ready" || !previous.document ? previous
          : { status: "ready", document: previous.document, message: null });
        return;
      }
      const { document, etag } = result;
      currentEtag.current = etag;
      const changed = currentCreatedAt.current !== document.meta.createdAt;
      currentCreatedAt.current = document.meta.createdAt;
      // Dieselbe Analyse noch einmal (Server ohne ETag): der bisherige Zustand bleibt, sonst
      // zeichnete jede Abfrage alle 5 Sekunden die ganze Tabelle neu.
      setState((previous) => !changed && previous.status === "ready" ? previous : {
        status: "ready",
        document: changed || !previous.document ? document : previous.document,
        message: null
      });
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
