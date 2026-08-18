// Canonical circuit generators, byte-for-byte in the shape the guide documents.
// These exist so the width limit can actually be tested: the supplied examples
// stop at 200 because that is the product's cap, not because anything about the
// circuits gets harder.

const HEADER = 'OPENQASM 2.0;\ninclude "qelib1.inc";\n';

/** Random N-bit mask with the given number of ones (or ~half if unspecified). */
export function randomMask(n, weight = null, rng = Math.random) {
  const m = new Uint8Array(n);
  if (weight === null) {
    for (let i = 0; i < n; i++) m[i] = rng() < 0.5 ? 1 : 0;
    return m;
  }
  // Partial Fisher-Yates over the index set, so weight is exact.
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const w = Math.max(0, Math.min(n, weight));
  for (let i = 0; i < w; i++) {
    const j = i + Math.floor(rng() * (n - i));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    m[idx[i]] = 1;
  }
  return m;
}

export function maskFromString(s) {
  const t = s.trim();
  if (!/^[01]+$/.test(t)) throw new Error('a secret must be written as a string of 0s and 1s');
  const m = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) m[i] = t.charCodeAt(i) === 49 ? 1 : 0;
  return m;
}

/** Bernstein-Vazirani over N query qubits plus one ancilla at q[N]. */
export function bv(n, mask) {
  const out = [HEADER, `qreg q[${n + 1}];\ncreg c[${n}];\nx q[${n}];\n`];
  for (let i = 0; i <= n; i++) out.push(`h q[${i}];\n`);
  for (let i = 0; i < n; i++) if (mask[i]) out.push(`cx q[${i}], q[${n}];\n`);
  for (let i = 0; i < n; i++) out.push(`h q[${i}];\nmeasure q[${i}] -> c[${i}];\n`);
  return out.join('');
}

/** Deutsch-Jozsa. kind is 'constant-zero' | 'constant-one' | 'balanced'. */
export function dj(n, kind, mask) {
  const out = [HEADER, `qreg q[${n + 1}];\ncreg c[${n}];\nx q[${n}];\n`];
  for (let i = 0; i <= n; i++) out.push(`h q[${i}];\n`);
  if (kind === 'constant-one') out.push(`x q[${n}];\n`);
  else if (kind === 'balanced') {
    let any = false;
    for (let i = 0; i < n; i++) if (mask[i]) { out.push(`cx q[${i}], q[${n}];\n`); any = true; }
    if (!any) { out.push(`cx q[0], q[${n}];\n`); mask[0] = 1; }
  }
  for (let i = 0; i < n; i++) out.push(`h q[${i}];\nmeasure q[${i}] -> c[${i}];\n`);
  return out.join('');
}

// theta_r = 2*pi*frac(2^(t-1-r) * P/2^t) = (P mod 2^(r+1)) * pi / 2^r,
// written in lowest terms so it matches the supplied files exactly.
function thetaString(P, r) {
  let m = P & ((1n << BigInt(r + 1)) - 1n);
  if (m === 0n) return '0';
  let d = BigInt(r);
  while (d > 0n && (m & 1n) === 0n) { m >>= 1n; d -= 1n; }
  const den = 1n << d;
  const head = m === 1n ? 'pi' : `${m}*pi`;
  return den === 1n ? head : `${head}/${den}`;
}

/**
 * Iterative phase estimation of phase P/2^t over t rounds.
 * Text size grows as O(t^3) because round r spells out r feedback gates whose
 * denominators are ~0.3*t digits each; the solver itself is far cheaper.
 */
export function ipe(t, P) {
  const out = [HEADER, 'qreg q[2];\n'];
  for (let r = 0; r < t; r++) out.push(`creg b${r}[1];\n`);
  out.push('x q[1];\n');
  for (let r = 0; r < t; r++) {
    out.push('h q[0];\n');
    out.push(`cu1(${thetaString(P, r)}) q[0], q[1];\n`);
    for (let j = 0; j < r; j++) out.push(`if (b${j}==1) u1(-pi/${1n << BigInt(r - j)}) q[0];\n`);
    out.push('h q[0];\n');
    out.push(`measure q[0] -> b${r}[0];\n`);
    if (r !== t - 1) out.push('reset q[0];\n');
  }
  return out.join('');
}

/**
 * The t-bit dyadic approximation of num/den, as the integer P with phase
 * P/2^t. Truncating matches the supplied ipe_200.qasm, which encodes 10/17
 * floored at 200 bits.
 */
export function dyadicFromFraction(num, den, t, mode = 'floor') {
  const scale = 1n << BigInt(t);
  const n = BigInt(num), d = BigInt(den);
  if (d <= 0n) throw new Error('denominator must be positive');
  let p = mode === 'round' ? (n * scale + d / 2n) / d : (n * scale) / d;
  return ((p % scale) + scale) % scale; // wrap into [0, 2^t)
}

/** Predicted operation count, so the UI can warn before building a huge string. */
export function estimate(kind, n, weight = 0) {
  if (kind === 'ipe') {
    const t = n;
    return { operations: 1 + 2 * t + t + (t * (t - 1)) / 2 + t + (t - 1), bytes: Math.round(0.15 * t * t * t) };
  }
  const ops = 1 + (n + 1) + weight + 2 * n;
  return { operations: ops, bytes: ops * (String(n).length + 14) };
}
