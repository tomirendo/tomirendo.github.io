// OpenQASM 2.0 front end.
//
// The parser is streaming: operations are handed to a callback one at a time
// and never collected into an array. Peak memory therefore scales with the
// number of qubits, not the number of gates, which is what lets a BV file with
// a few million operations run in a browser tab.

import { ZERO, PI, num, add, sub, neg, mul, div } from './rational.js';

export class QasmError extends Error {
  constructor(category, message, line) {
    super(message);
    this.name = 'QasmError';
    this.category = category;
    this.line = line;
  }
}

// Hard caps, in the same units the parser counts. These are set by what a
// browser tab can actually hold rather than by anything about the circuits.
export const LIMITS = {
  bytes: 536_870_888, // the largest string this JS engine will hold
  lines: 50_000_000,
  statements: 50_000_000,
  operations: 200_000_000,
  qubits: 16_777_216,
  clbits: 16_777_216,
  width: 4_194_304,
};

// arity = qubit operands, params = classical parameters.
const GATES = new Map(Object.entries({
  id: [1, 0], x: [1, 0], y: [1, 0], z: [1, 0], h: [1, 0],
  s: [1, 0], sdg: [1, 0], t: [1, 0], tdg: [1, 0],
  u1: [1, 1], rx: [1, 1], ry: [1, 1], rz: [1, 1],
  u2: [1, 2], u3: [1, 3],
  cx: [2, 0], cz: [2, 0], swap: [2, 0], cu1: [2, 1],
  ccx: [3, 0],
}));

const isDigit = (c) => c >= 48 && c <= 57;
const isIdentStart = (c) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95;
const isIdentChar = (c) => isIdentStart(c) || isDigit(c);

class Cursor {
  constructor(src) {
    this.s = src;
    this.i = 0;
    this.n = src.length;
    this.line = 1;
  }

  // Skips whitespace and // comments, tracking line numbers.
  ws() {
    const s = this.s;
    while (this.i < this.n) {
      const c = s.charCodeAt(this.i);
      if (c === 10) { this.line++; this.i++; }
      else if (c === 32 || c === 9 || c === 13) this.i++;
      else if (c === 47 && s.charCodeAt(this.i + 1) === 47) {
        while (this.i < this.n && s.charCodeAt(this.i) !== 10) this.i++;
      } else break;
    }
  }

  eof() { this.ws(); return this.i >= this.n; }

  fail(msg, category = 'parse_error') {
    throw new QasmError(category, msg, this.line);
  }

  peek() { this.ws(); return this.i < this.n ? this.s.charCodeAt(this.i) : -1; }

  // Consumes `ch` if present, returns whether it was there.
  eat(ch) {
    this.ws();
    if (this.i < this.n && this.s.charCodeAt(this.i) === ch.charCodeAt(0)) { this.i++; return true; }
    return false;
  }

  expect(ch, what) {
    if (!this.eat(ch)) this.fail(`expected '${ch}'${what ? ` ${what}` : ''}`);
  }

  ident() {
    this.ws();
    const start = this.i;
    if (this.i >= this.n || !isIdentStart(this.s.charCodeAt(this.i))) return null;
    this.i++;
    while (this.i < this.n && isIdentChar(this.s.charCodeAt(this.i))) this.i++;
    return this.s.slice(start, this.i);
  }

  uint() {
    this.ws();
    const start = this.i;
    while (this.i < this.n && isDigit(this.s.charCodeAt(this.i))) this.i++;
    if (this.i === start) this.fail('expected an integer');
    return this.s.slice(start, this.i);
  }

  // register[index], or a bare register name (index -1 = whole register).
  reg() {
    const name = this.ident();
    if (name === null) this.fail('expected a register name');
    if (!this.eat('[')) return { name, index: -1 };
    const idx = this.uint();
    this.expect(']', 'after a register index');
    if (idx.length > 15) this.fail(`register index ${idx} is out of range`, 'validation_error');
    return { name, index: Number(idx) };
  }

  // --- parameter expressions: numbers, pi, unary +/-, and + - * / ----------
  expr() { return this.exprAdd(); }

  exprAdd() {
    let v = this.exprMul();
    for (;;) {
      this.ws();
      const c = this.i < this.n ? this.s.charCodeAt(this.i) : -1;
      if (c === 43) { this.i++; v = add(v, this.exprMul()); }
      else if (c === 45) { this.i++; v = sub(v, this.exprMul()); }
      else return v;
    }
  }

  exprMul() {
    let v = this.exprUnary();
    for (;;) {
      this.ws();
      const c = this.i < this.n ? this.s.charCodeAt(this.i) : -1;
      // '**' is not an operator here; reject it rather than reading it as '*'.
      if (c === 42) {
        if (this.s.charCodeAt(this.i + 1) === 42) {
          this.fail('exponentiation is not supported in parameter expressions', 'unsupported_feature');
        }
        this.i++; v = mul(v, this.exprUnary());
      } else if (c === 47) { this.i++; v = div(v, this.exprUnary()); }
      else return v;
    }
  }

  exprUnary() {
    this.ws();
    const c = this.i < this.n ? this.s.charCodeAt(this.i) : -1;
    if (c === 45) { this.i++; return neg(this.exprUnary()); }
    if (c === 43) { this.i++; return this.exprUnary(); }
    return this.exprAtom();
  }

  exprAtom() {
    this.ws();
    if (this.i >= this.n) this.fail('unexpected end of parameter expression');
    const c = this.s.charCodeAt(this.i);
    if (c === 40) {
      this.i++;
      const v = this.expr();
      this.expect(')', 'closing a parameter expression');
      return v;
    }
    if (isDigit(c) || c === 46) return this.number();
    if (c === 960) { this.i++; return PI; } // literal 'π'
    const id = this.ident();
    if (id === 'pi') return PI;
    if (id === null) this.fail('unexpected character in a parameter expression');
    // A bare name here is either a call like sin(...) or a symbolic variable.
    if (this.peek() === 40) {
      this.fail(`functions such as ${id}() are not supported in parameter expressions`, 'unsupported_feature');
    }
    this.fail(`symbolic variable '${id}' is not supported in parameter expressions`, 'unsupported_feature');
  }

  // Reads an integer / decimal / exponent literal into an exact rational.
  number() {
    const start = this.i;
    while (this.i < this.n && isDigit(this.s.charCodeAt(this.i))) this.i++;
    let frac = 0;
    if (this.i < this.n && this.s.charCodeAt(this.i) === 46) {
      this.i++;
      const fs = this.i;
      while (this.i < this.n && isDigit(this.s.charCodeAt(this.i))) this.i++;
      frac = this.i - fs;
    }
    let exp = 0n;
    if (this.i < this.n) {
      const e = this.s.charCodeAt(this.i);
      if (e === 101 || e === 69) {
        const save = this.i;
        this.i++;
        let sign = 1n;
        const sc = this.s.charCodeAt(this.i);
        if (sc === 43) this.i++;
        else if (sc === 45) { sign = -1n; this.i++; }
        const ds = this.i;
        while (this.i < this.n && isDigit(this.s.charCodeAt(this.i))) this.i++;
        if (this.i === ds) this.i = save; // not an exponent after all
        else exp = sign * BigInt(this.s.slice(ds, this.i));
      }
    }
    const text = this.s.slice(start, this.i);
    const digits = text.replace('.', '').split(/[eE]/)[0];
    if (!digits.length) this.fail('malformed number in a parameter expression');
    let n = BigInt(digits);
    let d = 10n ** BigInt(frac);
    if (exp > 0n) n *= 10n ** exp;
    else if (exp < 0n) d *= 10n ** -exp;
    return num(n, d);
  }
}

/**
 * Parses a program, streaming each operation to `onOp`.
 *
 * onOp receives a mutable, reused op record:
 *   { kind, q0, q1, q2, creg, cbit, params, cond, line }
 * It must not retain the object across calls.
 *
 * Returns { qreg, cregs, cregIndex, counts, lines, statements }.
 */
export function parse(source, onOp, limits = LIMITS, onDeclarations = null) {
  if (typeof source !== 'string' || source.length === 0) {
    throw new QasmError('parse_error', 'the submitted file is empty', 1);
  }
  if (source.length > limits.bytes) {
    throw new QasmError('resource_limit_exceeded',
      `input is ${source.length} characters, over the ${limits.bytes} limit`, 1);
  }
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);

  const cur = new Cursor(source);

  // --- header --------------------------------------------------------------
  cur.ws();
  const kw = cur.ident();
  if (kw !== 'OPENQASM') {
    throw new QasmError('parse_error', "the first statement must be 'OPENQASM 2.0;'", cur.line);
  }
  cur.ws();
  const vStart = cur.i;
  while (cur.i < cur.n && (isDigit(source.charCodeAt(cur.i)) || source.charCodeAt(cur.i) === 46)) cur.i++;
  const version = source.slice(vStart, cur.i);
  if (version !== '2.0') {
    throw new QasmError('unsupported_feature',
      `OpenQASM ${version || '(missing version)'} is not supported; use 2.0`, cur.line);
  }
  cur.expect(';', "after 'OPENQASM 2.0'");

  cur.ws();
  if (cur.ident() !== 'include') {
    throw new QasmError('parse_error', "the second statement must be 'include \"qelib1.inc\";'", cur.line);
  }
  cur.ws();
  if (!cur.eat('"')) cur.fail('expected a quoted include path');
  const pathStart = cur.i;
  while (cur.i < cur.n && source.charCodeAt(cur.i) !== 34) cur.i++;
  const incPath = source.slice(pathStart, cur.i);
  cur.expect('"', 'closing the include path');
  if (incPath !== 'qelib1.inc') {
    throw new QasmError('unsupported_feature',
      `include "${incPath}" is not supported; use include "qelib1.inc"`, cur.line);
  }
  cur.expect(';', 'after the include statement');

  // --- declarations and operations ----------------------------------------
  let qreg = null;
  const cregs = [];
  const cregIndex = new Map();
  let clbits = 0;
  let sawOperation = false;
  let statements = 2;
  let operations = 0;
  const counts = Object.create(null);

  // One reused record, refilled per operation.
  const op = {
    kind: '', q0: -1, q1: -1, q2: -1, creg: -1, cbit: -1,
    params: null, cond: null, line: 0,
  };

  const emit = () => {
    // Declarations are complete by the time the first operation lands, so this
    // is where a profile matcher gets to see the register layout.
    if (operations === 0 && onDeclarations) onDeclarations({ qreg, cregs, cregIndex });
    operations++;
    if (operations > limits.operations) {
      throw new QasmError('resource_limit_exceeded',
        `more than ${limits.operations} operations`, cur.line);
    }
    counts[op.kind] = (counts[op.kind] || 0) + 1;
    onOp(op);
  };

  const checkQubit = (r, what) => {
    if (r.name !== qreg.name) {
      cur.fail(`'${r.name}' is not the declared quantum register '${qreg.name}'`, 'validation_error');
    }
    if (r.index >= qreg.size) {
      cur.fail(`${r.name}[${r.index}] is outside 0..${qreg.size - 1}`, 'validation_error');
    }
    if (r.index < 0 && what !== 'broadcast') {
      cur.fail(`${what} requires an indexed qubit such as ${r.name}[0]`, 'validation_error');
    }
    return r.index;
  };

  while (!cur.eof()) {
    op.line = cur.line;
    op.cond = null;
    op.params = null;
    op.q0 = op.q1 = op.q2 = op.creg = op.cbit = -1;

    const startLine = cur.line;
    let name = cur.ident();
    if (name === null) cur.fail('expected a statement');

    statements++;
    if (statements > limits.statements) {
      throw new QasmError('resource_limit_exceeded',
        `more than ${limits.statements} statements`, startLine);
    }

    // Optional classical condition wrapping a single operation.
    if (name === 'if') {
      cur.expect('(', "after 'if'");
      const reg = cur.ident();
      if (reg === null) cur.fail("expected a classical register name inside 'if'");
      cur.ws();
      if (!(cur.eat('=') && cur.eat('='))) cur.fail("expected '==' inside an if condition");
      const val = cur.uint();
      cur.expect(')', 'closing an if condition');
      if (!cregIndex.has(reg)) {
        cur.fail(`if condition references undeclared classical register '${reg}'`, 'validation_error');
      }
      op.cond = { reg, value: BigInt(val) };
      name = cur.ident();
      if (name === null) cur.fail('expected an operation after an if condition');
      if (name === 'if') cur.fail('if conditions cannot be nested', 'unsupported_feature');
    }

    switch (name) {
      case 'OPENQASM':
        cur.fail('duplicate OPENQASM version statement', 'validation_error');
        break;

      case 'include':
        cur.fail('include is only allowed as the second statement', 'validation_error');
        break;

      case 'qreg':
      case 'creg': {
        if (op.cond) cur.fail('a declaration cannot be conditional');
        if (sawOperation) {
          cur.fail(`${name} declaration appears after an operation; declarations must precede operations`,
            'validation_error');
        }
        const r = cur.reg();
        cur.expect(';', 'after a register declaration');
        if (r.index < 0) cur.fail(`${name} ${r.name} is missing a size, e.g. ${r.name}[4]`);
        if (r.index === 0) cur.fail(`${name} ${r.name}[0] must declare at least one bit`, 'validation_error');
        if (name === 'qreg') {
          if (qreg) {
            cur.fail('only one quantum register is supported; combine the qubits into one qreg',
              'unsupported_feature');
          }
          if (r.index > limits.qubits) {
            cur.fail(`qreg ${r.name}[${r.index}] exceeds the ${limits.qubits} qubit limit`,
              'resource_limit_exceeded');
          }
          qreg = { name: r.name, size: r.index };
        } else {
          if (cregIndex.has(r.name)) {
            cur.fail(`classical register '${r.name}' is declared twice`, 'validation_error');
          }
          clbits += r.index;
          if (clbits > limits.clbits) {
            cur.fail(`declared classical bits exceed the ${limits.clbits} limit`, 'resource_limit_exceeded');
          }
          cregIndex.set(r.name, cregs.length);
          cregs.push({ name: r.name, size: r.index });
        }
        continue;
      }

      case 'measure': {
        if (!qreg) cur.fail('no quantum register has been declared', 'validation_error');
        const q = cur.reg();
        cur.ws();
        if (!(cur.eat('-') && cur.eat('>'))) cur.fail("expected '->' in a measure statement");
        const c = cur.reg();
        cur.expect(';', 'after a measure statement');
        op.kind = 'measure';
        op.q0 = checkQubit(q, 'measure');
        const ci = cregIndex.get(c.name);
        if (ci === undefined) cur.fail(`undeclared classical register '${c.name}'`, 'validation_error');
        if (c.index >= cregs[ci].size) {
          cur.fail(`${c.name}[${c.index}] is outside 0..${cregs[ci].size - 1}`, 'validation_error');
        }
        if (c.index < 0) cur.fail('measure requires an indexed classical bit', 'validation_error');
        op.creg = ci;
        op.cbit = c.index;
        sawOperation = true;
        emit();
        continue;
      }

      case 'reset': {
        if (!qreg) cur.fail('no quantum register has been declared', 'validation_error');
        const q = cur.reg();
        cur.expect(';', 'after a reset statement');
        op.kind = 'reset';
        op.q0 = checkQubit(q, 'reset');
        sawOperation = true;
        emit();
        continue;
      }

      case 'barrier': {
        if (!qreg) cur.fail('no quantum register has been declared', 'validation_error');
        do { checkQubit(cur.reg(), 'broadcast'); } while (cur.eat(','));
        cur.expect(';', 'after a barrier statement');
        op.kind = 'barrier';
        sawOperation = true;
        emit();
        continue;
      }

      case 'gate':
      case 'opaque':
        cur.fail(`user-defined '${name}' declarations are not supported`, 'unsupported_feature');
        break;

      default: {
        const spec = GATES.get(name);
        if (!spec) cur.fail(`unsupported operation '${name}'`, 'unsupported_feature');
        if (!qreg) cur.fail('no quantum register has been declared', 'validation_error');
        const [arity, nparams] = spec;

        let params = null;
        if (cur.peek() === 40) {
          cur.i++;
          params = [];
          if (!cur.eat(')')) {
            do { params.push(cur.expr()); } while (cur.eat(','));
            cur.expect(')', 'closing the parameter list');
          }
        }
        const got = params ? params.length : 0;
        if (got !== nparams) {
          cur.fail(`${name} takes ${nparams} parameter(s) but ${got} were given`, 'validation_error');
        }

        const qs = [];
        do { qs.push(cur.reg()); } while (cur.eat(','));
        cur.expect(';', `after the ${name} statement`);
        if (qs.length !== arity) {
          cur.fail(`${name} takes ${arity} qubit operand(s) but ${qs.length} were given`, 'validation_error');
        }
        op.kind = name;
        op.params = params;
        op.q0 = checkQubit(qs[0], name);
        if (arity > 1) op.q1 = checkQubit(qs[1], name);
        if (arity > 2) op.q2 = checkQubit(qs[2], name);
        if (arity > 1 && (op.q0 === op.q1 || op.q0 === op.q2 || (arity > 2 && op.q1 === op.q2))) {
          cur.fail(`${name} was given the same qubit twice`, 'validation_error');
        }
        sawOperation = true;
        emit();
      }
    }
  }

  if (!qreg) throw new QasmError('validation_error', 'no quantum register was declared', cur.line);
  if (!cregs.length) throw new QasmError('validation_error', 'no classical register was declared', cur.line);

  return { qreg, cregs, cregIndex, counts, operations, statements, lines: cur.line };
}
