import { useCallback, useEffect, useState } from "react";
import type { LiveBoardResponse } from "./types";

export const LIVE_POLL_FALLBACK_MS = 15_000;

export type LiveLoadState =
  | { status: "idle" | "loading"; board: null; message: null }
  | { status: "ready"; board: LiveBoardResponse; message: string | null }
  | { status: "error"; board: LiveBoardResponse | null; message: string };

const MESSAGES: Record<string, string> = {
  dashboard_missing: "Noch keine Analyse vorhanden. Starte zuerst einen Dashboard-Lauf im Chat.",
  api_key_missing: "API_FOOTBALL_KEY fehlt. Trage den Schlüssel in .env ein und starte die App neu.",
  api_unavailable: "API-Football ist gerade nicht erreichbar."
};

export async function fetchLiveBoard(
  fixtureIds: number[] = [],
  signal?: AbortSignal
): Promise<LiveBoardResponse> {
  const watched = fixtureIds.length > 0 ? `&fixtures=${fixtureIds.join(",")}` : "";
  const response = await fetch(`/api/live/board?t=${Date.now()}${watched}`, { cache: "no-store", signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body as { error?: string; message?: string } | null;
    throw new Error(MESSAGES[error?.error ?? ""] ?? error?.message ?? "Live-Daten sind nicht verfügbar.");
  }
  return body as LiveBoardResponse;
}

/**
 * Fragt den Live-Stand nur ab, solange die Live-Ansicht offen und der Tab sichtbar ist.
 * Im Pre-Match-Modus oder im Hintergrund entsteht dadurch kein einziger API-Call.
 */
export function useLiveBoard(active: boolean, fixtureIds: number[] = []): LiveLoadState {
  const [state, setState] = useState<LiveLoadState>({ status: "idle", board: null, message: null });
  const [pollInterval, setPollInterval] = useState(LIVE_POLL_FALLBACK_MS);
  // Als stabiler String, damit der Effekt nicht bei jedem Render neu startet.
  const watched = fixtureIds.join(",");

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const board = await fetchLiveBoard(watched ? watched.split(",").map(Number) : [], signal);
      if (signal.aborted) return;
      setPollInterval(board.pollIntervalMs > 0 ? board.pollIntervalMs : LIVE_POLL_FALLBACK_MS);
      setState({ status: "ready", board, message: board.message });
    } catch (error) {
      if (signal.aborted || (error as DOMException).name === "AbortError") return;
      setState((previous) => ({
        status: "error",
        board: previous.board,
        message: (error as Error).message
      }));
    }
  }, [watched]);

  useEffect(() => {
    if (!active) {
      setState({ status: "idle", board: null, message: null });
      return;
    }
    const controller = new AbortController();
    setState((previous) => previous.board ? previous : { status: "loading", board: null, message: null });
    const run = () => {
      if (typeof globalThis.document !== "undefined" && globalThis.document.visibilityState === "hidden") return;
      void load(controller.signal);
    };
    run();
    const interval = window.setInterval(run, pollInterval);
    window.addEventListener("focus", run);
    globalThis.document?.addEventListener("visibilitychange", run);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", run);
      globalThis.document?.removeEventListener("visibilitychange", run);
    };
  }, [active, load, pollInterval]);

  return state;
}
