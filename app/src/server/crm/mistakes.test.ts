import { describe, expect, it } from "vitest";
import { groupByTopic } from "./mistakes";

const at = (day: number) => new Date(Date.UTC(2026, 10, day));
const mistake = (topic: string | null, day: number, from: "homework" | "game" = "homework") => ({
  topic,
  from,
  title: `${from} ${day}`,
  at: at(day),
  task: `task ${day}`,
  answer: null,
});

describe("one list of mistakes by topic", () => {
  it("puts the topic with the most first, then the one with the latest mistake; inside, newest first", () => {
    const list = groupByTopic([
      mistake("to be", 3),
      mistake("animals", 1, "game"),
      mistake("animals", 5),
      mistake("colours", 4, "game"),
    ]);
    expect(list.map((t) => [t.topic, t.count])).toEqual([
      ["animals", 2],
      ["colours", 1],
      ["to be", 1],
    ]);
    expect(list[0]!.mistakes.map((m) => m.title)).toEqual(["homework 5", "game 1"]);
  });

  it("puts mistakes without a topic under «Без темы», and gives nothing for no mistakes", () => {
    expect(groupByTopic([mistake(null, 2, "game")]).map((t) => t.topic)).toEqual(["Без темы"]);
    expect(groupByTopic([])).toEqual([]);
  });
});
