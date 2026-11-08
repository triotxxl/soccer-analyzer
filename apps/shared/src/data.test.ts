import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDashboardData } from "./data";

function dashboard(createdAt: string) {
  return { schemaVersion: 14, meta: { createdAt, timezone: "Europe/Berlin" }, fixtures: [] };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useDashboardData", () => {
  it("fragt mit dem ETag nach und behält bei 304 denselben Zustand", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const sent = (init?.headers as Record<string, string> | undefined)?.["If-None-Match"];
      return Promise.resolve(sent === "\"1-1\""
        ? new Response(null, { status: 304 })
        : new Response(JSON.stringify(dashboard("2026-11-03T10:00:00.000Z")), { status: 200, headers: { ETag: "\"1-1\"" } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDashboardData(50));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const first = result.current;

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3));
    // Ab der zweiten Abfrage mit Kennung - und der Zustand ist noch genau dasselbe Objekt.
    expect((fetchMock.mock.calls[1]![1]?.headers as Record<string, string>)["If-None-Match"]).toBe("\"1-1\"");
    expect(result.current).toBe(first);
  });

  it("behält den Zustand auch ohne ETag, solange dieselbe Analyse kommt", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(dashboard("2026-11-03T10:00:00.000Z")), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDashboardData(50));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const first = result.current;
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(result.current).toBe(first);
  });

  it("übernimmt eine neue Analyse", async () => {
    let createdAt = "2026-11-03T10:00:00.000Z";
    let etag = "\"1-1\"";
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      const sent = (init?.headers as Record<string, string> | undefined)?.["If-None-Match"];
      return Promise.resolve(sent === etag
        ? new Response(null, { status: 304 })
        : new Response(JSON.stringify(dashboard(createdAt)), { status: 200, headers: { ETag: etag } }));
    }));
    const { result } = renderHook(() => useDashboardData(50));
    await waitFor(() => expect(result.current.document?.meta.createdAt).toBe("2026-11-03T10:00:00.000Z"));
    act(() => {
      createdAt = "2026-11-03T16:00:00.000Z";
      etag = "\"2-2\"";
    });
    await waitFor(() => expect(result.current.document?.meta.createdAt).toBe("2026-11-03T16:00:00.000Z"));
  });
});
