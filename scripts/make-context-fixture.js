#!/usr/bin/env node
/**
 * Generate the §5 context bundle's image fixture.
 *
 * A script rather than a committed-and-forgotten binary, so the fixture is
 * REPRODUCIBLE: §5 calls the context bundle a shared artifact, and a shared
 * artifact nobody can regenerate is one nobody can change with confidence.
 *
 * The content is deliberately unambiguous — three horizontal bands, red then
 * green then blue — because it is the thing a live turn asserts the model can
 * describe (§8 C3). A fixture whose content is hard to state in words cannot
 * test whether the model read it.
 *
 * The first version of this was a checkerboard built by writing one byte per
 * loop step across `width * 3` bytes, which put the block boundary every 8 BYTES
 * rather than every 8 pixels — so blocks straddled pixel boundaries and the
 * "grey" checkerboard came out with red, blue, cyan and yellow fringes. Bands
 * are written a whole pixel at a time below, which is why that cannot recur.
 *
 *     node scripts/make-context-fixture.js
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WIDTH = 60;
const BAND = 20;
export const BANDS = [
  { name: 'red', rgb: [220, 60, 60] },
  { name: 'green', rgb: [60, 180, 90] },
  { name: 'blue', rgb: [60, 90, 220] },
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function bandedPng() {
  const height = BAND * BANDS.length;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const [r, g, b] = BANDS[Math.floor(y / BAND)].rgb;
    // A WHOLE PIXEL at a time. See the note above about the byte/pixel bug.
    const row = Buffer.alloc(WIDTH * 3 + 1);
    for (let x = 0; x < WIDTH; x += 1) {
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const path = fileURLToPath(new URL('../test/fixtures/context/screenshot.png', import.meta.url));
  const png = bandedPng();
  writeFileSync(path, png);
  console.log(`wrote ${path} — ${png.length} bytes, ${WIDTH}×${BAND * BANDS.length}, bands: ${BANDS.map((b) => b.name).join(', ')}`);
}
