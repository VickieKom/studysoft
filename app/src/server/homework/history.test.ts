import { describe, expect, it } from "vitest";
import { matchStudent, readHistory } from "./history";

const students = [
  { id: "a", firstName: "Тестовый", lastName: "Тестов" },
  { id: "b", firstName: "Пробная", lastName: "Иванова" },
  { id: "c", firstName: "Пробная", lastName: "Петрова" },
  { id: "d", firstName: "Одинокий", lastName: null },
];

const HEADER = "student,submitted_on,homework,task,type,question,answer,correct_answer,result,topic";

describe("matchStudent", () => {
  it("takes the full name, the initial with or without a dot, and a unique first name, whatever the case and spaces", () => {
    for (const name of ["Тестовый Тестов", "Тестовый Т.", "тестовый т", "  Тестовый   Т. ", "Тестовый"]) {
      expect(matchStudent(name, students)).toEqual({ id: "a" });
    }
    expect(matchStudent("Одинокий", students)).toEqual({ id: "d" });
    expect(matchStudent("Пробная П.", students)).toEqual({ id: "c" });
  });

  it("calls a first name shared by two students ambiguous and an unknown name unknown", () => {
    expect(matchStudent("Пробная", students)).toBe("ambiguous");
    expect(matchStudent("Неизвестный Н.", students)).toBe("unknown");
    expect(matchStudent("Тестовый Х.", students)).toBe("unknown");
  });
});

describe("readHistory", () => {
  it("reads valid rows and names the line of every one it cannot take", () => {
    const csv = [
      HEADER,
      "Тестовый Т.,2026-11-03,Demo 1,1,single_choice,Pick the colour of the sky,blue,blue,correct,colours",
      "Тестовый Т.,2026-11-03,Demo 1,2,written,Write two sentences,,,,",
      "Неизвестный Н.,2026-11-03,Demo 1,1,gap,I ___ a student.,is,am,wrong,to be",
      "Тестовый Т.,2026-11-31,Demo 2,1,gap,I ___ a student.,is,am,wrong,to be",
      "Тестовый Т.,2026-11-03,Demo 1,0,gap,I ___ a student.,is,am,wrong,to be",
      "Тестовый Т.,2026-11-03,Demo 1,3,riddle,I ___ a student.,is,am,wrong,to be",
      "Тестовый Т.,2026-11-03,Demo 1,4,gap,I ___ a student.,is,am,maybe,to be",
      "Пробная,2026-11-03,Demo 1,1,unknown,Something,,,,",
    ].join("\n");
    const { rows, errors } = readHistory(csv, students);
    expect(rows).toEqual([
      {
        line: 2,
        studentId: "a",
        submittedOn: "2026-11-03",
        title: "Demo 1",
        taskNumber: 1,
        type: "single_choice",
        question: "Pick the colour of the sky",
        answer: "blue",
        correctAnswer: "blue",
        correct: true,
        topic: "colours",
      },
      {
        line: 3,
        studentId: "a",
        submittedOn: "2026-11-03",
        title: "Demo 1",
        taskNumber: 2,
        type: "written",
        question: "Write two sentences",
        answer: null,
        correctAnswer: null,
        correct: null,
        topic: null,
      },
    ]);
    expect(errors).toEqual([
      "Строка 4: ученик «Неизвестный Н.» не найден",
      "Строка 5: дата «2026-11-31» — нужна существующая дата в виде ГГГГ-ММ-ДД",
      "Строка 6: номер задания «0» — нужно число от 1 до 200",
      "Строка 7: тип задания «riddle» — нужен один из типов формата домашки или unknown",
      "Строка 8: результат «maybe» — нужно correct, wrong или пусто",
      "Строка 9: ученику «Пробная» подходят несколько учеников",
    ]);
  });

  it("takes the columns in any order and refuses a file without them", () => {
    const reordered = "topic,result,correct_answer,answer,question,type,task,homework,submitted_on,student\n" +
      "colours,correct,blue,blue,Sky,single_choice,1,Demo 1,2026-11-03,Тестовый Т.";
    expect(readHistory(reordered, students).rows).toHaveLength(1);
    expect(readHistory("name,date\nТестовый,2026-11-03", students)).toEqual({
      rows: [],
      errors: [expect.stringMatching(/^Нет столбцов: student, submitted_on/)],
    });
  });
});
