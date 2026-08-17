import type { GoalLineAnalysisResult } from "./types.ts";

export interface GoalLineFilters {
  minimumConfidence: number | null;
  minimumOver15: number | null;
  minimumOver25: number | null;
  minimumOver35: number | null;
  minimumFirstHalfOver05: number | null;
  minimumFirstHalfOver15: number | null;
}

export function applyGoalLineFilters(
  result: GoalLineAnalysisResult,
  filters: GoalLineFilters
): GoalLineAnalysisResult {
  return {
    ...result,
    rows: result.rows.filter((row) =>
      (filters.minimumConfidence === null || row.dataConfidence >= filters.minimumConfidence) &&
      (filters.minimumOver15 === null || row.probabilities.over15 >= filters.minimumOver15) &&
      (filters.minimumOver25 === null || row.probabilities.over25 >= filters.minimumOver25) &&
      (filters.minimumOver35 === null || row.probabilities.over35 >= filters.minimumOver35) &&
      (filters.minimumFirstHalfOver05 === null || row.firstHalf.probabilities.over05 >= filters.minimumFirstHalfOver05) &&
      (filters.minimumFirstHalfOver15 === null || row.firstHalf.probabilities.over15 >= filters.minimumFirstHalfOver15)
    )
  };
}
