# MillionQ

A million-qubit OpenQASM 2.0 simulator that runs entirely in a browser tab.

MillionQ reads ordinary OpenQASM 2.0 and solves three circuit families exactly:

| Profile | What it recovers |
| --- | --- |
| Bernstein–Vazirani | the hidden secret string |
| Deutsch–Jozsa | constant vs. balanced, plus the oracle mask |
| Iterative phase estimation | the phase φ, as an exact rational |

No server, no account, no network request. Open the page and press Run.

## Why a million qubits is reasonable

A general quantum circuit needs memory exponential in the qubit count, and nothing here
claims otherwise — a million-qubit state vector would have 2<sup>1,000,000</sup> amplitudes.
These three families are special: each collapses to an exact identity that can be evaluated
in a single streaming pass.

- **BV** — the oracle is a row of `cx q[i], q[N]` gates against an ancilla held in |−⟩. Each
  control kicks a phase of (−1)<sup>s<sub>i</sub></sup>, and the closing H layer turns the phase
  pattern back into the bit pattern. So `c[i] = s_i = 1` exactly when `cx q[i], q[N]` appears.
- **DJ** — a canonical oracle is empty, a single `x q[N]`, or a set of `cx` controls. The first
  two are constant, the third is balanced. The verdict is a property of the oracle's shape.
- **IPE** — `q[1]` sits in |1⟩, an eigenstate of `cu1`, so it never entangles. One recycled
  control carries α<sub>r</sub> = θ<sub>r</sub> − Σ<sub>j&lt;r</sub> b<sub>j</sub>·π/2<sup>r−j</sup>
  and is measured right after an H, giving P(1) = sin²(α<sub>r</sub>/2). For a dyadic phase
  α<sub>r</sub>/π is an integer, so each round is deterministic and the bit is its parity.

The parser is streaming — operations are handed to a matcher one at a time and never collected
into an array — so peak memory scales with the number of qubits, not the number of gates.

### Exact angles

Phase estimation at *t* rounds uses angles of the form p·π/2<sup>t−1</sup>. By round 53 that is
below the spacing of adjacent float64 values, and by round 200 a double rounds it to zero.

MillionQ never converts a gate angle to a float. Parameters are parsed into exact rationals of π
backed by `BigInt` (`src/rational.js`), kept exact through every operation, and each round's
outcome is decided by an integer parity test rather than a floating-point comparison. That is why
the 200-round sample returns a 60-digit numerator over 2<sup>200</sup> rather than an
approximation — it encodes **1/7 truncated to 200 binary places**, a value whose binary
expansion never terminates.

## Measured

End to end: build the QASM text, parse every statement, solve, verify against the planted answer.

| Profile | Width | Gates | QASM | Solve |
| --- | --- | --- | --- | --- |
| BV | 1,000 | 3,502 | 0.1 MiB | 16 ms |
| BV | 10,000 | 35,002 | 0.6 MiB | 21 ms |
| BV | 100,000 | 350,002 | 6.2 MiB | 112 ms |
| **BV** | **1,000,000** | **3,500,002** | **67.2 MiB** | **942 ms** |
| **DJ** | **1,000,000** | **3,500,002** | **67.2 MiB** | **1.08 s** |
| IPE | 200 rounds | 20,900 | 0.9 MiB | 45 ms |
| IPE | 500 rounds | 127,250 | 9.4 MiB | 184 ms |
| IPE | 800 rounds | 323,600 | 33.4 MiB | 511 ms |

Reproduce with `npm run bench`. IPE text grows as O(t³) — round *r* spells out *r* feedback gates
whose denominators are ~0.3·*t* digits each — so the practical round ceiling is set by file size,
not by the solver.

## Running it

```sh
npm run serve     # http://localhost:8731
npm test          # 89 assertions
npm run bench     # the table above
npm run build     # dist/millionq.html — one self-contained file
```

`dist/millionq.html` inlines the styles, both bundles and every sample circuit. It works from
`file://` with no server and no network at all.

## Layout

```
index.html          page
styles.css          styles
src/rational.js     exact a + b·π arithmetic over BigInt rationals
src/qasm.js         streaming OpenQASM 2.0 parser
src/profiles.js     profile matchers and closed-form solvers
src/generate.js     canonical circuit generators
src/worker.js       off-main-thread entry point
src/app.js          UI
examples/           generated sample circuits
tools/              sample generation and deploy
test/               correctness, round-trip and scaling checks
build.mjs           single-file bundler (no toolchain)
```

## Tests

`npm test` covers:

- every shipped sample parses, matches a profile, and returns the parameters it was built from
- planted secrets and phases are recovered exactly, at widths well past the samples
- 20 malformed and non-canonical circuits are rejected with the right error category
- generate → parse → solve round-trips for BV, DJ and IPE across three orders of magnitude

Sample circuits are generated, not vendored: `npm run samples` rebuilds `examples/` from
`tools/make-samples.mjs` deterministically.

## Accepted input

OpenQASM 2.0, one `qreg`, at least one `creg`, declarations before operations. Gates recognised:
`id u1 u2 u3 x y z h s sdg t tdg rx ry rz cx cz swap ccx cu1`, plus `measure`, `reset`, `barrier`
and `if (reg==int)` guarding a single operation. Parameter expressions accept numbers, `pi`, unary
`+`/`-` and `+ - * /`; functions, exponentiation and symbolic variables are rejected. A circuit
that parses but does not match one of the three profiles is reported as `unsupported_profile`.
