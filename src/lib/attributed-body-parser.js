/**
 * Attributed body parser — decode iMessage's typedstream `attributedBody`
 * blob into a plain text string.
 *
 * Based on TypedStreamParser.swift from the original openclaw/imsg project
 * (`Sources/IMsgCore/TypedStreamParser.swift`, v0.10.0 contract surface).
 * The Apple-side binary `attributedBody` column on `chat.db` carries an
 * NSAttributedString serialized via the typedstream format. macOS groups /
 * @mentions / rich edits serialize to this column with `m.text IS NULL`;
 * without a decoder, those messages reach the watcher as empty `text`, and
 * downstream agents that grep content (e.g. OpenClaw session routing on
 * `@如意`) silently skip them.
 *
 * Three decode paths, tried in upstream order:
 *   1. UTF-16 LE with BOM (`0xff 0xfe` + UTF-16-LE bytes)
 *   2. Apple private format: `(0x01, 0x2b) … (0x86, 0x84)` segment with
 *      a BER-style length prefix (1 / `0x81 NN` / `0x82 NN NN` bytes)
 *   3. Plain UTF-8 fallback over the entire buffer
 */
'use strict';

const START_MARKER = Buffer.from([0x01, 0x2b]);
const END_MARKER = Buffer.from([0x86, 0x84]);
const UTF16_LE_BOM = [0xff, 0xfe];

/**
 * Parse iMessage typedstream `attributedBody` into a plain text string.
 *
 * Accepts Buffer, Uint8Array, or any value coercable via Buffer.from.
 * Returns the empty string for null / undefined / zero-length input and
 * never throws — malformed buffers fall through to the UTF-8 fallback
 * path which always succeeds (Node replaces invalid UTF-8 bytes with
 * U+FFFD, which the trim helper then leaves intact because it is not
 * a control character).
 */
function parseAttributedBody(data) {
  if (data === null || data === undefined) return '';
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (bytes.length === 0) return '';

  // Path 1: UTF-16 LE with BOM
  if (bytes.length >= 2 && bytes[0] === UTF16_LE_BOM[0] && bytes[1] === UTF16_LE_BOM[1]) {
    const payload = bytes.subarray(2);
    const text = payload.toString('utf16le');
    return trimControlLeading(text);
  }

  // Path 2: Apple private `(0x01, 0x2b) … (0x86, 0x84)` segments
  const candidates = collectAppleSegments(bytes);
  let best = '';
  for (const segment of candidates) {
    const candidate = decodeSegment(segment);
    // JS String.length counts UTF-16 code units; Swift String.count
    // counts grapheme clusters. They differ for multibyte characters,
    // but for the "longest wins" heuristic used here the order is
    // preserved and good enough. Switch to a grapheme comparison if
    // a real chat.db sample shows a regression.
    if (candidate.length > best.length) {
      best = candidate;
    }
  }
  if (best.length > 0) return best;

  // Path 3: UTF-8 fallback over the whole buffer
  return trimControlLeading(bytes.toString('utf8'));
}

/**
 * Collect every `(0x01, 0x2b) … (0x86, 0x84)` segment from the buffer.
 * Returns an array of Buffers (one per matching segment); overlapping
 * start markers each emit their own segment so the longest-candidate
 * heuristic downstream can pick the winner.
 */
function collectAppleSegments(bytes) {
  const segments = [];
  let i = 0;
  while (i + 1 < bytes.length) {
    if (bytes[i] === START_MARKER[0] && bytes[i + 1] === START_MARKER[1]) {
      const sliceStart = i + 2;
      const sliceEnd = findSequence(END_MARKER, bytes, sliceStart);
      if (sliceEnd !== -1) {
        // Copy out so the segment is independent of the parent buffer.
        segments.push(Buffer.from(bytes.subarray(sliceStart, sliceEnd)));
        i = sliceEnd + END_MARKER.length;
        continue;
      }
    }
    i++;
  }
  return segments;
}

/**
 * BER-style length-prefix strip with longest-candidate selection.
 *
 * The 1-byte prefix form fires only when its value equals segment.length
 * minus one — this is the trick that prevents a printable-ASCII first
 * byte (e.g. 0x41 = 'A', "length 65") from being misread as a length
 * prefix when the segment body is itself 64 bytes of UTF-8 that would
 * otherwise decode to a string of 65+ characters and win the
 * longest-candidate race.
 *
 * Structured prefixes always beat a "no prefix" decode, even when the
 * no-prefix decode would happen to be valid UTF-8.
 */
function decodeSegment(segment) {
  if (segment.length === 0) return '';

  const first = segment[0];
  const prefixOptions = [];

  if (first < 0x80 && first === segment.length - 1) {
    prefixOptions.push(1);
  }
  if (first === 0x81 && segment.length >= 2) {
    prefixOptions.push(2);
  }
  if (first === 0x82 && segment.length >= 3) {
    prefixOptions.push(3);
  }

  let bestStructured = '';
  let anyStructuredValid = false;
  for (const prefixLen of prefixOptions) {
    const body = segment.subarray(prefixLen);
    // Buffer.toString('utf8') always returns a string; invalid bytes
    // are replaced with U+FFFD which is intentionally kept by the
    // upstream's "anyStructuredValid" heuristic so we mirror that.
    const candidate = trimControlLeading(body.toString('utf8'));
    anyStructuredValid = true;
    if (candidate.length > bestStructured.length) {
      bestStructured = candidate;
    }
  }
  if (anyStructuredValid) {
    return bestStructured;
  }

  return trimControlLeading(segment.toString('utf8'));
}

/**
 * Naive byte-sequence search. Returns the byte offset of the first
 * match after (or at) `start`, or -1 when no match exists upstream of
 * the buffer tail. Mirrors `findSequence(_:_:from:)` upstream.
 */
function findSequence(needle, haystack, start) {
  if (needle.length === 0) return -1;
  if (start < 0 || start >= haystack.length) return -1;
  const limit = haystack.length - needle.length;
  if (limit < start) return -1;

  for (let i = start; i <= limit; i++) {
    let matched = true;
    for (let off = 0; off < needle.length; off++) {
      if (haystack[i + off] !== needle[off]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

/**
 * Strip leading Unicode Cc control characters plus LF / CR from `s`.
 * Mirrors `trimmingLeadingControlCharacters()` upstream.
 */
function trimControlLeading(s) {
  if (!s) return s;
  let start = 0;
  const len = s.length;
  while (start < len) {
    const code = s.charCodeAt(start);
    // Cc = 0x00..0x1F and 0x7F..0x9F; we also peel \n (0x0A) and \r (0x0D)
    // explicitly per upstream. CharCodeAt returns the UTF-16 code unit,
    // which for ASCII control chars equals the Unicode scalar.
    const isControl =
      (code >= 0x00 && code <= 0x1f) ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x7f && code <= 0x9f);
    if (!isControl) break;
    start++;
  }
  return start === 0 ? s : s.slice(start);
}

module.exports = {
  parseAttributedBody,
  // Exposed for unit tests:
  _decodeSegment: decodeSegment,
  _findSequence: findSequence,
  _trimControlLeading: trimControlLeading
};
