// Synthetic recordings for tests (#35): containers with a given length and
// silence for content, built here byte by byte. Not real audio.

const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};

// --- WebM ---------------------------------------------------------------------

const UNKNOWN_SIZE = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

/** An EBML size as an 8-byte variable-length integer. */
function size(value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt32BE(Math.floor(value / 2 ** 32), 0);
  bytes.writeUInt32BE(value >>> 0, 4);
  bytes[0] = (bytes[0] ?? 0) | 0x01;
  return bytes;
}

function element(id: number[], ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from(id), size(body.length), body]);
}

/** Track types of a WebM: 2 is audio, 1 is video. */
const WEBM_TRACK = { audio: 2, video: 1 } as const;

/**
 * A WebM as a browser writes it while recording: an audio track (and a video
 * one if asked), the segment and clusters of unknown size, no duration in
 * the header, a block every second, the last one at `seconds`.
 */
export function webmRecording(
  seconds: number,
  tracks: (keyof typeof WEBM_TRACK)[] = ["audio"],
  /** A Duration in the header, in milliseconds, which a browser does not write while recording. */
  declaredMs?: number,
): Buffer {
  const declared = Buffer.alloc(8);
  declared.writeDoubleBE(declaredMs ?? 0);
  const parts: Buffer[] = [
    element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x82], Buffer.from("webm"))),
    Buffer.from([0x18, 0x53, 0x80, 0x67]),
    UNKNOWN_SIZE,
    element(
      [0x15, 0x49, 0xa9, 0x66],
      element([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40])),
      ...(declaredMs === undefined ? [] : [element([0x44, 0x89], declared)]),
    ),
    element(
      [0x16, 0x54, 0xae, 0x6b],
      ...tracks.map((kind, i) => element([0xae], element([0xd7], Buffer.from([i + 1])), element([0x83], Buffer.from([WEBM_TRACK[kind]])))),
    ),
  ];
  const lastMs = Math.round(seconds * 1000);
  const times = [...Array.from({ length: Math.ceil(lastMs / 1000) }, (_, i) => i * 1000), lastMs];
  // A cluster every 10 seconds, as a block's offset is a 16-bit number of milliseconds.
  let cluster = -1;
  for (const time of times) {
    if (Math.floor(time / 10_000) * 10_000 !== cluster) {
      cluster = Math.floor(time / 10_000) * 10_000;
      parts.push(Buffer.from([0x1f, 0x43, 0xb6, 0x75]), UNKNOWN_SIZE, element([0xe7], u32(cluster)));
    }
    const block = Buffer.alloc(4 + 20);
    block[0] = 0x81;
    block.writeInt16BE(time - cluster, 1);
    block[3] = 0x80;
    parts.push(element([0xa3], block));
  }
  return Buffer.concat(parts);
}

// --- MP4 ----------------------------------------------------------------------

function box(type: string, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, "latin1"), body]);
}

const FTYP = box("ftyp", Buffer.from("M4A ", "latin1"), u32(0), Buffer.from("isomM4A ", "latin1"));
/** A track's media box: its timescale and what it holds ("soun" audio, "vide" video). */
const media = (timescale: number, handler = "soun") =>
  box(
    "mdia",
    box("mdhd", header(timescale, 0, 24)),
    box("hdlr", u32(0), u32(0), Buffer.from(handler, "latin1"), Buffer.alloc(12)),
  );
const header = (timescale: number, duration: number, length: number) =>
  Buffer.concat([u32(0), u32(0), u32(0), u32(timescale), u32(duration), Buffer.alloc(length - 20)]);

/** A whole MP4 whose movie header states its length; one audio track, and a video one if asked. */
export function mp4Recording(seconds: number, withVideo = false): Buffer {
  return Buffer.concat([
    FTYP,
    box("moov", box("mvhd", header(1000, Math.round(seconds * 1000), 100)), box("trak", media(48_000)), ...(withVideo ? [box("trak", media(90_000, "vide"))] : [])),
    box("mdat", Buffer.alloc(32)),
  ]);
}

/**
 * A fragmented MP4 as Safari may record it: the movie header says 0, and the
 * length is in the fragments, one per second, 1024-sample frames at 48 kHz.
 */
export function fragmentedMp4Recording(seconds: number): Buffer {
  const scale = 48_000;
  const frame = 1024;
  const parts = [
    FTYP,
    box(
      "moov",
      box("mvhd", header(1000, 0, 100)),
      box("trak", media(scale)),
      box("mvex", box("trex", u32(0), u32(1), u32(1), u32(frame), u32(0), u32(0))),
    ),
  ];
  const total = Math.round((seconds * scale) / frame);
  for (let start = 0; start < total; start += 47) {
    const count = Math.min(47, total - start);
    // Every other fragment states each sample's duration; the rest use the default.
    const explicit = (start / 47) % 2 === 0;
    const samples = explicit ? Array.from({ length: count }, () => u32(frame)) : [];
    parts.push(
      box(
        "moof",
        box(
          "traf",
          box("tfhd", u32(0), u32(1)),
          box("tfdt", u32(0), u32(start * frame)),
          box("trun", u32(explicit ? 0x100 : 0), u32(count), ...samples),
        ),
      ),
      box("mdat", Buffer.alloc(16)),
    );
  }
  return Buffer.concat(parts);
}

/**
 * A fragmented MP4 with one fragment whose `trun` declares `count` samples and
 * carries `samples` as their durations (flag 0x100) when given. A crafted
 * file: the count need not match what the box holds.
 */
export function mp4WithTrun(count: number, samples?: Buffer[], defaultDuration?: number): Buffer {
  const tfhd = defaultDuration === undefined ? box("tfhd", u32(0), u32(1)) : box("tfhd", u32(0x08), u32(1), u32(defaultDuration));
  return Buffer.concat([
    FTYP,
    box("moov", box("trak", box("mdia", box("mdhd", header(1000, 0, 24))))),
    box("moof", box("traf", tfhd, box("trun", u32(samples ? 0x100 : 0), u32(count), ...(samples ?? [])))),
  ]);
}

/** An MP4 of `depth` container boxes nested in each other, each running to the end of the file. */
export function nestedMp4(depth: number): Buffer {
  return Buffer.concat([FTYP, ...Array.from({ length: depth }, () => Buffer.concat([u32(0), Buffer.from("moov", "latin1")]))]);
}
