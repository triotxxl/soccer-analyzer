import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ANALYSIS_CACHE_DIR, config } from "./config.ts";
import type { AnalysisInput } from "./types.ts";
import { datesForRange, normalizeText, sha256 } from "./util.ts";

export type AnalysisKind = "all" | "draw" | "favorites" | "goals";

interface SnapshotRecord<T> {
  storedAt: string;
  value: T;
}

function canonicalInput(input: AnalysisInput): object {
  return {
    dates: input.dates,
    resolvedDates: datesForRange(input.dates, config.timezone),
    markets: [...input.markets].sort(),
    selections: [...input.selections]
      .map((item) => ({
        country: normalizeText(item.country),
        league: normalizeText(item.league),
        tipicoCompetitionId: item.tipicoCompetitionId ?? null
      }))
      .sort((left, right) =>
        left.country.localeCompare(right.country) || left.league.localeCompare(right.league)
      ),
    matches: [...(input.matches ?? [])]
      .map((item) => ({
        homeTeam: normalizeText(item.homeTeam),
        awayTeam: normalizeText(item.awayTeam),
        tipicoEventId: item.tipicoEventId ?? null,
        tipicoCompetitionId: item.tipicoCompetitionId ?? null,
        tipicoHomeTeamId: item.tipicoHomeTeamId ?? null,
        tipicoAwayTeamId: item.tipicoAwayTeamId ?? null
      }))
      .sort((left, right) =>
        left.homeTeam.localeCompare(right.homeTeam) || left.awayTeam.localeCompare(right.awayTeam)
      ),
    tipicoOdds: [...(input.tipicoOdds ?? [])]
      .map((item) => ({ ...item }))
      .sort((left, right) =>
        normalizeText(left.homeTeam).localeCompare(normalizeText(right.homeTeam)) ||
        normalizeText(left.awayTeam).localeCompare(normalizeText(right.awayTeam))
      )
  };
}

export class AnalysisSnapshotCache {
  readonly directory: string;

  constructor(directory = ANALYSIS_CACHE_DIR) {
    this.directory = directory;
  }

  private fileFor(kind: AnalysisKind, input: AnalysisInput): string {
    const key = JSON.stringify({
      kind,
      input: canonicalInput(input),
      modelVersion: config.modelVersion,
      activeProfileVersion: config.activeProfileVersion,
      goalLineModelVersion: config.goalLineModelVersion
    });
    return path.join(this.directory, `${sha256(key)}.json`);
  }

  async get<T>(kind: AnalysisKind, input: AnalysisInput): Promise<T | null> {
    try {
      const record = JSON.parse(
        await readFile(this.fileFor(kind, input), "utf8")
      ) as SnapshotRecord<T>;
      return record.value ?? null;
    } catch {
      return null;
    }
  }

  async set<T>(kind: AnalysisKind, input: AnalysisInput, value: T): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const record: SnapshotRecord<T> = {
      storedAt: new Date().toISOString(),
      value
    };
    await writeFile(
      this.fileFor(kind, input),
      `${JSON.stringify(record)}\n`,
      "utf8"
    );
  }
}
