import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as zlib from 'node:zlib';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(scriptDir, 'entry.png');
let bytes: Buffer;
try {
  bytes = await readFile(sourcePath);
} catch (error) {
  throw new Error(
    `Read source PNG: expected a readable entry.png at ${sourcePath}: ${String(error)}`,
  );
}

const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function validatePng(png: Buffer): void {
  if (png.length < 33 || !png.subarray(0, 8).equals(pngSignature)) {
    throw new Error(
      'Verify PNG signature: expected the exact 8-byte PNG signature '
      + '89 50 4e 47 0d 0a 1a 0a',
    );
  }

  let offset = 8;
  let sawHeader = false;
  let sawEnd = false;
  let width = 0;
  let height = 0;

  const crc32 = (typeof zlib.crc32 === 'function')
    ? (data: Buffer) => zlib.crc32(data)
    : makeCrc32();

  while (offset < png.length) {
    if (png.length - offset < 12) {
      throw new Error(
        `Parse PNG chunks: expected at least 12 remaining bytes for a complete chunk at offset ${offset}; found ${png.length - offset}`,
      );
    }

    const length = png.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const nextOffset = dataEnd + 4;

    if (dataEnd > png.length || nextOffset > png.length) {
      throw new Error(
        `Parse PNG chunk length: expected the declared length ${length} plus 12 chunk bytes to fit within ${png.length} bytes; found chunk ending beyond offset ${nextOffset}`,
      );
    }

    const type = png.subarray(typeStart, dataStart);
    const data = png.subarray(dataStart, dataEnd);
    const expectedCrc = png.readUInt32BE(dataEnd);
    const actualCrc = crc32(Buffer.concat([type, data])) >>> 0;

    if (actualCrc !== expectedCrc) {
      throw new Error(
        `Verify CRC-32: expected ${type.toString('ascii')} chunk CRC ${expectedCrc.toString(16).padStart(8, '0')}; calculated ${actualCrc.toString(16).padStart(8, '0')}`,
      );
    }

    if (!sawHeader) {
      if (!type.equals(Buffer.from('IHDR')) || length !== 13) {
        throw new Error(
          `Verify first chunk: expected an IHDR chunk with exactly 13 data bytes; found ${type.toString('ascii')} with ${length} bytes`,
        );
      }
      sawHeader = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (width === 0 || height === 0) {
        throw new Error(
          `Verify IHDR dimensions: expected both width and height to be greater than 0; found ${width}x${height}`,
        );
      }
      if (width > 1024 || height > 1024) {
        throw new Error(
          `Verify IHDR dimensions: expected width and height to be at most 1024 each; found ${width}x${height}`,
        );
      }

      const bitDepth = data[8];
      const colorType = data[9];
      const validBitDepths = new Map<number, number[]>([
        [0, [1, 2, 4, 8, 16]],
        [2, [8, 16]],
        [3, [1, 2, 4, 8]],
        [4, [8, 16]],
        [6, [8, 16]],
      ]);
      const allowed = validBitDepths.get(colorType) ?? [];
      if (!allowed.includes(bitDepth)) {
        throw new Error(
          `Verify IHDR color format: expected a PNG-valid bit depth/color type pair preserved by a plain copy; found bit depth ${bitDepth} with color type ${colorType}`,
        );
      }

      if (data[10] !== 0 || data[11] !== 0) {
        throw new Error(
          `Verify IHDR methods: expected compression method 0 and filter method 0; found compression ${data[10]} and filter ${data[11]}`,
        );
      }
      if (data[12] !== 0 && data[12] !== 1) {
        throw new Error(
          `Verify IHDR interlace: expected interlace method 0 or 1; found ${data[12]}`,
        );
      }
    }

    if (type.equals(Buffer.from('IEND'))) {
      if (length !== 0) {
        throw new Error(
          `Verify IEND chunk: expected 0 data bytes; found ${length}`,
        );
      }
      if (nextOffset !== png.length) {
        throw new Error(
          `Verify IEND is last: expected no bytes after IEND at offset ${nextOffset}; found file length ${png.length}`,
        );
      }
      sawEnd = true;
      break;
    }

    offset = nextOffset;
  }

  if (!sawHeader || !sawEnd) {
    throw new Error(
      `Verify complete PNG: expected both IHDR and IEND chunks; found IHDR=${sawHeader}, IEND=${sawEnd}`,
    );
  }
}

function makeCrc32(): (data: Buffer) => number {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let crc = n;
    for (let k = 0; k < 8; k += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[n] = crc >>> 0;
  }

  return (data: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
}

validatePng(bytes);

const outputDir = process.env.MAKEFUN_OUTPUT_DIR || 'out';
try {
  await mkdir(outputDir, { recursive: true });
} catch (error) {
  throw new Error(
    `Create output directory: expected to create or access ${outputDir}: ${String(error)}`,
  );
}

const outputPath = path.join(outputDir, 'entry.png');
try {
  await writeFile(outputPath, bytes);
} catch (error) {
  throw new Error(
    `Write output PNG: expected to write exact copied bytes to ${outputPath}: ${String(error)}`,
  );
}
