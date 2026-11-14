import { describe, expect, it } from "vitest";
import { parseTeacherInput } from "./teachers";

const valid = { TEACHER_NAME: " Учитель ", TEACHER_EMAIL: "Teacher@Example.Test", TEACHER_PASSWORD: "twelve-chars" };

describe("parseTeacherInput", () => {
  it("trims the name and lower-cases the email", () => {
    expect(parseTeacherInput(valid)).toEqual({
      ok: true,
      name: "Учитель",
      email: "teacher@example.test",
      password: "twelve-chars",
    });
  });

  it("names the missing and invalid variables without their values", () => {
    expect(parseTeacherInput({ TEACHER_EMAIL: "not-an-email", TEACHER_PASSWORD: "short" })).toEqual({
      ok: false,
      fields: ["TEACHER_NAME", "TEACHER_EMAIL", "TEACHER_PASSWORD"],
    });
  });

  it("rejects a password shorter than 12 characters", () => {
    expect(parseTeacherInput({ ...valid, TEACHER_PASSWORD: "eleven-char" })).toEqual({
      ok: false,
      fields: ["TEACHER_PASSWORD"],
    });
  });
});
