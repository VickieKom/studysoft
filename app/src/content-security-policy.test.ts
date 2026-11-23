import { describe, expect, it } from "vitest";
import config, { PAGE_CONTENT_SECURITY_POLICY } from "../next.config";
import { YOUTUBE_EMBED_ORIGIN } from "./domain/library";

// The pages' content security policy (#325): frames from the platform and
// from the embedded YouTube player only, nothing else new.

describe("the pages' content security policy", () => {
  it("allows frames from the platform and youtube-nocookie.com, and sets nothing else", () => {
    const directives = PAGE_CONTENT_SECURITY_POLICY.split(";").map((d) => d.trim().split(/\s+/));
    expect(directives).toEqual([["frame-src", "'self'", YOUTUBE_EMBED_ORIGIN]]);
  });

  it("is sent with every page, not with the entry points under /api/", async () => {
    const rules = await config.headers!();
    expect(rules).toEqual([{ source: "/((?!api/).*)", headers: [{ key: "Content-Security-Policy", value: PAGE_CONTENT_SECURITY_POLICY }] }]);
    const matches = (path: string) => new RegExp(`^${rules[0]!.source.replace(/^\//, "/")}$`).test(path);
    for (const page of ["/", "/s", "/s/videos/00000000-0000-4000-8000-000000000000", "/teacher/library", "/stage"]) expect(matches(page), page).toBe(true);
    for (const entry of ["/api/files/library/00000000-0000-4000-8000-000000000000", "/api/trpc/teacher.session.me", "/api/healthz"]) {
      expect(matches(entry), entry).toBe(false);
    }
  });
});
