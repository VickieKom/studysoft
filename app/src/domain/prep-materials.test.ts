import { describe, expect, it } from "vitest";
import { type PrepMaterial, prepMaterialGroups } from "./prep-materials";

// The order of the library's games in a lesson prep (#293). The materials are synthetic.

const m = (id: string, kind: string, forStudent = false, textbookLessonId: string | null = null): PrepMaterial => ({ id, kind, title: id, forStudent, textbookLessonId });

describe("the library's materials in a lesson prep", () => {
  it("come for the student, then for the plan's book lessons, then the rest, each in the order given", () => {
    const materials = [m("a-plain", "game"), m("b-lesson", "game", false, "L2"), m("c-student", "game", true), m("d-other-lesson", "game", false, "L9"), m("e-warmup", "warmup", true, "L2")];
    const groups = prepMaterialGroups(materials, ["L2"]);
    expect(groups.forStudent.map((x) => x.id)).toEqual(["c-student"]);
    expect(groups.forLessons.map((x) => x.id)).toEqual(["b-lesson"]);
    // A warm-up keeps its place among the rest, whatever its marks.
    expect(groups.rest.map((x) => x.id)).toEqual(["a-plain", "d-other-lesson", "e-warmup"]);
  });

  it("lists a game for the student and for a plan's lesson once, in the first group", () => {
    const groups = prepMaterialGroups([m("both", "game", true, "L1")], ["L1"]);
    expect(groups).toEqual({ forStudent: [m("both", "game", true, "L1")], forLessons: [], rest: [] });
  });

  it("puts a lesson's game with the rest when the lesson is not in the plan", () => {
    expect(prepMaterialGroups([m("g", "game", false, "L1")], []).rest.map((x) => x.id)).toEqual(["g"]);
  });
});
