import { describe, expect, it } from "vitest";
import type { LiveBoardMatch } from "../../shared/src/types";
import { blockedText } from "./liveQuestions";

const withState = (state: string) => ({ live: { state } }) as unknown as LiveBoardMatch;

describe("blockedText", () => {
  it("nennt bei Länderspielen den Grund statt „Stand unklar“ (seit 02.11.2026 ohne Live-Chance)", () => {
    expect(blockedText(withState("nationalTeams"))).toBe("Länderspiel – noch zu wenig geprüft, keine Live-Chance");
    expect(blockedText(withState("ok"))).toBeNull();
  });
});
