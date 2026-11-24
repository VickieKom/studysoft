import { describe, expect, it } from "vitest";
import { answerQueue, type QueuedAnswer } from "./answer-queue";

// «Сдать» on the assessment (#253): an answer whose save failed is sent
// again before submitting, and nothing is submitted while one stays unsaved.

function server() {
  const kept = new Map<string, string | null>();
  let down = false;
  const calls: QueuedAnswer[] = [];
  const save = async (answer: QueuedAnswer) => {
    calls.push(answer);
    if (down) throw new Error("offline");
    kept.set(`${answer.skill}:${answer.index}`, answer.value);
  };
  return { kept, calls, save, setDown: (value: boolean) => (down = value) };
}

const events = () => ({ saved: () => undefined, failed: () => undefined });

describe("the assessment's answer queue", () => {
  it("sends a failed answer again before «Сдать», then reports everything saved", async () => {
    const api = server();
    const queue = answerQueue(api.save, events());
    queue.send({ skill: "reading", index: 0, value: "a" });
    api.setDown(true);
    queue.send({ skill: "reading", index: 1, value: "b" });
    await queue.settled();
    expect(api.kept.has("reading:1")).toBe(false);

    // The connection comes back before «Сдать».
    api.setDown(false);
    expect(await queue.saveAll()).toBe(true);
    expect(api.kept.get("reading:1")).toBe("b");
  });

  it("refuses to report saved while a save still fails", async () => {
    const api = server();
    const queue = answerQueue(api.save, events());
    api.setDown(true);
    queue.send({ skill: "grammar", index: 0, value: "x" });
    expect(await queue.saveAll()).toBe(false);
    expect(api.kept.size).toBe(0);
  });

  it("keeps the newer answer, not a failed older one, and saves what a reload left", async () => {
    const api = server();
    const queue = answerQueue(api.save, events());
    api.setDown(true);
    queue.send({ skill: "grammar", index: 0, value: "old" });
    await queue.settled();
    api.setDown(false);
    queue.send({ skill: "grammar", index: 0, value: "new" });
    expect(await queue.saveAll([{ skill: "listening", index: 2, value: "c" }])).toBe(true);
    expect(api.kept.get("grammar:0")).toBe("new");
    expect(api.kept.get("listening:2")).toBe("c");
    // The failed older answer is not sent after the newer one.
    expect(api.calls.filter((c) => c.skill === "grammar").map((c) => c.value)).toEqual(["old", "new"]);
  });
});
