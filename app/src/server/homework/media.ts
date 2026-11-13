// What a student's recording or file is, read from its bytes (#35). The page
// says nothing the server trusts: the type comes from the first bytes, and a
// recording's length from its container, so a recording over the limit is
// refused whatever the page claims. Stored as recorded, without transcoding
// (architecture 11.1).

export type MediaKind = "image" | "audio";

/** The type of an image or audio file the platform accepts, or null. */
export function sniffMedia(bytes: Uint8Array): { contentType: string; kind: MediaKind } | null {
  const starts = (offset: number, ...sig: number[]) => sig.every((b, i) => bytes[offset + i] === b);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));

  if (starts(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { contentType: "image/png", kind: "image" };
  if (starts(0, 0xff, 0xd8, 0xff)) return { contentType: "image/jpeg", kind: "image" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return { contentType: "image/webp", kind: "image" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return { contentType: "audio/wav", kind: "audio" };
  if (starts(0, 0x1a, 0x45, 0xdf, 0xa3)) return { contentType: "audio/webm", kind: "audio" };
  if (ascii(0, 4) === "OggS") return { contentType: "audio/ogg", kind: "audio" };
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0 && ((bytes[1] ?? 0) & 0x06) !== 0)) {
    return { contentType: "audio/mpeg", kind: "audio" };
  }
  if (ascii(4, 4) === "ftyp") {
    // HEIF and AVIF photos are ISO boxes too; browsers other than Safari cannot show them, so they are not accepted.
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1", "avif", "avis"].includes(ascii(8, 4))) return null;
    return { contentType: "audio/mp4", kind: "audio" };
  }
  return null;
}

/** The containers a browser records voice in: WebM (Chrome, Firefox) and MP4 (Safari). */
export const VOICE_TYPES = ["audio/webm", "audio/mp4"] as const;

/** A recording's length in seconds, read from its container; null when it cannot be read. */
export function voiceDuration(bytes: Uint8Array, contentType: string): number | null {
  if (contentType === "audio/webm") return webmDuration(bytes);
  if (contentType === "audio/mp4") return mp4Duration(bytes);
  return null;
}

// --- WebM (Matroska) ----------------------------------------------------------
//
// A browser writes WebM while it records, so the segment and its clusters have
// "unknown" sizes and the header has no duration. The length is the latest
// block's time: a cluster's timecode plus the block's own offset, scaled by
// TimecodeScale. The elements that hold blocks are entered, every other one is
// skipped by its size.

const EBML = {
  segment: 0x18538067,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  duration: 0x4489,
  cluster: 0x1f43b675,
  timecode: 0xe7,
  simpleBlock: 0xa3,
  blockGroup: 0xa0,
  block: 0xa1,
} as const;
const ENTERED: ReadonlySet<number> = new Set([EBML.segment, EBML.info, EBML.cluster, EBML.blockGroup]);

/** A variable-length integer at `at`: its value (with or without the length marker) and its length. */
function vint(bytes: Uint8Array, at: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } | null {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  const length = Math.clz32(first) - 23;
  if (length > 8 || at + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[at + i]!;
    allOnes &&= bytes[at + i] === 0xff;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

function uint(bytes: Uint8Array, at: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + bytes[at + i]!;
  return value;
}

function webmDuration(bytes: Uint8Array): number | null {
  let scale = 1_000_000;
  let declared = 0;
  let cluster = 0;
  let latest = -1;
  let at = 0;
  // The EBML header comes first; it is skipped like any element.
  while (at < bytes.length) {
    const id = vint(bytes, at, true);
    if (!id) return null;
    const size = vint(bytes, at + id.length, false);
    if (!size) break;
    const body = at + id.length + size.length;
    if (ENTERED.has(id.value)) {
      at = body;
      continue;
    }
    if (size.unknown) return null;
    // A recording cut off mid-element ends here: what came before still counts.
    if (body + size.value > bytes.length) break;
    if (id.value === EBML.timecodeScale) scale = uint(bytes, body, size.value);
    else if (id.value === EBML.timecode) cluster = uint(bytes, body, size.value);
    else if (id.value === EBML.duration) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + body, size.value);
      declared = size.value === 4 ? view.getFloat32(0) : size.value === 8 ? view.getFloat64(0) : 0;
    } else if (id.value === EBML.simpleBlock || id.value === EBML.block) {
      const track = vint(bytes, body, false);
      if (!track || size.value < track.length + 2) return null;
      const offset = new DataView(bytes.buffer, bytes.byteOffset + body + track.length, 2).getInt16(0);
      latest = Math.max(latest, cluster + offset);
    }
    at = body + size.value;
  }
  if (latest < 0 && declared <= 0) return null;
  // The declared duration and the blocks are both in TimecodeScale units; the longer one counts.
  return (Math.max(latest, declared) * scale) / 1e9;
}

// --- MP4 (ISO base media) -----------------------------------------------------
//
// A whole file states its length in the movie header (mvhd). A recording
// written in fragments may state 0 there; then the length is the end of the
// latest fragment: its decode time (tfdt) plus its samples' durations (trun,
// or the defaults in tfhd and trex), in the track's timescale (mdhd).

const CONTAINERS: ReadonlySet<string> = new Set(["moov", "trak", "mdia", "mvex", "moof", "traf"]);
// Real files nest moov/trak/mdia or moof/traf; a limit keeps a crafted file from overflowing the stack.
const MAX_DEPTH = 8;

function mp4Duration(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number) => view.getUint32(at);
  const u64 = (at: number) => view.getUint32(at) * 2 ** 32 + view.getUint32(at + 4);

  let movie = 0;
  let trackScale = 0;
  let trexDuration = 0;
  let fragmentEnd = 0;
  // The fragment being read.
  let decodeTime = 0;
  let defaultDuration = 0;

  const walk = (start: number, end: number, depth: number): boolean => {
    if (depth > MAX_DEPTH) return false;
    let at = start;
    while (at + 8 <= end) {
      let size = u32(at);
      const type = String.fromCharCode(...bytes.slice(at + 4, at + 8));
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) return false;
        size = u64(at + 8);
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header) return false;
      // A box cut off at the end: read what is there.
      const boxEnd = Math.min(at + size, end);
      const body = at + header;
      const has = (length: number) => body + length <= boxEnd;

      if (type === "traf") {
        decodeTime = 0;
        defaultDuration = trexDuration;
      }
      if (CONTAINERS.has(type)) {
        if (!walk(body, boxEnd, depth + 1)) return false;
      } else if (type === "mvhd" && has(32)) {
        const v1 = bytes[body] === 1;
        const scale = u32(body + (v1 ? 20 : 12));
        const duration = v1 ? u64(body + 24) : u32(body + 16);
        if (scale > 0 && duration !== 0xffffffff && duration < 2 ** 53 - 1) movie = Math.max(movie, duration / scale);
      } else if (type === "mdhd" && has(bytes[body] === 1 ? 32 : 20)) {
        trackScale ||= u32(body + (bytes[body] === 1 ? 20 : 12));
      } else if (type === "trex" && has(24)) {
        trexDuration = u32(body + 12);
      } else if (type === "tfhd" && has(8)) {
        const flags = u32(body) & 0xffffff;
        let at2 = body + 8;
        if (flags & 0x01) at2 += 8;
        if (flags & 0x02) at2 += 4;
        if (flags & 0x08 && at2 + 4 <= boxEnd) defaultDuration = u32(at2);
      } else if (type === "tfdt" && has(8)) {
        decodeTime = bytes[body] === 1 && has(12) ? u64(body + 4) : u32(body + 4);
      } else if (type === "trun" && has(8)) {
        const flags = u32(body) & 0xffffff;
        const count = u32(body + 4);
        let at2 = body + 8;
        if (flags & 0x01) at2 += 4;
        if (flags & 0x04) at2 += 4;
        const perSample = [0x100, 0x200, 0x400, 0x800].filter((f) => flags & f).length * 4;
        let total = count * defaultDuration;
        if (flags & 0x100) {
          // The count comes from the file: refuse one the box cannot hold, so the loop is bounded by real bytes.
          if (at2 + count * perSample > boxEnd) return false;
          total = 0;
          for (let i = 0; i < count; i++, at2 += perSample) total += u32(at2);
        }
        decodeTime += total;
        fragmentEnd = Math.max(fragmentEnd, decodeTime);
      }
      at += size;
    }
    return true;
  };

  if (!walk(0, bytes.length, 0)) return null;
  const fragments = trackScale > 0 ? fragmentEnd / trackScale : 0;
  const longest = Math.max(movie, fragments);
  return longest > 0 ? longest : null;
}
