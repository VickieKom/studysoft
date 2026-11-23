// «Привлечение клиентов» (#337): values shared by the screens and the server
// validation. Plain data only.

/** Where a request came from. */
export const REQUEST_SOURCES = ["profi", "avito", "landing", "social", "other"] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];
export const REQUEST_SOURCE_LABELS: Record<RequestSource, string> = {
  profi: "Профи.ру",
  avito: "Авито",
  landing: "Лендинг",
  social: "Соцсеть",
  other: "Другое",
};

/**
 * The stages a request moves through by hand, in their order. «Стал
 * учеником» comes with #340, which creates the student's card.
 */
export const OPEN_STAGES = ["request", "intro_booked", "intro_held", "offer_sent"] as const;
export const REQUEST_STAGES = [...OPEN_STAGES, "declined"] as const;
export type RequestStage = (typeof REQUEST_STAGES)[number];
export const REQUEST_STAGE_LABELS: Record<RequestStage, string> = {
  request: "Заявка",
  intro_booked: "Вводный записан",
  intro_held: "Вводный проведён",
  offer_sent: "Оффер отправлен",
  declined: "Отказ",
};

/** Why a family said no, asked for by «Отказ». */
export const DECLINE_REASONS = ["expensive", "time", "other_teacher", "no_answer", "other"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];
export const DECLINE_REASON_LABELS: Record<DeclineReason, string> = {
  expensive: "Дорого",
  time: "Не подошло время",
  other_teacher: "Выбрали другого",
  no_answer: "Не ответили",
  other: "Другое",
};

export const MAX_REQUEST_NAME_LENGTH = 100;
export const MAX_REQUEST_CONTACT_LENGTH = 200;
export const MAX_REQUEST_SCHOOL_YEAR_LENGTH = 20;
export const MAX_DECLINE_COMMENT_LENGTH = 500;
