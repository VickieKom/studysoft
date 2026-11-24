/**
 * The assessment's answers on their way to the server (#253): saved one
 * after another, so a later answer never lands first, and remembered when a
 * save fails until it is sent again and kept. «Сдать» first sends again what
 * failed and submits only when nothing is left unsaved: a lost answer would
 * be scored wrong for good.
 */
export type QueuedAnswer<S extends string = string> = { skill: S; index: number; value: string | null };

export function answerQueue<S extends string>(
  save: (answer: QueuedAnswer<S>) => Promise<unknown>,
  on: { saved: (key: string, answer: QueuedAnswer<S>) => void; failed: () => void },
) {
  let queue: Promise<unknown> = Promise.resolve();
  /** The latest answer per question that the server has not kept. */
  const unsaved = new Map<string, QueuedAnswer<S>>();
  const keyOf = (answer: QueuedAnswer<S>) => `${answer.skill}:${answer.index}`;

  function send(answer: QueuedAnswer<S>) {
    const key = keyOf(answer);
    unsaved.set(key, answer);
    queue = queue
      .then(() => save(answer))
      .then(
        () => {
          // Kept: no longer unsaved, unless a newer answer to the same question is.
          if (unsaved.get(key) === answer) unsaved.delete(key);
          on.saved(key, answer);
        },
        () => on.failed(),
      );
  }

  return {
    send,
    /** Waits for every save sent so far. */
    settled: () => queue.then(() => undefined),
    /**
     * Sends again every answer not kept, and those given (`more`, from a
     * reload) — then true when all of them are saved.
     */
    async saveAll(more: QueuedAnswer<S>[] = []): Promise<boolean> {
      // Saves in flight end first; only what is still not kept goes again.
      await queue;
      for (const answer of more) if (!unsaved.has(keyOf(answer))) unsaved.set(keyOf(answer), answer);
      for (const answer of [...unsaved.values()]) send(answer);
      await queue;
      return unsaved.size === 0;
    },
  };
}
