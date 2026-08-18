// All parsing and solving happens here so a multi-megabyte circuit never blocks
// the UI thread.

import { runSafe } from './profiles.js';
import { bv, dj, ipe, randomMask, maskFromString, dyadicFromFraction, estimate } from './generate.js';

const now = () => performance.now();

self.onmessage = (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'run') {
      const result = runSafe(msg.source, { algorithm: msg.algorithm });
      self.postMessage({ type: 'result', id: msg.id, result });
      return;
    }

    if (msg.type === 'generate') {
      const t0 = now();
      const { kind, width } = msg;
      let source, note = null;

      if (kind === 'ipe') {
        let P;
        if (msg.phaseMode === 'fraction') {
          P = dyadicFromFraction(BigInt(msg.num), BigInt(msg.den), width);
          const exact = (BigInt(msg.num) * (1n << BigInt(width))) % BigInt(msg.den) === 0n;
          if (!exact) {
            note = `${msg.num}/${msg.den} is not a dyadic rational, so it was truncated to ${width} bits. `
                 + 'Every round still resolves deterministically against that truncation.';
          }
        } else {
          // Random t-bit phase.
          let acc = 0n;
          for (let i = 0; i < width; i++) if (Math.random() < 0.5) acc |= 1n << BigInt(i);
          P = acc;
        }
        source = ipe(width, P);
      } else {
        const mask = msg.secret
          ? maskFromString(msg.secret)
          : randomMask(width, msg.weight === null || msg.weight === undefined ? null : msg.weight);
        if (mask.length !== width) {
          throw new Error(`the secret is ${mask.length} bits but the width is ${width}`);
        }
        source = kind === 'bv' ? bv(width, mask) : dj(width, msg.oracle || 'balanced', mask);
      }

      self.postMessage({ type: 'generated', id: msg.id, source, note, elapsed: now() - t0 });
      return;
    }

    if (msg.type === 'estimate') {
      self.postMessage({ type: 'estimated', id: msg.id, ...estimate(msg.kind, msg.width, msg.weight || 0) });
      return;
    }
  } catch (e) {
    self.postMessage({ type: 'failed', id: msg.id, message: String((e && e.message) || e) });
  }
};
