const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function reedSolomon(data: number[], ecCount: number): number[] {
  const gen = generatorPoly(ecCount);
  const remainder = new Array<number>(ecCount).fill(0);

  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecCount; i += 1) {
      remainder[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return remainder;
}

const VERSION_M: ReadonlyArray<readonly [number, number, number]> = [
  [26, 10, 1],
  [44, 16, 1],
  [70, 26, 1],
  [100, 18, 2],
  [134, 24, 2],
  [172, 16, 4],
  [196, 18, 4],
  [242, 22, 4],
  [292, 22, 5],
  [346, 26, 5],
];

const ALIGNMENT: ReadonlyArray<readonly number[]> = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const FORMAT_M = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
];

const VERSION_INFO: Record<number, number> = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
};

export interface QrMatrix {
  size: number;
  modules: boolean[][];
}

function capacityBytes(version: number): number {
  const [total, ecPerBlock, blocks] = VERSION_M[version - 1];
  const dataCodewords = total - ecPerBlock * blocks;
  const lengthBits = version < 10 ? 8 : 16;
  return dataCodewords - Math.ceil((4 + lengthBits) / 8);
}

export function encodeQr(text: string): QrMatrix {
  const data = Array.from(new TextEncoder().encode(text));

  let version = 0;
  for (let v = 1; v <= 10; v += 1) {
    if (data.length <= capacityBytes(v)) {
      version = v;
      break;
    }
  }
  if (version === 0) {
    throw new Error('qr: payload too long (max 213 bytes)');
  }

  const [totalCodewords, ecPerBlock, blockCount] = VERSION_M[version - 1];
  const dataCodewords = totalCodewords - ecPerBlock * blockCount;

  const bits: number[] = [];
  const pushBits = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  pushBits(0b0100, 4);
  pushBits(data.length, version < 10 ? 8 : 16);
  for (const byte of data) pushBits(byte, 8);

  const capacityBits = dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  const PAD = [0xec, 0x11];
  for (let i = 0; codewords.length < dataCodewords; i += 1) {
    codewords.push(PAD[i % 2]);
  }

  const shortBlockLen = Math.floor(dataCodewords / blockCount);
  const longBlocks = dataCodewords % blockCount;

  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let b = 0; b < blockCount; b += 1) {
    const len = shortBlockLen + (b >= blockCount - longBlocks ? 1 : 0);
    const block = codewords.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(reedSolomon(block, ecPerBlock));
  }

  const interleaved: number[] = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i += 1) {
    for (const block of dataBlocks) if (i < block.length) interleaved.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) interleaved.push(block[i]);
  }

  const size = version * 4 + 17;
  const modules: (boolean | null)[][] = Array.from({ length: size }, () =>
    new Array<boolean | null>(size).fill(null)
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false)
  );

  const setModule = (r: number, c: number, dark: boolean, isFunction = true) => {
    modules[r][c] = dark;
    if (isFunction) reserved[r][c] = true;
  };

  const placeFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setModule(rr, cc, inRing || inCore);
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i += 1) {
    setModule(6, i, i % 2 === 0);
    setModule(i, 6, i % 2 === 0);
  }

  const centres = ALIGNMENT[version - 1];
  for (const r of centres) {
    for (const c of centres) {
      const nearFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          setModule(r + dr, c + dc, ring !== 1);
        }
      }
    }
  }

  setModule(size - 8, 8, true);

  for (let i = 0; i < 9; i += 1) {
    if (modules[8][i] === null) setModule(8, i, false);
    if (modules[i][8] === null) setModule(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    if (modules[8][size - 1 - i] === null) setModule(8, size - 1 - i, false);
    if (modules[size - 1 - i][8] === null) setModule(size - 1 - i, 8, false);
  }

  if (version >= 7) {
    const info = VERSION_INFO[version];
    for (let i = 0; i < 18; i += 1) {
      const bit = ((info >> i) & 1) === 1;
      const r = Math.floor(i / 3);
      const c = i % 3;
      setModule(size - 11 + c, r, bit);
      setModule(r, size - 11 + c, bit);
    }
  }

  const mask = 0;
  let bitIndex = 0;
  const totalBits = interleaved.length * 8;

  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let i = 0; i < size; i += 1) {
      const upward = ((size - 1 - col) & 2) === 0;
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c += 1) {
        const cc = col - c;
        if (modules[row][cc] !== null) continue;

        let dark = false;
        if (bitIndex < totalBits) {
          const byte = interleaved[bitIndex >> 3];
          dark = ((byte >> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex += 1;
        }
        if ((row + cc) % 2 === 0) dark = !dark;
        modules[row][cc] = dark;
      }
    }
  }

  const format = FORMAT_M[mask];
  for (let i = 0; i < 15; i += 1) {
    const bit = ((format >> i) & 1) === 1;

    if (i < 6) modules[size - 1 - i][8] = bit;
    else if (i < 8) modules[size - 15 + i][8] = bit;
    else if (i === 8) modules[8][15 - i - 1] = bit;
    else modules[8][15 - i - 1] = bit;

    if (i < 8) modules[8][size - 1 - i] = bit;
    else if (i === 8) modules[7][8] = bit;
    else if (i < 15) modules[14 - i][8] = bit;
  }

  return {
    size,
    modules: modules.map((row) => row.map((cell) => cell === true)),
  };
}

export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let r = 0; r < matrix.size; r += 1) {
    for (let c = 0; c < matrix.size; c += 1) {
      if (matrix.modules[r][c]) parts.push(`M${c} ${r}h1v1h-1z`);
    }
  }
  return parts.join('');
}
