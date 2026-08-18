// Exact arithmetic for OpenQASM parameter expressions.
//
// A gate angle is represented as  a + b*pi  where a and b are exact BigInt
// rationals. This is the whole reason the IPE profile can be pushed past 200
// rounds: at t rounds the phase schedule contains angles of the form
// p*pi/2^(t-1), which stops being representable in a float64 somewhere around
// t = 53 and is hopelessly wrong by t = 200.

export function gcd(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

// Rational as a normalized [num, den] pair, den > 0.
export function rat(n, d = 1n) {
  if (d === 0n) throw new RangeError('division by zero');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  return g > 1n ? [n / g, d / g] : [n, d];
}

const ratAdd = ([a, b], [c, d]) => rat(a * d + c * b, b * d);
const ratMul = ([a, b], [c, d]) => rat(a * c, b * d);
const ratNeg = ([a, b]) => [-a, b];
const ratIsZero = ([a]) => a === 0n;

// An angle value: { a, b } with a, b rationals, meaning a + b*pi.
export const ZERO = { a: [0n, 1n], b: [0n, 1n] };
export const PI = { a: [0n, 1n], b: [1n, 1n] };

export const num = (n, d = 1n) => ({ a: rat(n, d), b: [0n, 1n] });

export const add = (x, y) => ({ a: ratAdd(x.a, y.a), b: ratAdd(x.b, y.b) });
export const sub = (x, y) => ({ a: ratAdd(x.a, ratNeg(y.a)), b: ratAdd(x.b, ratNeg(y.b)) });
export const neg = (x) => ({ a: ratNeg(x.a), b: ratNeg(x.b) });

// pi*pi has no place in a gate angle, so reject it rather than silently
// approximating.
export function mul(x, y) {
  if (!ratIsZero(x.b) && !ratIsZero(y.b)) {
    throw new SyntaxError('pi*pi is not a supported parameter expression');
  }
  return {
    a: ratMul(x.a, y.a),
    b: ratAdd(ratMul(x.a, y.b), ratMul(y.a, x.b)),
  };
}

// Dividing by a multiple of pi leaves the a+b*pi family, so it is rejected too.
export function div(x, y) {
  if (!ratIsZero(y.b)) {
    throw new SyntaxError('division by a multiple of pi is not supported');
  }
  if (ratIsZero(y.a)) throw new RangeError('division by zero in parameter expression');
  const inv = [y.a[1], y.a[0]];
  const s = inv[1] < 0n ? [-inv[0], -inv[1]] : inv;
  return { a: ratMul(x.a, s), b: ratMul(x.b, s) };
}

export const isPiMultiple = (x) => ratIsZero(x.a);
export const isZero = (x) => ratIsZero(x.a) && ratIsZero(x.b);

// Compare an angle against an exact target, e.g. the canonical IPE feedback
// angle -pi/2^k.
export const eq = (x, y) =>
  x.a[0] === y.a[0] && x.a[1] === y.a[1] && x.b[0] === y.b[0] && x.b[1] === y.b[1];

// Decimal expansion of n/d to `digits` places. Used to print a 200-round phase,
// which needs ~60 significant digits and would otherwise round to garbage.
export function ratToDecimal(n, d, digits = 40) {
  const neg = n < 0n;
  if (neg) n = -n;
  const intPart = n / d;
  let rem = n % d;
  if (rem === 0n) return (neg ? '-' : '') + intPart.toString();
  const scaled = (rem * 10n ** BigInt(digits)) / d;
  let frac = scaled.toString().padStart(digits, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${intPart}.${frac || '0'}`;
}

// Best-effort float, for the cases where an angle is not an exact multiple of pi
// and an outcome probability has to be computed numerically.
export function toFloat(x) {
  const f = ([n, d]) => {
    const q = Number(n) / Number(d);
    if (Number.isFinite(q)) return q;
    // Numerator or denominator overflowed a double; divide with BigInt first.
    return Number(ratToDecimal(n, d, 25));
  };
  return f(x.a) + Math.PI * f(x.b);
}

export function angleToString(x) {
  const parts = [];
  const fmt = ([n, d], unit) => {
    if (n === 0n) return null;
    const sign = n < 0n ? '-' : '';
    const an = n < 0n ? -n : n;
    if (unit) {
      const head = an === 1n ? 'pi' : `${an}*pi`;
      return d === 1n ? sign + head : `${sign}${head}/${d}`;
    }
    return d === 1n ? `${sign}${an}` : `${sign}${an}/${d}`;
  };
  const a = fmt(x.a, false);
  const b = fmt(x.b, true);
  if (a) parts.push(a);
  if (b) parts.push(b);
  if (!parts.length) return '0';
  return parts.join(' + ').replace(/\+ -/g, '- ');
}
