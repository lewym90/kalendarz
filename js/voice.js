// Głos bez klawiatury: nagrywamy mikrofonem telefonu, a rozpoznawanie mowy (Whisper) działa w samej aplikacji.
// Model (~80 MB) pobiera się raz, potem jest w pamięci telefonu i działa także offline.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.web.min.js';
const MODEL = 'onnx-community/whisper-base';
const FLAG = 'kalendarz.voiceModel';

let pipe = null;
let loading = null;

export const modelReady = () => { try { return localStorage.getItem(FLAG) === '1'; } catch { return false; } };
export const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));

export function loadModel(onProgress) {
  if (pipe) return Promise.resolve(pipe);
  if (loading) { loading.cbs.push(onProgress); return loading.p; }
  const cbs = [onProgress];
  const files = {};
  const p = (async () => {
    let T;
    try { T = await import(/* webpackIgnore: true */ LIB); } catch (e) { throw new Error('biblioteka: ' + (e && e.message ? e.message : e)); }
    T.env.allowLocalModels = false;
    try { T.env.backends.onnx.wasm.numThreads = 1; T.env.backends.onnx.wasm.proxy = false; } catch { /* */ }
    let tr;
    try { tr = await T.pipeline('automatic-speech-recognition', MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (e) => {
        if (e.status === 'progress' && e.total) {
          files[e.file] = [e.loaded, e.total];
          let l = 0; let t = 0;
          for (const k in files) { l += files[k][0]; t += files[k][1]; }
          for (const f of cbs) f && f(Math.min(99, Math.round((l / t) * 100)));
        }
      },
    }); } catch (e) { throw new Error('model: ' + (e && e.message ? e.message : String(e))); }
    pipe = tr;
    try { localStorage.setItem(FLAG, '1'); } catch { /* */ }
    return tr;
  })();
  loading = { p, cbs };
  p.catch(() => { loading = null; });
  return p;
}

// Nagrywanie z automatycznym zakończeniem po ciszy. Próbki PCM pobieramy wprost z mikrofonu (bez kodeków),
// co działa tak samo na iPhonie i w przeglądarce. Zwraca { stop, done: Promise<{ pcm: Float32Array (16 kHz), heard }> }
export async function record({ onLevel, maxMs = 30000, silenceMs = 1600 } = {}) {
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
  const tr = await loadModel();
  let out;
  try { out = await tr(pcm, { language: 'polish', task: 'transcribe', chunk_length_s: 30 }); } catch (e) { throw new Error('rozpoznawanie: ' + (e && e.message ? e.message : String(e))); }
  return (out.text || '').replace(/\s+/g, ' ').trim();
}
