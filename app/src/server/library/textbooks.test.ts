import { describe, expect, it } from "vitest";
import { mp3, pdf } from "../testing/files";
import { sniffPdf, sniffTrack } from "./textbooks";

// What a textbook upload takes (#156), by its first bytes.

const head = (bytes: Buffer | string) => new Uint8Array(Buffer.from(bytes).subarray(0, 64));

describe("textbook files", () => {
  it("take a PDF as a book and refuse anything else", () => {
    expect(sniffPdf(head(pdf(1)))).toBe("application/pdf");
    expect(sniffPdf(head(mp3()))).toBeNull();
    expect(sniffPdf(head("not a PDF"))).toBeNull();
  });

  it("take MP3, M4A, WAV and Ogg as tracks and refuse anything else", () => {
    expect(sniffTrack(head(mp3()))).toBe("audio/mpeg");
    expect(sniffTrack(head(Buffer.concat([Buffer.from("ID3"), Buffer.alloc(8)])))).toBe("audio/mpeg");
    expect(sniffTrack(head(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A ")])))).toBe("audio/mp4");
    expect(sniffTrack(head(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")])))).toBe("audio/wav");
    expect(sniffTrack(head("OggS"))).toBe("audio/ogg");
    expect(sniffTrack(head(pdf(1)))).toBeNull();
  });
});
