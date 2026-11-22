// «Из словаря» in a homework draft (#281): tasks built from the student's
// words with a confirmed translation, their keys set here. Every task names
// the words it asks in `vocabularyWords` (not `words`, which an order task has for its own words), which the student never receives. Plain
// data and pure functions only.
import type { Task } from "./homework-format";
import { CHOICE_OPTIONS, GAP, gapSentence } from "./word-training";

export const VOCABULARY_TASK_TYPES = ["match", "choose_translation", "fill_gap", "type_word"] as const;
export type VocabularyTaskType = (typeof VOCABULARY_TASK_TYPES)[number];
export const VOCABULARY_TASK_LABELS: Record<VocabularyTaskType, string> = {
  match: "Сопоставление",
  choose_translation: "Выбрать перевод",
  fill_gap: "Вставить в пример",
  type_word: "Написать слово",
};

/** How many words are ticked at first: the last lesson's, then the weak ones. */
export const PICKED_WORDS = 12;
/** The most pairs in one matching task; more words make more tasks. */
export const MATCH_PAIRS = 8;
export const MATCH_PROMPT = "Соедини слово и перевод";
export const choicePrompt = (word: string) => `Как переводится «${word}»?`;
export const GAP_PROMPT = "Вставь слово в предложение";
export const typePrompt = (translation: string) => `Напиши по-английски: «${translation}»`;
/** How many chosen words have no example that uses them as they are, said under «Вставить в пример» (#283). */
export const withoutExample = (missing: number, chosen: number) => `Без примера со словом: ${missing} из ${chosen}`;
export const TOO_FEW_FOR_CHOICE = `Нужно хотя бы ${CHOICE_OPTIONS} слова с переводом`;

/** A word to build tasks from; `example` is the confirmed one, needed for «Вставить в пример» (#283). */
export type PickWord = { id: string; word: string; translation: string; example?: string | null };

/** Matching needs two words. */
export const canMatch = (chosen: PickWord[]) => chosen.length >= 2;

/** A choice of translation needs as many different translations among all the student's words as there are options. */
export const canChooseTranslation = (pool: PickWord[]) => distinctTranslations(pool).length >= CHOICE_OPTIONS;

const same = (a: string, b: string) => a.trim().toLocaleLowerCase("ru") === b.trim().toLocaleLowerCase("ru");

function distinctTranslations(words: PickWord[]): string[] {
  const seen: string[] = [];
  for (const w of words) if (!seen.some((t) => same(t, w.translation))) seen.push(w.translation);
  return seen;
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Splits the words into matching tasks of at most MATCH_PAIRS, as even as can be: 9 words are 5 and 4, never 8 and 1. */
function matchGroups(words: PickWord[]): PickWord[][] {
  const count = Math.ceil(words.length / MATCH_PAIRS);
  const size = Math.ceil(words.length / count);
  const groups: PickWord[][] = [];
  for (let i = 0; i < words.length; i += size) groups.push(words.slice(i, i + size));
  return groups;
}

function matchTask(group: PickWord[]): Task {
  return {
    type: "match",
    prompt: MATCH_PROMPT,
    pairs: group.map((w) => ({ left: w.word, right: w.translation })),
    skill: "vocabulary",
    vocabularyWords: group.map((w) => w.id),
  };
}

/** The word's translation among three others of the student's, in a random order. */
function choiceTask(word: PickWord, pool: PickWord[], random: () => number): Task {
  const others = shuffled(
    distinctTranslations(pool.filter((w) => w.id !== word.id)).filter((t) => !same(t, word.translation)),
    random,
  ).slice(0, CHOICE_OPTIONS - 1);
  const options = shuffled([word.translation, ...others], random);
  return { type: "single_choice", prompt: choicePrompt(word.word), options, answer: options.indexOf(word.translation), skill: "vocabulary", vocabularyWords: [word.id] };
}

/** The word's example with the word as a gap, or null when the example does not use it as it is. */
export const gapOf = (word: PickWord) => gapSentence(word.example ?? null, word.word);

/** The word typed into its example's gap; the check ignores letter case and extra spaces. */
function gapTask(word: PickWord, sentence: string): Task {
  return { type: "gap", prompt: GAP_PROMPT, text: sentence, answers: [[word.word]], skill: "vocabulary", vocabularyWords: [word.id] };
}

/** The word typed from its translation. */
function typeTask(word: PickWord): Task {
  return { type: "gap", prompt: typePrompt(word.translation), text: GAP, answers: [[word.word]], skill: "vocabulary", vocabularyWords: [word.id] };
}

/**
 * The tasks for the chosen words: the matching ones first, then a choice of
 * translation per word, a gap in the example of each word used in it, and
 * the word written from its translation. A type that cannot be built (too few words) is left
 * out; the screen says so before. `pool` is all the student's words with a
 * translation, where the wrong options come from.
 */
export function vocabularyTasks(chosen: PickWord[], pool: PickWord[], types: VocabularyTaskType[], random: () => number = Math.random): Task[] {
  const tasks: Task[] = [];
  if (types.includes("match") && canMatch(chosen)) tasks.push(...matchGroups(chosen).map(matchTask));
  if (types.includes("choose_translation") && canChooseTranslation(pool)) tasks.push(...chosen.map((w) => choiceTask(w, pool, random)));
  if (types.includes("fill_gap")) {
    for (const w of chosen) {
      const sentence = gapOf(w);
      if (sentence) tasks.push(gapTask(w, sentence));
    }
  }
  if (types.includes("type_word")) tasks.push(...chosen.map(typeTask));
  return tasks;
}

/** The word ids every task names. */
export const taskWordIds = (tasks: Task[]) => [...new Set(tasks.flatMap((t) => t.vocabularyWords ?? []))];

/**
 * The tasks with only the words in `known`: a word deleted from the
 * vocabulary, or not this student's, leaves the task, which stays.
 */
export function withKnownWords(tasks: Task[], known: Set<string>): Task[] {
  return tasks.map((task) => {
    if (!task.vocabularyWords) return task;
    const { vocabularyWords, ...rest } = task;
    const kept = vocabularyWords.filter((id) => known.has(id));
    return (kept.length > 0 ? { ...rest, vocabularyWords: kept } : rest) as Task;
  });
}
