import { describe, expect, it } from "vitest";
import type { Task } from "./homework-format";
import { playedVideo, sameVideo, startsVideo } from "./homework-video";

// A video in homework (#330): tasks about one video in a row show it once,
// above the first of them; a link plays embedded when it is YouTube's.

const A = "0b7c1a52-59f4-4a53-9a2a-6c8b3f0d1e21";
const B = "6f1d2e3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f";
const task = (video?: Task["video"]): Task => ({ type: "written", prompt: "Write.", ...(video ? { video } : {}) });

describe("a video in homework", () => {
  it("is shown above the first task of a run about it, again after another video or none", () => {
    const tasks = [task(), task({ library: A }), task({ library: A }), task({ library: B }), task(), task({ library: B })];
    expect(tasks.map((_, i) => startsVideo(tasks, i))).toEqual([false, true, false, true, false, true]);
  });

  it("tells videos apart by library id or by link", () => {
    expect(sameVideo({ library: A }, { library: A })).toBe(true);
    expect(sameVideo({ library: A }, { library: B })).toBe(false);
    expect(sameVideo({ url: "https://a.test/v" }, { url: "https://a.test/v" })).toBe(true);
    expect(sameVideo({ url: "https://a.test/v" }, { library: A })).toBe(false);
    expect(sameVideo(undefined, { library: A })).toBe(false);
  });

  it("plays a library video as the library has it, a YouTube link embedded and another link to open", () => {
    const library = { [A]: { title: "Clip", file: `/api/files/library/${A}` } };
    expect(playedVideo({ library: A }, library)).toEqual({ title: "Clip", file: `/api/files/library/${A}` });
    expect(playedVideo({ library: B }, library)).toBeUndefined();
    expect(playedVideo({ url: "https://youtu.be/dQw4w9WgXcQ" }, library)).toEqual({ title: "Видео", embed: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
    expect(playedVideo({ url: "https://video.example.test/robot" }, library)).toEqual({ title: "Видео", link: "https://video.example.test/robot" });
  });
});
