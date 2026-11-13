// Values of the student card shared by the server (validation) and the screens
// (labels). Pure data: no server code, so client components may import it.

export const LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
export type Level = (typeof LEVELS)[number];

export const STATUSES = ["discussion", "active", "paused", "finished"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  discussion: "Обсуждение",
  active: "Занимается",
  paused: "На паузе",
  finished: "Завершили",
};

/** "Завершили" is the archive: hidden from the default list. */
export const ACTIVE_STATUSES: readonly Status[] = ["discussion", "active", "paused"];

// The teacher's students live in different Russian time zones and in a few
// other countries (#18). Stored as IANA names; shown by these labels. A new
// country is one more line here.
export const TIME_ZONES = [
  { id: "Europe/Kaliningrad", label: "Калининград" },
  { id: "Europe/Moscow", label: "Москва" },
  { id: "Europe/Samara", label: "Самара" },
  { id: "Asia/Yekaterinburg", label: "Екатеринбург" },
  { id: "Asia/Omsk", label: "Омск" },
  { id: "Asia/Novosibirsk", label: "Новосибирск" },
  { id: "Asia/Irkutsk", label: "Иркутск" },
  { id: "Asia/Yakutsk", label: "Якутск" },
  { id: "Asia/Vladivostok", label: "Владивосток" },
  { id: "Asia/Magadan", label: "Магадан" },
  { id: "Asia/Kamchatka", label: "Камчатка" },
  { id: "Europe/Minsk", label: "Беларусь" },
  { id: "Asia/Almaty", label: "Казахстан" },
  { id: "Asia/Tashkent", label: "Узбекистан" },
  { id: "Asia/Bishkek", label: "Кыргызстан" },
  { id: "Asia/Yerevan", label: "Армения" },
  { id: "Asia/Tbilisi", label: "Грузия" },
  { id: "Asia/Baku", label: "Азербайджан" },
  { id: "Europe/Istanbul", label: "Турция" },
  { id: "Europe/Belgrade", label: "Сербия" },
  { id: "Asia/Nicosia", label: "Кипр" },
  { id: "Asia/Jerusalem", label: "Израиль" },
  { id: "Asia/Dubai", label: "ОАЭ" },
  { id: "Asia/Bangkok", label: "Таиланд" },
  { id: "Asia/Makassar", label: "Индонезия (Бали)" },
  { id: "Europe/Berlin", label: "Германия" },
] as const;

export type TimeZoneId = (typeof TIME_ZONES)[number]["id"];
export const TIME_ZONE_IDS = TIME_ZONES.map((zone) => zone.id) as [TimeZoneId, ...TimeZoneId[]];
export const DEFAULT_TIME_ZONE: TimeZoneId = "Europe/Moscow";

export function timeZoneLabel(id: string): string {
  return TIME_ZONES.find((zone) => zone.id === id)?.label ?? id;
}

/** A first name counts as missing when it has nothing but whitespace. It is stored as typed. */
export function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

// Profile of the student card (#41): plain text, no format checks, teacher
// only. Order and labels as on the card and in the edit form; "multiline"
// fields get a text area.
export const PROFILE_FIELDS = [
  { key: "age", label: "Возраст", multiline: false },
  { key: "schoolYear", label: "Класс", multiline: false },
  { key: "interests", label: "Интересы", multiline: true },
  { key: "whatWorks", label: "Что заходит", multiline: true },
  { key: "gaps", label: "Пробелы", multiline: true },
  { key: "textbook", label: "Учебник", multiline: false },
  { key: "currentUnit", label: "Текущий юнит", multiline: false },
] as const;

// Contacts (#84): all optional, the teacher's only.
export const CONTACT_FIELDS = [
  { key: "parentName", label: "ФИО родителя" },
  { key: "parentEmail", label: "Почта родителя" },
  { key: "parentMessenger", label: "Мессенджер родителя" },
  { key: "studentEmail", label: "Почта ученика" },
  { key: "studentMessenger", label: "Мессенджер ученика" },
] as const;

export type ContactKey = (typeof CONTACT_FIELDS)[number]["key"];
export const CONTACT_KEYS = CONTACT_FIELDS.map((field) => field.key) as ContactKey[];
export type Contacts = Record<ContactKey, string | null>;

export type ProfileKey = (typeof PROFILE_FIELDS)[number]["key"];
export type Profile = Record<ProfileKey, string | null>;
export const PROFILE_KEYS = PROFILE_FIELDS.map((field) => field.key) as ProfileKey[];
