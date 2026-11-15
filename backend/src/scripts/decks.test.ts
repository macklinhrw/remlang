// @ts-ignore Bun test types live in the backend workspace, outside the app tsconfig.
import { describe, expect, test } from "bun:test";
import { parseArgs } from "./decks";

describe("deck CLI arguments", () => {
  test("parses edits and protects deletion", () => {
    expect(parseArgs(["edit", "Core", "Japanese", "--paused", "true"])).toMatchObject({
      command: "edit",
      target: "Core Japanese",
      paused: true,
    });
    expect(() => parseArgs(["delete", "Core Japanese"])).toThrow("--yes");
    expect(parseArgs(["cards", "add", "--deck", "Core", "--knowledge", "知識-1"])).toMatchObject({
      command: "cards",
      cardCommand: "add",
      deck: "Core",
      knowledge: "知識-1",
    });
    expect(() => parseArgs(["cards", "delete", "card-1"])).toThrow("--yes");
    expect(parseArgs(["reviews", "recent", "Core Japanese", "--limit", "25"])).toMatchObject({
      command: "reviews",
      reviewCommand: "recent",
      target: "Core Japanese",
      limit: 25,
    });
    expect(() => parseArgs(["reviews", "recent", "--limit", "0"])).toThrow("--limit");
  });
});
