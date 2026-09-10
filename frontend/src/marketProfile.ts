import { useEffect, useState } from "react";
import type { MarketProfile } from "./types";

const MESSAGES: Record<string, string> = {
  database_missing: "Es gibt noch keine Datenbank mit abgerechneten Ergebnissen.",
  no_snapshots: "Im Ordner output/ liegt kein Dashboard-Snapshot, aus dem sich Quoten lesen ließen.",
  insufficient_data: "Es sind noch keine Partien abgerechnet, aus denen sich eine Empfehlung ableiten ließe."
};

function isMarketProfile(value: unknown): value is MarketProfile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MarketProfile>;
  return typeof candidate.generatedAt === "string"
    && typeof candidate.observations === "number"
    && Array.isArray(candidate.markets);
}

export async function fetchMarketProfile(signal?: AbortSignal): Promise<MarketProfile> {
  const response = await fetch("/api/market-profile", { cache: "no-store", signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body as { error?: string; message?: string } | null;
    throw new Error(MESSAGES[error?.error ?? ""] ?? error?.message ?? "Das Marktprofil ist nicht verfügbar.");
  }
  if (!isMarketProfile(body)) throw new Error("Das Marktprofil kam unlesbar zurück.");
  return body;
}

export interface MarketProfileState {
  status: "idle" | "loading" | "ready" | "error";
  profile: MarketProfile | null;
  message: string | null;
}

/**
 * Lädt das Marktprofil einmal je Sitzung. Es kostet keinen API-Aufruf und ändert sich nur,
 * wenn ein neuer Lauf oder eine Abrechnung stattgefunden hat - der Dienst erkennt das an der
 * Änderungszeit und liefert dann von selbst den neuen Stand.
 */
export function useMarketProfile(enabled: boolean): MarketProfileState {
  const [state, setState] = useState<MarketProfileState>({ status: "idle", profile: null, message: null });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((current) => current.profile === null
      ? { status: "loading", profile: null, message: null }
      : current);
    fetchMarketProfile(controller.signal)
      .then((profile) => setState({ status: "ready", profile, message: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          profile: null,
          message: error instanceof Error ? error.message : "Das Marktprofil ist nicht verfügbar."
        });
      });
    return () => controller.abort();
  }, [enabled]);

  return state;
}

export function formatPoints(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1).replace(".", ",")} PP`;
}

export function formatRoi(value: number | null): string {
  if (value === null) return "–";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1).replace(".", ",")} %`;
}
