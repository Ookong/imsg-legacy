#!/usr/bin/env node
/**
 * U1 unit tests for src/lib/attributed-body-parser.js.
 *
 * Each scenario mirrors a case in the upstream openclaw/imsg
 * TypedStreamParser.swift, plus the BER-printable-ASCII edge case
 * the upstream comment warns about (the trap whose structured-prefix
 * bias keeps correct).
 *
 * Tests run against the pure parser; no SQLite / chat.db / AppleScript
 * involvement. Strings are Buffer literals, exercised through
 * parseAttributedBody() plus the internal helpers exposed for tests.
 */
const assert = require('assert');

const {
  parseAttributedBody,
  _decodeSegment,
  _findSequence,
  _trimControlLeading
} = require('../src/lib/attributed-body-parser');

let passed = 0;
let failed = 0;
const ok = (n) => { console.log(`  ✓ ${n}`); passed++; };
const bad = (n, e) => { console.log(`  ✗ ${n}\n    ${e}`); failed++; };

function hexPreview(buf, max = 24) {
  const slice = buf.length > max ? buf.subarray(0, max) : buf;
  const shown = Array.from(slice).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  return buf.length > max ? `${shown} … (${buf.length}B total)` : shown;
}

/* --------------------------------------------------------------------- */
/*  Path 1: UTF-16 LE BOM                                                */
/* --------------------------------------------------------------------- */
console.log('=== Path 1: UTF-16 LE BOM ===');

{
  const text = 'hello';
  const buf = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(text, 'utf16le')
  ]);
  const got = parseAttributedBody(buf);
  if (got === text) ok(`UTF-16 LE BOM happy path: "${text}"`);
  else bad('UTF-16 LE BOM happy path', `got ${JSON.stringify(got)} for input ${hexPreview(buf)}`);
}

{
  // Leading control characters in BOM path
  const text = 'hi';
  const buf = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('\n\r\0' + text, 'utf16le')
  ]);
  const got = parseAttributedBody(buf);
  if (got === text) ok(`UTF-16 LE BOM with leading \\n\\r\\0 stripped → "${text}"`);
  else bad('UTF-16 LE BOM control strip', `got ${JSON.stringify(got)}`);
}

/* --------------------------------------------------------------------- */
/*  Path 2: Apple `(0x01,0x2b)…(0x86,0x84)` segment                      */
/* --------------------------------------------------------------------- */
console.log('\n=== Path 2: Apple segment with BER length prefix ===');

// Subcase: 1-byte length prefix
function appleSegment(bodyBytes) {
  return Buffer.from([
    0x01, 0x2b,
    ...bodyBytes,
    0x86, 0x84
  ]);
}

{
  // 1-byte length prefix: first byte must equal bodyBytes.length - 1.
  // bodyBytes = [0x05, 'h','e','l','l','o'] → segment is [0x05,'h','e','l','l','o'] of length 6.
  const buf = appleSegment([0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
  const got = parseAttributedBody(buf);
  if (got === 'hello') ok(`1-byte BER prefix (0x05 = len 5): "hello"`);
  else bad('1-byte BER prefix', `got ${JSON.stringify(got)} for ${hexPreview(buf)}`);
}

{
  // 2-byte length prefix: first byte = 0x81, prefixLen = 2, body = segment.subarray(2).
  // Upstream does not consume the encoded length — it just strips the
  // prefix and decodes the rest as UTF-8. Test that the body round-trips.
  const bodyText = 'world';
  const bodyBytes = Buffer.from(bodyText, 'utf8');
  const buf = appleSegment([0x81, bodyBytes.length, ...bodyBytes]);
  const got = parseAttributedBody(buf);
  if (got === bodyText) ok(`0x81 prefix (any length) → "${bodyText}"`);
  else bad('0x81 prefix', `got ${JSON.stringify(got)} for ${hexPreview(buf)}`);
}

{
  // 3-byte length prefix: first byte = 0x82, prefixLen = 3.
  // Body length ~100 'a's. Encoded length byte pair is irrelevant.
  const bodyLen = 100;
  const body = 'a'.repeat(bodyLen);
  const buf = appleSegment([0x82, 0x00, bodyLen, ...Buffer.from(body, 'utf8')]);
  const got = parseAttributedBody(buf);
  if (got === body) ok(`0x82 prefix → ${bodyLen}-char body`);
  else bad('0x82 prefix', `got ${JSON.stringify(got.slice(0, 20))}… (len ${got.length})`);
}

/* --------------------------------------------------------------------- */
/*  BER printable-ASCII trap                                              */
/* --------------------------------------------------------------------- */
console.log('\n=== BER printable-ASCII trap ===');

// Trap fires: first byte 'A' (0x41) IS valid 1-byte length because
// segment.length - 1 == 0x41 == 65. Body is 65 'a's. Without the
// structured-prefix bias, the unstripped decode would yield 'A' + 65
// 'a's = 66 chars and beat the correct stripped body. With the bias,
// structured wins and we get 65 'a's.
{
  const bodyLen = 0x41; // 65
  const body = Buffer.alloc(bodyLen, 0x61); // 65 'a' bytes
  const seg = Buffer.concat([Buffer.from([0x41]), body]);
  // seg.length === 66, first === 65 === seg.length - 1 → 1-byte prefix fires
  assert.strictEqual(seg.length - 1, 0x41);
  const got = _decodeSegment(seg);
  if (got.length === bodyLen && got === body.toString('utf8') && got.charCodeAt(0) === 0x61) {
    ok('trap fires: 1-byte prefix stripped, body is 65 a-chars (NOT A-prefixed)');
  } else {
    bad('trap fires', `got ${JSON.stringify(got.slice(0, 10))}… (len ${got.length})`);
  }
}

// Trap does NOT fire: first byte 'A' but segment length does NOT match.
// First must be preserved as part of the body. (If we had mistook 'A'
// for length, the leading 'A' would vanish.)
{
  // Build a segment where first byte is 'A' and segment length is 5
  // (so 0x41 ≠ 4 → no 1-byte prefix). Body is 4 ASCII chars.
  const seg = Buffer.from([0x41, 0x42, 0x43, 0x44, 0x45]); // "ABCDE" length 5
  const got = _decodeSegment(seg);
  if (got === 'ABCDE') ok('trap does NOT fire: leading 0x41 preserved as text "ABCDE"');
  else bad('trap does NOT fire', `got ${JSON.stringify(got)}`);
}

/* --------------------------------------------------------------------- */
/*  Path 3: UTF-8 fallback                                                */
/* --------------------------------------------------------------------- */
console.log('\n=== Path 3: UTF-8 fallback ===');

{
  const buf = Buffer.from('hello world', 'utf8');
  const got = parseAttributedBody(buf);
  if (got === 'hello world') ok('plain UTF-8 fallback');
  else bad('UTF-8 fallback', `got ${JSON.stringify(got)}`);
}

{
  // Leading control chars in fallback path
  const buf = Buffer.from('\n\r\0hi', 'utf8');
  const got = parseAttributedBody(buf);
  if (got === 'hi') ok('UTF-8 fallback strips leading \\n\\r\\0');
  else bad('UTF-8 fallback control strip', `got ${JSON.stringify(got)}`);
}

{
  // Malformed UTF-8 bytes: Node replaces invalid sequences with U+FFFD.
  // We verify the parser does not throw and returns SOME string. The
  // exact contents are environment-dependent; the contract is "no throw
  // and at least one printable char from the valid portion".
  const buf = Buffer.from([0xc3, 0x28, 0xa0, 0xa1, 0x68, 0x69]); // 'hi' at the end with garbage prefix
  const got = parseAttributedBody(buf);
  if (typeof got === 'string' && got.endsWith('hi')) ok('malformed UTF-8: no throw, valid tail preserved');
  else bad('malformed UTF-8', `got ${JSON.stringify(got)}`);
}

/* --------------------------------------------------------------------- */
/*  Empty / null inputs                                                   */
/* --------------------------------------------------------------------- */
console.log('\n=== Empty / null inputs ===');

[
  ['empty Buffer', Buffer.alloc(0)],
  ['Buffer.from([])', Buffer.from([])],
  ['undefined', undefined],
  ['null', null]
].forEach(([label, input]) => {
  const got = parseAttributedBody(input);
  if (got === '') ok(`${label} → ""`);
  else bad(label, `got ${JSON.stringify(got)}`);
});

/* --------------------------------------------------------------------- */
/*  Cross-segment longest-candidate selection                             */
/* --------------------------------------------------------------------- */
console.log('\n=== Cross-segment longest-candidate ===');

{
  // Two Apple segments back-to-back. First short, second long.
  const shortSeg = appleSegment([0x05, 0x68, 0x69]);          // 1-byte prefix + "hi"
  const longText = 'this is definitely the longer one';
  const longSeg = appleSegment([0x81, longText.length, ...Buffer.from(longText, 'utf8')]);
  const buf = Buffer.concat([shortSeg, longSeg]);
  const got = parseAttributedBody(buf);
  if (got === longText) ok(`longest-candidate wins ("${longText}")`);
  else bad('longest-candidate', `got ${JSON.stringify(got.slice(0, 40))}…`);
}

/* --------------------------------------------------------------------- */
/*  trimControlLeading direct                                              */
/* --------------------------------------------------------------------- */
console.log('\n=== trimControlLeading helper ===');

[
  ['', ''],
  ['hi', 'hi'],
  ['\n\r\0hi', 'hi'],
  ['\r\nfoo', 'foo'],
  ['hi', 'hi']
].forEach(([input, expected], i) => {
  const got = _trimControlLeading(input);
  if (got === expected) ok(`trim("${JSON.stringify(input)}") === "${expected}"`);
  else bad(`trim case ${i}`, `got ${JSON.stringify(got)} for ${JSON.stringify(input)}`);
});

/* --------------------------------------------------------------------- */
/*  findSequence direct                                                    */
/* --------------------------------------------------------------------- */
console.log('\n=== findSequence helper ===');

{
  const hay = Buffer.from([0xaa, 0xbb, 0xcc, 0x86, 0x84, 0xdd]);
  const off = _findSequence(Buffer.from([0x86, 0x84]), hay, 0);
  if (off === 3) ok('findSequence returns offset 3');
  else bad('findSequence offset', `got ${off}`);
}
{
  const hay = Buffer.from([0xaa, 0xbb]);
  const off = _findSequence(Buffer.from([0x86, 0x84]), hay, 0);
  if (off === -1) ok('findSequence returns -1 when no match');
  else bad('findSequence miss', `got ${off}`);
}
{
  // Upstream guard `limit < start` makes start > hay.length - needle.length return -1.
  // Mirror that contract here so regressions show up.
  const hay = Buffer.from([0xaa, 0x86, 0x84, 0x86, 0x84]);
  const off = _findSequence(Buffer.from([0x86, 0x84]), hay, 4);
  if (off === -1) ok('findSequence returns -1 when start > haystack.length - needle.length');
  else bad('findSequence over-limit', `got ${off}`);

  // start=2 jumps past the first match at index 1 and finds the second at index 3.
  const off2 = _findSequence(Buffer.from([0x86, 0x84]), hay, 2);
  if (off2 === 3) ok('findSequence respects valid start offset (jumps to second occurrence)');
  else bad('findSequence start', `got ${off2}`);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
