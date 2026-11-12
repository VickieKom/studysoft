import { describe, expect, it } from "vitest";
import { fragmentedMp4Recording, mp4Recording, webmRecording } from "../testing/media";
import { sniffMedia, voiceDuration } from "./media";

// The recordings are synthetic containers built in src/server/testing/media.ts.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

describe("sniffMedia", () => {
  it("names the type by the first bytes", () => {
    expect(sniffMedia(PNG)).toEqual({ contentType: "image/png", kind: "image" });
    expect(sniffMedia(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ contentType: "image/jpeg", kind: "image" });
    expect(sniffMedia(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))?.contentType).toBe("image/webp");
    expect(sniffMedia(Buffer.from("RIFF\0\0\0\0WAVEfmt ", "latin1"))?.contentType).toBe("audio/wav");
    expect(sniffMedia(webmRecording(1))?.contentType).toBe("audio/webm");
    expect(sniffMedia(mp4Recording(1))?.contentType).toBe("audio/mp4");
    expect(sniffMedia(Buffer.from("OggS\0\x02", "latin1"))?.contentType).toBe("audio/ogg");
    expect(sniffMedia(Buffer.from("ID3\x04\0\0", "latin1"))?.contentType).toBe("audio/mpeg");
    expect(sniffMedia(Buffer.from([0xff, 0xfb, 0x90, 0x00]))?.contentType).toBe("audio/mpeg");
  });

  it("refuses anything else, an HEIF photo and a GIF included", () => {
    expect(sniffMedia(Buffer.from("\0\0\0\x18ftypheic\0\0\0\0", "latin1"))).toBeNull();
    expect(sniffMedia(Buffer.from("GIF89a", "latin1"))).toBeNull();
    expect(sniffMedia(Buffer.from("%PDF-1.7", "latin1"))).toBeNull();
    expect(sniffMedia(new Uint8Array())).toBeNull();
  });
});

describe("voiceDuration", () => {
  it("reads a WebM written while recording, without a duration in its header", () => {
    expect(voiceDuration(webmRecording(1.5), "audio/webm")).toBeCloseTo(1.5);
    expect(voiceDuration(webmRecording(299.5), "audio/webm")).toBeCloseTo(299.5);
    expect(voiceDuration(webmRecording(6 * 60), "audio/webm")).toBeCloseTo(360);
  });

  it("reads an MP4 by its movie header, or by its fragments when the header says 0", () => {
    expect(voiceDuration(mp4Recording(42), "audio/mp4")).toBeCloseTo(42);
    expect(voiceDuration(fragmentedMp4Recording(30), "audio/mp4")).toBeCloseTo(30, 1);
    expect(voiceDuration(fragmentedMp4Recording(6 * 60), "audio/mp4")).toBeCloseTo(360, 1);
  });

  it("counts what is there in a recording cut off at the end", () => {
    const whole = webmRecording(20);
    expect(voiceDuration(whole.subarray(0, whole.length - 10), "audio/webm")).toBeCloseTo(19);
  });

  it("gives null for bytes it cannot read", () => {
    expect(voiceDuration(PNG, "audio/webm")).toBeNull();
    expect(voiceDuration(PNG, "audio/mp4")).toBeNull();
    expect(voiceDuration(webmRecording(1), "audio/ogg")).toBeNull();
  });
});
