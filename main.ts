import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as zlib from 'node:zlib';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(scriptDir, 'entry.png');
const bytes = await readFile(sourcePath);

const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function validatePng(png: Buffer): void {
  if (png.length < 33 || !png.subarray(0, 8).equals(pngSignature)) {
    throw new Error('Invalid PNG signature');
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
      throw new Error('Truncated PNG chunk');
    }

    const length = png.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const nextOffset = dataEnd + 4;

    if (dataEnd > png.length || nextOffset > png.length) {
      throw new Error('Invalid PNG chunk length');
    }

    const type = png.subarray(typeStart, dataStart);
    const data = png.subarray(dataStart, dataEnd);
    const expectedCrc = png.readUInt32BE(dataEnd);
    const actualCrc = crc32(Buffer.concat([type, data])) >>> 0;

    if (actualCrc !== expectedCrc) {
      throw new Error(`Invalid CRC-32 for ${type.toString('ascii')} chunk`);
    }

    if (!sawHeader) {
      if (!type.equals(Buffer.from('IHDR')) || length !== 13) {
        throw new Error('PNG must begin with a 13-byte IHDR chunk');
      }
      sawHeader = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (width === 0 || height === 0) {
        throw new Error('PNG dimensions must be nonzero');
      }
      if (width > 1024 || height > 1024) {
        throw new Error('PNG dimensions exceed 1024x1024');
      }
    }

    if (type.equals(Buffer.from('IEND'))) {
      if (length !== 0) {
        throw new Error('IEND chunk must be empty');
      }
      if (nextOffset !== png.length) {
        throw new Error('Unexpected data after IEND chunk');
      }
      sawEnd = true;
      break;
    }

    offset = nextOffset;
  }

  if (!sawHeader || !sawEnd) {
    throw new Error('Incomplete PNG');
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
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, 'entry.png'), bytes);
