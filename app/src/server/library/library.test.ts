import { describe, expect, it } from "vitest";
import { isVideoLink, sniffVideo } from "./library";

// The file heads are synthetic: only the bytes a type is told by.

const isoBox = (brand: string) => Buffer.from(`\0\0\0\x18ftyp${brand}\0\0\0\0isommp41`, "latin1");
const ebml = (docType: string) =>
  Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84]), Buffer.from(docType, "latin1")]);

describe("sniffVideo", () => {
  it("names MP4, MOV and WebM by their first bytes", () => {
    expect(sniffVideo(isoBox("isom"))).toBe("video/mp4");
    expect(sniffVideo(isoBox("mp42"))).toBe("video/mp4");
    expect(sniffVideo(isoBox("qt  "))).toBe("video/quicktime");
    expect(sniffVideo(Buffer.from("\0\0\0\x08wide\0\0\0\0mdat", "latin1"))).toBe("video/quicktime");
    expect(sniffVideo(ebml("webm"))).toBe("video/webm");
  });

  it("refuses FLV, other Matroska, sound alone, pictures and anything else", () => {
    expect(sniffVideo(Buffer.from([0x46, 0x4c, 0x56, 0x01, 0x05, 0, 0, 0, 0x09]))).toBeNull();
    expect(sniffVideo(ebml("matroska"))).toBeNull();
    expect(sniffVideo(isoBox("M4A "))).toBeNull();
    expect(sniffVideo(isoBox("heic"))).toBeNull();
    expect(sniffVideo(Buffer.from("RIFF\0\0\0\0AVI LIST", "latin1"))).toBeNull();
    expect(sniffVideo(new Uint8Array())).toBeNull();
  });
});

describe("isVideoLink", () => {
  it("takes http and https addresses with a host", () => {
    expect(isVideoLink("https://video.example.test/watch?v=1")).toBe(true);
    expect(isVideoLink("http://video.example.test/clip")).toBe(true);
  });

  it("refuses other schemes, text that is not an address and an address that is too long", () => {
    for (const text of ["javascript:alert(1)", "data:text/html,hi", "ftp://files.example.test/a", "video.example.test", "", "https://"]) {
      expect(isVideoLink(text)).toBe(false);
    }
    expect(isVideoLink(`https://video.example.test/${"a".repeat(2000)}`)).toBe(false);
  });
});
