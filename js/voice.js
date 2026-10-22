// Głos bez klawiatury: nagrywamy mikrofonem telefonu, a rozpoznawanie mowy (Whisper) działa w samej aplikacji.
// Model (~80 MB) pobiera się raz, potem jest w pamięci telefonu i działa także offline.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js';
const MODEL = 'onnx-community/whisper-base';
const MODEL_HQ = 'onnx-community/whisper-small';
const FLAG = 'kalendarz.voiceModel';

export const config = { hq: false };
const TRY_HQ = 'kalendarz.hqTry';
const FLAG_HQ = 'kalendarz.voiceHqModel';
const FAIL_HQ = 'kalendarz.voiceHqFail';
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };

const pipes = { base: null, hq: null };
const loading = {};
let lib = null;
let gpuInfo;

export const modelReady = () => get(FLAG) === '1' || get(FLAG_HQ) === '1';
export const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));

async function gpu() {
  if (gpuInfo !== undefined) return gpuInfo;
  gpuInfo = null;
  try {
    const ad = navigator.gpu && (await navigator.gpu.requestAdapter());
    if (ad) gpuInfo = { f16: ad.features && ad.features.has('shader-f16') };
  } catch { /* */ }
  return gpuInfo;
}

const failedRecently = () => Date.now() - (parseInt(get(FAIL_HQ) || '0', 10) || 0) < 6 * 3600 * 1000;
const wantHq = async () => {
  // jeśli poprzednia próba dokładnego modelu nie dobiegła końca (strona się zrestartowała), uznajemy, że telefon sobie nie radzi
  if (get(TRY_HQ) && !loading.hq && !pipes.hq) { put(FAIL_HQ, String(Date.now())); try { localStorage.removeItem(TRY_HQ); } catch { /* */ } }
  return wantHq2();
};
const wantHq2 = async () => config.hq && !failedRecently() && !!(await gpu());

async function importLib() {
  if (lib) return lib;
  let T;
  try { T = await import(/* webpackIgnore: true */ LIB); } catch (e) { throw new Error('biblioteka: ' + (e && e.message ? e.message : e)); }
  T.env.allowLocalModels = false;
  try { T.env.backends.onnx.wasm.numThreads = 1; T.env.backends.onnx.wasm.proxy = false; } catch { /* */ }
  lib = T;
  return T;
}

function load(kind, onProgress) {
  if (pipes[kind]) return Promise.resolve(pipes[kind]);
  if (loading[kind]) { loading[kind].cbs.push(onProgress); return loading[kind].p; }
  const cbs = [onProgress];
  const files = {};
  const p = (async () => {
    const T = await importLib();
    if (kind === 'hq') put(TRY_HQ, String(Date.now()));
    const g = kind === 'hq' ? await gpu() : null;
    const opts = kind === 'hq'
      ? { device: 'webgpu', dtype: { encoder_model: g && g.f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' } }
      : { device: 'wasm', dtype: 'q8' };
    let tr;
    try {
      tr = await T.pipeline('automatic-speech-recognition', kind === 'hq' ? MODEL_HQ : MODEL, {
        ...opts,
        progress_callback: (e) => {
          if (e.status === 'progress' && e.total) {
            files[e.file] = [e.loaded, e.total];
            let l = 0; let t = 0;
            for (const k in files) { l += files[k][0]; t += files[k][1]; }
            for (const f of cbs) f && f(Math.min(99, Math.round((l / t) * 100)));
          }
        },
      });
    } catch (e) { throw new Error('model: ' + (e && e.message ? e.message : String(e))); }
    pipes[kind] = tr;
    put(kind === 'hq' ? FLAG_HQ : FLAG, '1');
    return tr;
  })();
  loading[kind] = { p, cbs };
  p.catch(() => { delete loading[kind]; });
  return p;
}

const hqFailed = (e) => { put(FAIL_HQ, String(Date.now())); pipes.hq = null; delete loading.hq; void e; };

// Zwraca { tr, kind }: dokładny model, gdy jest gotowy; w przeciwnym razie mały (a dokładny dociąga się w tle).
export async function getPipe(onProgress) {
  if (await wantHq()) {
    if (pipes.hq) return { tr: pipes.hq, kind: 'hq' };
    // gdy mały model jest już na telefonie, używamy go teraz, a dokładny dociągnie się dopiero po rozpoznaniu
    if (get(FLAG) === '1' || pipes.base) return { tr: await load('base', onProgress), kind: 'base' };
    try { return { tr: await load('hq', onProgress), kind: 'hq' }; } catch (e) { hqFailed(e); }
  }
  return { tr: await load('base', onProgress), kind: 'base' };
}

export const loadModel = async (onProgress) => (await getPipe(onProgress)).tr;
// Rozgrzanie w tle po otwarciu okna dodawania (jeśli modele są już pobrane)
export async function warm() {
  if (!modelReady()) return;
  try { if (config.hq && get(FLAG_HQ) === '1' && (await wantHq())) await load('hq').catch(hqFailed); else if (get(FLAG) === '1') await load('base'); } catch { /* */ }
}

// Nagrywanie z automatycznym zakończeniem po ciszy. Próbki PCM pobieramy wprost z mikrofonu (bez kodeków),
// co działa tak samo na iPhonie i w przeglądarce. Zwraca { stop, done: Promise<{ pcm: Float32Array (16 kHz), heard }> }
export async function record({ onLevel, maxMs = 30000, silenceMs = 1100 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try { await ctx.resume(); } catch { /* */ }
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  src.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);
  const chunks = [];
  const t0 = Date.now();
  let heard = false;
  let lastVoice = Date.now();
  let stopped = false;
  let resolveDone;
  const finish = new Promise((r) => { resolveDone = r; });
  const stop = () => { if (!stopped) { stopped = true; resolveDone(); } };
  proc.onaudioprocess = (e) => {
    if (stopped) return;
    const d = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(d));
    let peak = 0;
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
    if (onLevel) onLevel(peak);
    const now = Date.now();
    if (peak > 0.03) { heard = true; lastVoice = now; }
    if ((heard && now - lastVoice > silenceMs) || now - t0 > maxMs || (!heard && now - t0 > 7000)) stop();
  };
  const done = (async () => {
    await finish;
    const rate = ctx.sampleRate;
    try { proc.disconnect(); src.disconnect(); mute.disconnect(); } catch { /* */ }
    stream.getTracks().forEach((t) => t.stop());
    try { ctx.close(); } catch { /* */ }
    let n = 0;
    for (const c of chunks) n += c.length;
    const all = new Float32Array(n);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    // zmniejszenie do 16 kHz (uśrednianie okien — prosty filtr dolnoprzepustowy)
    const ratio = rate / 16000;
    const outLen = Math.floor(all.length / ratio);
    const pcm = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const a = Math.floor(i * ratio);
      const b = Math.min(all.length, Math.max(a + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = a; j < b; j++) sum += all[j];
      pcm[i] = sum / (b - a);
    }
    return { pcm, heard };
  })();
  return { stop, done };
}

export async function transcribe(pcm) {
  const run = async (tr) => {
    try { return await tr(pcm, { language: 'polish', task: 'transcribe', chunk_length_s: 30 }); } catch (e) { throw new Error('rozpoznawanie: ' + (e && e.message ? e.message : String(e))); }
  };
  let { tr, kind } = await getPipe();
  let out;
  try { out = await run(tr); } catch (e) {
    if (kind !== 'hq') throw e;
    hqFailed(e);
    tr = await load('base');
    out = await run(tr);
  }
  if (kind === 'hq') { try { localStorage.removeItem(TRY_HQ); } catch { /* */ } }
  else setTimeout(async () => { if (await wantHq() && !pipes.hq && !loading.hq) load('hq').catch(hqFailed); }, 4000);
  return (out.text || '').replace(/\s+/g, ' ').trim();
}
