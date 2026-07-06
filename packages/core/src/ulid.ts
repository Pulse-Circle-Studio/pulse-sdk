const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** ULID: 48-bit timestamp + 80 random bits, 26 chars of Crockford base32. */
export function ulid(timeMs: number): string {
  let out = '';
  let t = timeMs;
  const time = new Array<number>(10);
  for (let i = 9; i >= 0; i--) {
    time[i] = t % 32;
    t = Math.floor(t / 32);
  }
  for (let i = 0; i < 10; i++) out += ALPHABET[time[i]!];

  // 80 random bits → 16 chars of 5 bits, drawn from 10 bytes via a bit reader.
  const rand = randomBytes(10);
  let bitBuffer = 0;
  let bitCount = 0;
  for (let i = 0, produced = 0; produced < 16; ) {
    if (bitCount < 5) {
      bitBuffer = (bitBuffer << 8) | rand[i % 10]!;
      i++;
      bitCount += 8;
      continue;
    }
    bitCount -= 5;
    out += ALPHABET[(bitBuffer >> bitCount) & 31];
    produced++;
  }
  return out;
}

export function uuid4(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
