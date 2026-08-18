// Canonical profile recognition and closed-form solution.
//
// Each of the three supported profiles has an analytic answer, so none of them
// needs a state vector:
//
//   BV  the measured register is exactly the set of oracle cx controls
//   DJ  same readout; the oracle form alone decides constant vs balanced
//   IPE the control qubit carries phase alpha_r = theta_r - sum_j b_j*pi/2^(r-j)
//       and is measured right after an H, so P(1) = sin^2(alpha_r / 2). For an
//       exact dyadic phase alpha_r/pi is always an integer and every round is
//       deterministic.
//
// Everything runs in one streaming pass with O(width) memory.

import { parse, QasmError, LIMITS } from './qasm.js';
import { isPiMultiple, isZero, toFloat, ratToDecimal, angleToString } from './rational.js';

const err = (msg, line, category = 'unsupported_profile') => {
  throw new QasmError(category, msg, line);
};

// ---------------------------------------------------------------------------
// Bernstein-Vazirani / Deutsch-Jozsa
//
// Both families share a layout, so one matcher walks the sequence and the
// classification is decided at the end from the oracle form and prep order.
// ---------------------------------------------------------------------------
class BvDjMatcher {
  constructor(decl) {
    const { qreg, cregs } = decl;
    this.n = qreg.size - 1; // logical width; q[n] is the ancilla
    if (this.n < 1) err(`qreg ${qreg.name}[${qreg.size}] leaves no query qubits; BV/DJ need q[N+1] with N>=1`, 1);
    if (cregs.length !== 1) {
      err(`BV/DJ require exactly one classical register, found ${cregs.length}`, 1);
    }
    if (cregs[0].size !== this.n) {
      err(`with qreg[${qreg.size}] the classical register must be ${cregs[0].name}[${this.n}], found [${cregs[0].size}]`, 1);
    }
    this.stage = 'x';
    this.prepSeen = new Uint8Array(this.n + 1);
    this.prepCount = 0;
    this.prepAscending = true;
    this.prepLast = -1;
    this.secret = new Uint8Array(this.n);
    this.controls = 0;
    this.oracleX = 0;
    this.readIndex = 0;
    this.awaitMeasure = false;
  }

  op(o) {
    if (o.kind === 'barrier') return;
    if (o.cond) err('BV/DJ contain no classical conditions', o.line);
    const N = this.n;

    switch (this.stage) {
      case 'x':
        if (o.kind !== 'x' || o.q0 !== N) {
          err(`BV/DJ must begin with x q[${N}] on the ancilla`, o.line);
        }
        this.stage = 'prep';
        return;

      case 'prep': {
        if (o.kind !== 'h') err(`expected an H preparation gate, found '${o.kind}'`, o.line);
        if (this.prepSeen[o.q0]) err(`q[${o.q0}] is prepared with H twice`, o.line);
        this.prepSeen[o.q0] = 1;
        if (o.q0 < this.prepLast) this.prepAscending = false;
        this.prepLast = o.q0;
        if (++this.prepCount === N + 1) this.stage = 'oracle';
        return;
      }

      case 'oracle':
        // The readout begins with h q[0]; anything else is still the oracle.
        if (o.kind === 'h' && o.q0 === 0) {
          this.stage = 'readout';
          this.awaitMeasure = true;
          return;
        }
        if (o.kind === 'x' && o.q0 === N) {
          if (++this.oracleX > 1) err('the constant-one oracle applies x q[N] exactly once', o.line);
          return;
        }
        if (o.kind === 'cx') {
          if (o.q1 !== N) err(`oracle cx must target the ancilla q[${N}], found q[${o.q1}]`, o.line);
          if (this.secret[o.q0]) err(`duplicate oracle control on q[${o.q0}]`, o.line);
          this.secret[o.q0] = 1;
          this.controls++;
          return;
        }
        err(`'${o.kind}' is valid OpenQASM but not part of a canonical BV/DJ oracle`, o.line);
        return;

      case 'readout': {
        const i = this.readIndex;
        if (this.awaitMeasure) {
          if (o.kind !== 'measure') err(`expected measure q[${i}] -> c[${i}] directly after h q[${i}]`, o.line);
          if (o.q0 !== i) err(`expected measure q[${i}], found q[${o.q0}]`, o.line);
          if (o.cbit !== i) err(`q[${i}] must be measured into c[${i}], found c[${o.cbit}]`, o.line);
          this.awaitMeasure = false;
          this.readIndex++;
          if (this.readIndex === N) this.stage = 'done';
          return;
        }
        if (o.kind !== 'h' || o.q0 !== i) {
          err(`expected h q[${i}] to open readout index ${i}`, o.line);
        }
        this.awaitMeasure = true;
        return;
      }

      default:
        err(`trailing '${o.kind}' after the final measurement`, o.line);
    }
  }

  finish() {
    if (this.stage !== 'done') err('the circuit ends before the canonical sequence is complete', 0);
    const N = this.n;
    const bits = new Array(N);
    for (let i = 0; i < N; i++) bits[i] = this.secret[i] ? '1' : '0';
    const mask = bits.join('');

    // Which families this sequence is a legal instance of.
    const mixed = this.oracleX === 1 && this.controls > 0;
    const bvOk = this.oracleX === 0;
    const djOk = !mixed && this.prepAscending;

    const reasons = [];
    if (!bvOk) reasons.push('BV: the oracle contains x q[N], which only DJ uses (constant-one)');
    if (mixed) reasons.push('DJ: constant-one and balanced oracle forms are mixed');
    else if (!this.prepAscending) reasons.push('DJ: preparation H gates are not in ascending order');

    const oracle = this.oracleX === 1 ? 'constant-one'
      : this.controls > 0 ? 'balanced' : 'constant-zero';

    return {
      width: N,
      mask,
      controls: this.controls,
      oracle,
      bvOk,
      djOk,
      reasons,
      // The register is measured deterministically: BV reads the secret, DJ
      // reads all-zero exactly when the oracle is constant.
      measured: this.oracleX === 1 ? '0'.repeat(N) : mask,
    };
  }
}

// ---------------------------------------------------------------------------
// Iterative phase estimation
// ---------------------------------------------------------------------------
class IpeMatcher {
  constructor(decl, rng) {
    const { qreg, cregs } = decl;
    if (qreg.size !== 2) err(`IPE requires exactly two qubits, found qreg[${qreg.size}]`, 1);
    for (const c of cregs) {
      if (c.size !== 1) {
        err(`IPE uses one one-bit register per round; '${c.name}[${c.size}]' is not one bit`, 1);
      }
    }
    this.t = cregs.length;
    this.cregs = cregs;
    this.rng = rng;
    this.round = 0;
    this.step = 'x';       // x -> h1 -> cu1 -> feedback -> h2 -> measure -> reset
    this.feedbackIndex = 0;
    this.theta = null;
    this.acc = 0n;         // sum_{j<r} b_j * 2^j
    this.bits = new Uint8Array(this.t);
    this.deterministic = true;
    this.probabilistic = [];
  }

  op(o) {
    if (o.kind === 'barrier') return;
    const r = this.round;

    switch (this.step) {
      case 'x':
        if (o.kind !== 'x' || o.q0 !== 1) err('IPE must begin with x q[1] to prepare the eigenstate', o.line);
        this.step = 'h1';
        return;

      case 'h1':
        if (o.cond) err(`round ${r}: the opening H is unconditional`, o.line);
        if (o.kind !== 'h' || o.q0 !== 0) err(`round ${r}: expected h q[0]`, o.line);
        this.step = 'cu1';
        return;

      case 'cu1':
        if (o.cond) err(`round ${r}: the controlled phase is unconditional`, o.line);
        if (o.kind !== 'cu1' || o.q0 !== 0 || o.q1 !== 1) {
          err(`round ${r}: expected cu1(theta) q[0], q[1]`, o.line);
        }
        this.theta = o.params[0];
        if (!isPiMultiple(this.theta)) {
          // Still solvable, just no longer exactly deterministic.
          this.deterministic = false;
        }
        this.feedbackIndex = 0;
        this.step = r === 0 ? 'h2' : 'feedback';
        return;

      case 'feedback': {
        // Round r carries one feedback gate for every earlier round, ascending.
        const j = this.feedbackIndex;
        if (o.kind === 'h' && !o.cond) {
          err(`round ${r}: missing feedback for round ${j}; every earlier round needs one`, o.line);
        }
        if (!o.cond) err(`round ${r}: expected 'if (${this.cregs[j].name}==1) u1(...) q[0]'`, o.line);
        if (o.cond.reg !== this.cregs[j].name) {
          err(`round ${r}: feedback registers must ascend; expected ${this.cregs[j].name}, found ${o.cond.reg}`, o.line);
        }
        if (o.cond.value !== 1n) err(`round ${r}: feedback condition must compare against 1`, o.line);
        if (o.kind !== 'u1' || o.q0 !== 0) err(`round ${r}: feedback must be u1(...) q[0]`, o.line);
        // Canonical angle is exactly -pi/2^(r-j).
        const a = o.params[0];
        const k = BigInt(r - j);
        const okAngle = isPiMultiple(a) && a.b[0] === -1n && a.b[1] === (1n << k);
        if (!okAngle) {
          err(`round ${r}: feedback from round ${j} must be u1(-pi/${1n << k}), found u1(${angleToString(a)})`, o.line);
        }
        if (++this.feedbackIndex === r) this.step = 'h2';
        return;
      }

      case 'h2':
        if (o.cond) err(`round ${r}: the closing H is unconditional`, o.line);
        if (o.kind !== 'h' || o.q0 !== 0) {
          if (o.cond || o.kind === 'u1') err(`round ${r}: more feedback gates than earlier rounds`, o.line);
          err(`round ${r}: expected the closing h q[0]`, o.line);
        }
        this.step = 'measure';
        return;

      case 'measure': {
        if (o.kind !== 'measure' || o.q0 !== 0) err(`round ${r}: expected measure q[0]`, o.line);
        if (o.creg !== r) {
          err(`round ${r}: must measure into ${this.cregs[r].name}[0], found ${this.cregs[o.creg].name}`, o.line);
        }
        this.bits[r] = this.resolveBit(r, o.line);
        if (this.bits[r]) this.acc |= 1n << BigInt(r);
        this.round++;
        this.step = this.round === this.t ? 'end' : 'reset';
        return;
      }

      case 'reset':
        if (o.kind !== 'reset' || o.q0 !== 0) err(`round ${r - 1}: expected reset q[0] before the next round`, o.line);
        this.step = 'h1';
        return;

      default:
        if (o.kind === 'reset') err('no reset is allowed after the final round', o.line);
        err(`trailing '${o.kind}' after the final measurement`, o.line);
    }
  }

  // alpha/pi = theta_r/pi - acc/2^r. Integer => deterministic outcome (its
  // parity); otherwise sample sin^2(alpha/2).
  resolveBit(r, line) {
    const th = this.theta;
    if (isPiMultiple(th)) {
      const [n, d] = th.b;
      const twoR = 1n << BigInt(r);
      const numer = n * twoR - this.acc * d;
      const denom = d * twoR;
      if (numer % denom === 0n) {
        const k = numer / denom;
        return Number(((k % 2n) + 2n) % 2n);
      }
      // Exactly representable angle, but not an integer multiple of pi: the
      // phase was not dyadic at this depth, so the round is genuinely random.
      this.deterministic = false;
      const frac = Number(ratToDecimal(((numer % (2n * denom)) + 2n * denom) % (2n * denom), denom, 20));
      const p1 = Math.sin((Math.PI * frac) / 2) ** 2;
      this.probabilistic.push({ round: r, p1 });
      return this.rng() < p1 ? 1 : 0;
    }
    const alpha = toFloat(th) - Math.PI * Number(this.acc) / 2 ** r;
    const p1 = Math.sin(alpha / 2) ** 2;
    this.probabilistic.push({ round: r, p1 });
    return this.rng() < p1 ? 1 : 0;
  }

  finish() {
    if (this.step !== 'end') err('the circuit ends before the final round completes', 0);
    const t = this.t;
    const bits = new Array(t);
    for (let i = 0; i < t; i++) bits[i] = this.bits[i] ? '1' : '0';
    const den = 1n << BigInt(t);
    // p/2^t terminates after exactly t decimal places, so t digits is the exact
    // expansion. Cap it so a 100k-round run does not print a 100k-digit number.
    const digits = Math.min(t, 1200);
    return {
      rounds: t,
      bits: bits.join(''),
      numerator: this.acc.toString(),
      denominator: den.toString(),
      phase: `${this.acc}/2^${t}`,
      phase_decimal: ratToDecimal(this.acc, den, digits),
      eigenvalue: `exp(2*pi*i * ${this.acc}/2^${t})`,
      deterministic: this.deterministic,
      probabilistic_rounds: this.probabilistic.length,
    };
  }
}

// ---------------------------------------------------------------------------

function pickFamily(decl) {
  const { qreg, cregs } = decl;
  if (qreg.size === 2 && cregs.length >= 2 && cregs.every((c) => c.size === 1)) return 'ipe';
  if (cregs.length === 1 && cregs[0].size === qreg.size - 1) return 'bvdj';
  // Single-round IPE is the remaining two-qubit shape.
  if (qreg.size === 2 && cregs.length === 1 && cregs[0].size === 1) return 'ipe';
  return null;
}

/**
 * Parses, recognizes and solves a circuit.
 * @param source     the .qasm text
 * @param options    { algorithm: 'auto'|'bv'|'dj'|'ipe', limits, rng }
 */
export function run(source, options = {}) {
  const { algorithm = 'auto', limits = LIMITS, rng = Math.random } = options;
  const started = (typeof performance !== 'undefined' ? performance : Date).now();

  let matcher = null;
  let family = null;
  let decl = null;

  const onDeclarations = (d) => {
    decl = d;
    family = pickFamily(d);
    if (family === null) {
      const shape = `qreg[${d.qreg.size}] with ${d.cregs.length} classical register(s)`;
      err(`${shape} does not match the BV, DJ or IPE register layout`, 1);
    }
    if (algorithm === 'ipe' && family !== 'ipe') {
      err(`--algorithm ipe was requested but the register layout is BV/DJ-shaped`, 1);
    }
    if ((algorithm === 'bv' || algorithm === 'dj') && family !== 'bvdj') {
      err(`--algorithm ${algorithm} was requested but the register layout is IPE-shaped`, 1);
    }
    matcher = family === 'ipe' ? new IpeMatcher(d, rng) : new BvDjMatcher(d);
  };

  const meta = parse(source, (o) => matcher.op(o), limits, onDeclarations);
  if (!matcher) err('the circuit declares registers but contains no operations', 1);
  const solved = matcher.finish();

  const elapsed = (typeof performance !== 'undefined' ? performance : Date).now() - started;
  const base = {
    status: 'ok',
    recognized_profile: true,
    unsupported: [],
    declared: {
      qreg: `${decl.qreg.name}[${decl.qreg.size}]`,
      cregs: decl.cregs.length <= 4
        ? decl.cregs.map((c) => `${c.name}[${c.size}]`)
        : [`${decl.cregs[0].name}[1]`, '...', `${decl.cregs[decl.cregs.length - 1].name}[1]`],
      creg_count: decl.cregs.length,
    },
    counts: meta.counts,
    operations: meta.operations,
    statements: meta.statements,
    bytes: source.length,
    elapsed_ms: elapsed,
  };

  if (family === 'ipe') {
    return { ...base, profile: 'ipe', algorithm: 'ipe', logical_qubits: solved.rounds, result: solved };
  }

  // BV and DJ describe the same sequence; report the requested reading.
  const { bvOk, djOk, reasons } = solved;
  let chosen = algorithm;
  if (algorithm === 'auto') {
    if (bvOk && djOk) chosen = 'bv';
    else if (bvOk) chosen = 'bv';
    else if (djOk) chosen = 'dj';
    else err(`the sequence matches neither BV nor DJ: ${reasons.join('; ')}`, 0);
  }
  if (chosen === 'bv' && !bvOk) err(reasons.find((r) => r.startsWith('BV')) || 'not a BV instance', 0);
  if (chosen === 'dj' && !djOk) err(reasons.find((r) => r.startsWith('DJ')) || 'not a DJ instance', 0);

  const result = chosen === 'bv'
    ? {
        width: solved.width,
        secret: solved.mask,
        secret_msb_first: solved.mask.split('').reverse().join(''),
        secret_weight: solved.controls,
        measured: solved.measured,
      }
    : {
        width: solved.width,
        oracle: solved.oracle,
        verdict: solved.oracle === 'balanced' ? 'balanced' : 'constant',
        constant_value: solved.oracle === 'constant-one' ? 1 : solved.oracle === 'constant-zero' ? 0 : null,
        balanced_mask: solved.oracle === 'balanced' ? solved.mask : null,
        measured: solved.measured,
      };

  return {
    ...base,
    profile: chosen,
    algorithm: algorithm === 'auto' ? `auto -> ${chosen}` : chosen,
    ambiguous: algorithm === 'auto' && bvOk && djOk,
    logical_qubits: solved.width,
    result,
  };
}

export function runSafe(source, options = {}) {
  try {
    return run(source, options);
  } catch (e) {
    if (e instanceof QasmError) {
      return {
        status: 'error',
        recognized_profile: false,
        error: e.category,
        message: e.message,
        line: e.line || null,
        unsupported: [e.category],
      };
    }
    return { status: 'error', recognized_profile: false, error: 'internal_error', message: String(e && e.message || e) };
  }
}
