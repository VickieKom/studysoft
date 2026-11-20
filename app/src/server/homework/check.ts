// Checking answers on the server (#34; architecture 6.1). The keys stay here:
// the student's page gets only studentView() and sends answers back.
import { type Answer, gapCount, matchLeftLabel, type OrderSentence, type OrderTask, orderSentences, type Task } from "../../domain/homework-format";

// Every apostrophe a keyboard or a phone may produce counts as the plain one.
const APOSTROPHES = /[‘’ʼʹ`´′]/g;

/** Typed answers are compared ignoring case, extra spaces and the kind of apostrophe. */
export function normalize(value: string): string {
  return value.replace(APOSTROPHES, "'").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Whether an answer is right. An answer of another type, or a partial one, is wrong. */
export function checkAnswer(task: Task, answer: Answer): boolean {
  switch (task.type) {
    case "single_choice":
      return answer.type === "single_choice" && answer.choice === task.answer;
    case "multiple_choice":
      return answer.type === "multiple_choice" && sameSet(answer.choices, task.answers);
    case "gap":
      return (
        answer.type === "gap" &&
        answer.gaps.length === task.answers.length &&
        task.answers.every((variants, i) => variants.some((v) => normalize(v) === normalize(answer.gaps[i] ?? "")))
      );
    case "match": {
      if (answer.type !== "match" || answer.pairs.length !== task.pairs.length) return false;
      const key = new Set(task.pairs.map((p, i) => `${matchLeftLabel(p.left, i)}\u0000${p.right}`));
      const given = new Set(answer.pairs.map((p) => `${p.left}\u0000${p.right}`));
      return given.size === key.size && [...given].every((pair) => key.has(pair));
    }
    case "order":
      return answer.type === "order" && checkSentences(task, answer).every(Boolean);
    case "written":
    case "voice":
    case "file":
      return false;
  }
}

const rightOrder = (sentence: OrderSentence, words: string[] | undefined) => {
  const given = normalize((words ?? []).join(" "));
  return [sentence.words, ...(sentence.alternatives ?? [])].some((order) => normalize(order.join(" ")) === given);
};

/**
 * Each sentence of an order task right or wrong (#161), in the task's order:
 * one for a task with `words`, one per sentence for a task of several. An
 * answer of the other shape, or a sentence left out, is wrong.
 */
export function checkSentences(task: OrderTask, answer: Extract<Answer, { type: "order" }> | null): boolean[] {
  const sentences = orderSentences(task);
  if (task.sentences) return sentences.map((sentence, i) => rightOrder(sentence, answer?.sentences?.[i]));
  return [answer?.words !== undefined && rightOrder(sentences[0]!, answer.words)];
}

/** Whether every word placed is one of the given words, each used at most as often as it is there. */
function takenFrom(words: string[], placed: string[]): boolean {
  const left = [...words];
  return placed.every((word) => {
    const at = left.indexOf(word);
    if (at < 0) return false;
    left.splice(at, 1);
    return true;
  });
}

/**
 * Whether an answer can belong to the task at all: the same type, choices
 * within the options, as many gaps as the text has, pairs and words taken
 * from the task. A save that does not fit is refused, so nothing but answers
 * is stored.
 */
export function fitsTask(task: Task, answer: Answer): boolean {
  if (answer.type !== task.type) return false;
  switch (answer.type) {
    case "single_choice":
      return task.type === "single_choice" && answer.choice < task.options.length;
    case "multiple_choice":
      return (
        task.type === "multiple_choice" &&
        new Set(answer.choices).size === answer.choices.length &&
        answer.choices.every((c) => c < task.options.length)
      );
    case "gap":
      // A gap with its own options takes one of them, or nothing yet (#128).
      return (
        task.type === "gap" &&
        answer.gaps.length === gapCount(task.text) &&
        answer.gaps.every((value, i) => {
          const own = task.choices?.[i];
          return !own || value === "" || own.includes(value);
        })
      );
    case "match": {
      if (task.type !== "match") return false;
      const lefts = new Set(task.pairs.map((p, i) => matchLeftLabel(p.left, i)));
      const rights = new Set(task.pairs.map((p) => p.right));
      const usedLeft = new Set(answer.pairs.map((p) => p.left));
      return (
        usedLeft.size === answer.pairs.length && answer.pairs.every((p) => lefts.has(p.left) && rights.has(p.right))
      );
    }
    case "written":
      return task.type === "written";
    case "order": {
      if (task.type !== "order") return false;
      if (task.sentences)
        return (
          answer.sentences?.length === task.sentences.length &&
          task.sentences.every((sentence, i) => takenFrom(sentence.words, answer.sentences![i]!))
        );
      return answer.words !== undefined && takenFrom(task.words ?? [], answer.words);
    }
  }
}
