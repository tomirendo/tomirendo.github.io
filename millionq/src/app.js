import { estimate } from './generate.js';

const $ = (id) => document.getElementById(id);

// Circuits can be tens of megabytes; a textarea that large is unusable, so the
// authoritative copy lives here and the editor shows a preview instead.
const EDITABLE_MAX = 1_500_000;
let source = '';
let editorHoldsSource = true;

// The single-file build inlines the worker source and the example circuits, so
// that build works straight off the filesystem with no server.
const worker = self.__BBZ_WORKER_SRC__
  ? new Worker(URL.createObjectURL(new Blob([self.__BBZ_WORKER_SRC__], { type: 'text/javascript' })))
  : new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let seq = 0;
const pending = new Map();

worker.onmessage = (ev) => {
  const { id, type } = ev.data;
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  if (type === 'failed') entry.reject(new Error(ev.data.message));
  else entry.resolve(ev.data);
};
worker.onerror = (e) => setStatus(`worker error: ${e.message}`, 'err');

const ask = (msg) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  worker.postMessage({ ...msg, id });
});

// ── formatting helpers ─────────────────────────────────────────────────────
const nf = (n) => Number(n).toLocaleString('en-US');
const bytes = (n) =>
  n < 1024 ? `${n} B`
  : n < 1048576 ? `${(n / 1024).toFixed(1)} KiB`
  : `${(n / 1048576).toFixed(1)} MiB`;
const ms = (t) => (t < 1 ? `${(t * 1000).toFixed(0)} µs` : t < 1000 ? `${t.toFixed(1)} ms` : `${(t / 1000).toFixed(2)} s`);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function setStatus(text, cls = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${cls}`;
}

// ── the source of truth for the circuit text ───────────────────────────────
function setSource(text, label) {
  source = text;
  const ta = $('source');
  editorHoldsSource = text.length <= EDITABLE_MAX;

  if (editorHoldsSource) {
    ta.value = text;
    ta.readOnly = false;
    $('big-note').hidden = true;
  } else {
    // Show the head and tail so the shape is still visible.
    const lines = text.split('\n');
    const head = lines.slice(0, 40).join('\n');
    const tail = lines.slice(-12).join('\n');
    ta.value = `${head}\n\n… ${nf(lines.length - 52)} more lines …\n\n${tail}`;
    ta.readOnly = true;
    $('big-note').hidden = false;
    $('big-note').textContent =
      `Preview only — ${bytes(text.length)} is too large to edit in a textarea. `
      + `The full circuit is held in memory and is what Run and Download use.`;
  }

  const lineCount = text ? text.split('\n').length : 0;
  $('src-info').textContent = text
    ? `${label ? label + ' · ' : ''}${nf(lineCount)} lines · ${bytes(text.length)}`
    : 'no circuit loaded';
  $('download-src').hidden = !text;
}

function currentSource() {
  return editorHoldsSource ? $('source').value : source;
}

$('source').addEventListener('input', () => {
  if (!editorHoldsSource) return;
  source = $('source').value;
  const n = source ? source.split('\n').length : 0;
  $('src-info').textContent = source ? `${nf(n)} lines · ${bytes(source.length)}` : 'no circuit loaded';
  $('download-src').hidden = !source;
});

// ── running ────────────────────────────────────────────────────────────────
async function runCircuit() {
  const src = currentSource();
  if (!src.trim()) { setStatus('nothing to run', 'err'); return; }
  $('run-btn').disabled = true;
  setStatus('solving…');
  const t0 = performance.now();
  try {
    const { result } = await ask({ type: 'run', source: src, algorithm: $('algorithm').value });
    const wall = performance.now() - t0;
    render(result, wall);
    setStatus(result.status === 'ok' ? `ok in ${ms(wall)}` : 'rejected',
      result.status === 'ok' ? 'ok' : 'err');
  } catch (e) {
    setStatus(e.message, 'err');
  } finally {
    $('run-btn').disabled = false;
  }
}

function field(k, v, cls = '') {
  return `<div class="field"><div class="k">${k}</div><div class="bits ${cls}">${esc(v)}</div></div>`;
}

function render(r, wall) {
  const out = $('out');

  if (r.status !== 'ok') {
    out.innerHTML = `
      <div class="res-head">
        <div class="verdict bad"><span class="dot"></span>rejected — ${esc(r.error)}</div>
      </div>
      <div class="res-body">
        <div class="errbox">${esc(r.message)}${r.line ? `\n\nat line ${r.line}` : ''}</div>
        <p class="placeholder" style="padding:0">
          These are the same five error categories the guide documents in §8.3.
        </p>
      </div>`;
    return;
  }

  const res = r.result;
  let body = '';

  if (r.profile === 'bv') {
    body += field(`secret · ${nf(res.width)} bits · c[0] first`, res.secret);
    body += field('hamming weight', `${nf(res.secret_weight)} of ${nf(res.width)}`, 'num');
  } else if (r.profile === 'dj') {
    body += field('verdict', res.verdict === 'balanced' ? 'BALANCED' : `CONSTANT (f ≡ ${res.constant_value})`, 'num');
    body += field('oracle form', res.oracle);
    if (res.balanced_mask) {
      body += field(`oracle mask · ${nf(res.width)} bits`, res.balanced_mask);
    }
    body += field(`measured register · ${nf(res.width)} bits`, res.measured);
  } else {
    body += field('phase φ', res.phase, 'num');
    body += field(`φ in decimal · exact to ${nf(res.rounds)} binary places`, res.phase_decimal);
    body += field('numerator P', res.numerator);
    body += field(`measured bits · b0 first · ${nf(res.rounds)} rounds`, res.bits);
    body += field('every round deterministic', res.deterministic ? 'yes' : `no — ${nf(res.probabilistic_rounds)} sampled round(s)`);
  }

  const stat = (k, v, hi) => `<div class="stat"><div class="k">${k}</div><div class="v ${hi ? 'hi' : ''}">${v}</div></div>`;

  out.innerHTML = `
    <div class="res-head">
      <div class="verdict"><span class="dot"></span>accepted — ${esc(r.profile).toUpperCase()} profile</div>
      <div class="stats">
        ${stat('logical width', nf(r.logical_qubits), true)}
        ${stat('operations', nf(r.operations))}
        ${stat('input', bytes(r.bytes))}
        ${stat('solve time', ms(r.elapsed_ms), true)}
        ${stat('round trip', ms(wall))}
      </div>
    </div>
    <div class="res-body">
      ${body}
      <details class="raw"><summary>evaluator response</summary><pre>${esc(JSON.stringify(compact(r), null, 2))}</pre></details>
    </div>`;
}

// Keep the JSON readable when a field is a 200,000-character bit string.
function compact(r) {
  const clip = (v) => (typeof v === 'string' && v.length > 140 ? `${v.slice(0, 132)}… (${nf(v.length)} chars)` : v);
  const walk = (o) => {
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === 'object') {
      const n = {};
      for (const [k, v] of Object.entries(o)) n[k] = walk(v);
      return n;
    }
    return clip(o);
  };
  return walk(r);
}

// ── examples ───────────────────────────────────────────────────────────────
$('example').addEventListener('change', async (e) => {
  const name = e.target.value;
  if (!name) return;
  setStatus('loading…');
  try {
    let text = self.__BBZ_EXAMPLES__ && self.__BBZ_EXAMPLES__[name];
    if (text === undefined) {
      const res = await fetch(`examples/${name}`);
      if (!res.ok) throw new Error(`could not load ${name} (${res.status})`);
      text = await res.text();
    }
    setSource(text, name);
    setStatus('loaded — press Run', '');
    // The published files are unambiguous, so pin the matching algorithm.
    $('algorithm').value = name.startsWith('bv') ? 'bv' : name.startsWith('dj') ? 'dj' : 'ipe';
  } catch (err) {
    setStatus(err.message, 'err');
  }
});

// Reading a dropped or picked file is a pure client-side operation: the File
// API hands the text straight to the page, so nothing is uploaded anywhere.
async function loadFile(f) {
  if (!f) return;
  setStatus(`reading ${f.name}…`);
  setSource(await f.text(), f.name);
  $('example').value = '';
  const guess = /^bv/i.test(f.name) ? 'bv' : /^dj/i.test(f.name) ? 'dj' : /^ipe/i.test(f.name) ? 'ipe' : null;
  if (guess) $('algorithm').value = guess;
  setStatus('loaded — press Run', '');
}

$('file').addEventListener('change', (e) => loadFile(e.target.files[0]));

const dropZone = document.querySelector('.editor-wrap');
for (const ev of ['dragenter', 'dragover']) {
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('dropping'); });
}
for (const ev of ['dragleave', 'drop']) {
  dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('dropping'); });
}
dropZone.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

$('download-src').addEventListener('click', () => {
  const blob = new Blob([currentSource()], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'circuit.qasm';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('run-btn').addEventListener('click', runCircuit);

// ── generator ──────────────────────────────────────────────────────────────
function syncGenUI() {
  const kind = $('gen-kind').value;
  $('wrap-secret').hidden = kind !== 'bv';
  $('wrap-oracle').hidden = kind !== 'dj';
  $('wrap-phase').hidden = kind !== 'ipe';
  $('width-hint').textContent = kind === 'ipe' ? 'rounds' : 'query qubits';
  const w = $('gen-width');
  if (kind === 'ipe' && Number(w.value) > 600) w.value = 400;
  if (kind !== 'ipe' && Number(w.value) < 100) w.value = 2000;
  showEstimate();
}

function showEstimate() {
  const kind = $('gen-kind').value;
  const width = Math.max(1, Number($('gen-width').value) || 1);
  const est = estimate(kind, width, kind === 'ipe' ? 0 : Math.floor(width / 2));
  let msg = `≈ <b>${nf(est.operations)}</b> gates, ≈ <b>${bytes(est.bytes)}</b> of QASM`;
  // The state vector this never has to build.
  if (kind !== 'ipe') {
    const digits = Math.round(width * Math.log10(2));
    msg += ` · a state vector for ${nf(width)} qubits would need <b>2^${nf(width)}</b> amplitudes`
         + ` (a ${nf(digits)}-digit number)`;
  }
  if (est.bytes > 60_000_000) {
    msg += ` <span class="warn">— large enough to be slow to build; consider a smaller width.</span>`;
  } else if (kind === 'ipe' && width > 400) {
    msg += ` <span class="warn">— IPE text grows as O(t³) because round r spells out r feedback gates.</span>`;
  }
  $('gen-estimate').innerHTML = msg;
}

async function generate(thenRun) {
  const kind = $('gen-kind').value;
  const width = Math.max(1, Math.floor(Number($('gen-width').value) || 1));
  const msg = { type: 'generate', kind, width };

  if (kind === 'bv') {
    const s = $('gen-secret').value.trim();
    if (s) {
      if (!/^[01]+$/.test(s)) { setStatus('a secret must be 0s and 1s', 'err'); return; }
      msg.secret = s;
      msg.width = s.length;
      $('gen-width').value = s.length;
    } else {
      msg.weight = null;
    }
  } else if (kind === 'dj') {
    msg.oracle = $('gen-oracle').value;
    msg.weight = null;
  } else {
    msg.phaseMode = 'fraction';
    msg.num = String(Math.max(0, Math.floor(Number($('gen-num').value) || 0)));
    msg.den = String(Math.max(1, Math.floor(Number($('gen-den').value) || 1)));
  }

  $('gen-btn').disabled = $('gen-run').disabled = true;
  setStatus('generating…');
  try {
    const out = await ask(msg);
    setSource(out.source, `generated ${kind} · width ${nf(msg.width)}`);
    $('example').value = '';
    $('algorithm').value = kind;
    setStatus(`generated in ${ms(out.elapsed)}${out.note ? ' — see note' : ''}`, 'ok');
    if (out.note) { $('big-note').hidden = false; $('big-note').textContent = out.note; }
    document.getElementById('run').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (thenRun) await runCircuit();
  } catch (e) {
    setStatus(e.message, 'err');
  } finally {
    $('gen-btn').disabled = $('gen-run').disabled = false;
  }
}

$('gen-kind').addEventListener('change', syncGenUI);
$('gen-width').addEventListener('input', showEstimate);
$('gen-btn').addEventListener('click', () => generate(false));
$('gen-run').addEventListener('click', () => generate(true));

syncGenUI();
setSource('', null);
