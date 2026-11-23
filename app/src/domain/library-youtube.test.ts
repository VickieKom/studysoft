import { describe, expect, it } from "vitest";
import { youTubeEmbedUrl, youTubeId } from "./library";

// A YouTube link plays in an embedded player (#325). The ids are synthetic.

describe("a YouTube link", () => {
  it("is a video in its three forms, over https or http, with or without www and extra parameters", () => {
    expect(youTubeId("https://www.youtube.com/watch?v=demoPlanet1")).toBe("demoPlanet1");
    expect(youTubeId("https://youtube.com/watch?v=demoPlanet1&t=42s&list=PLdemo")).toBe("demoPlanet1");
    expect(youTubeId("http://m.youtube.com/watch?v=demo_Plan-1")).toBe("demo_Plan-1");
    expect(youTubeId("https://youtu.be/demoColour2")).toBe("demoColour2");
    expect(youTubeId("https://youtu.be/demoColour2?si=abc")).toBe("demoColour2");
    expect(youTubeId("https://www.youtube.com/shorts/demoAnimal3")).toBe("demoAnimal3");
    expect(youTubeId("https://WWW.YOUTUBE.COM/shorts/demoAnimal3/")).toBe("demoAnimal3");
  });

  it("plays from youtube-nocookie.com", () => {
    expect(youTubeEmbedUrl("https://youtu.be/demoColour2")).toBe("https://www.youtube-nocookie.com/embed/demoColour2");
  });

  it("is not a video when it is a channel, a playlist, a malformed id or another site", () => {
    for (const link of [
      "https://www.youtube.com/@demochannel",
      "https://www.youtube.com/playlist?list=PLdemo",
      "https://www.youtube.com/watch",
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/watch?v=demoPlanet1%22onload",
      "https://youtu.be/",
      "https://www.youtube.com.example.test/watch?v=demoPlanet1",
      "https://notyoutube.com/watch?v=demoPlanet1",
      "https://video.example.test/watch?v=demoPlanet1",
      "ftp://youtu.be/demoColour2",
      "not a link",
    ]) {
      expect(youTubeId(link), link).toBeNull();
      expect(youTubeEmbedUrl(link), link).toBeNull();
    }
  });
});
