// Głos bez klawiatury: nagrywamy mikrofonem telefonu, a rozpoznawanie mowy (Whisper) działa w samej aplikacji.
// Model (~80 MB) pobiera się raz, potem jest w pamięci telefonu i działa także offline.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.web.min.js';
const MODEL = 'onnx-community/whisper-base';
const FLAG = 'kalendarz.voiceModel';

let pipe = null;
let loading = null;

export const modelReady = () => { try { return localStorage.getItem(FLAG) === '1'; } catch { return false; } };
export const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

export function loadModel(onProgress) {
  if (pipe) return Promise.resolve(pipe);
  if (loading) { loading.cbs.push(onProgress); return loading.p; }
  const cbs = [onProgress];
  const files = {};
  const p = (async () => {
    const T = await import(/* webpackIgnore: true */ LIB);
    T.env.allowLocalModels = false;
    const tr = await T.pipeline('automatic-speech-recognition', MODEL, {
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
    });
    pipe = tr;
    try { localStorage.setItem(FLAG, '1'); } catch { /* */ }
    return tr;
  })();
  loading = { p, cbs };
  p.catch(() => { loading = null; });
  return p;
}

// Nagrywanie z automatycznym zakończeniem po ciszy. Zwraca { stop, done: Promise<Float32Array 16 kHz> }
export async function record({ onLevel, maxMs = 30000, silenceMs = 1600 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  const mr = new MediaRecorder(stream);
  const chunks = [];
  mr.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
  const t0 = Date.now();
  let heard = false;
  let lastVoice = Date.now();
  let timer = null;
  let stopped = false;
  const finish = new Promise((res) => { mr.onstop = res; });
  const stop = () => { if (stopped) return; stopped = true; clearInterval(timer); try { mr.stop(); } catch { /* */ } };
  timer = setInterval(() => {
    an.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
    const lvl = peak / 128;
    if (onLevel) onLevel(lvl);
    const now = Date.now();
    if (lvl > 0.06) { heard = true; lastVoice = now; }
    if ((heard && now - lastVoice > silenceMs) || now - t0 > maxMs || (!heard && now - t0 > 7000)) stop();
  }, 80);
  mr.start();
  const done = (async () => {
    await finish;
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: mr.mimeType || 'audio/mp4' });
    const arr = await blob.arrayBuffer();
    let audio;
    try { audio = await new Promise((ok, no) => ctx.decodeAudioData(arr, ok, no)); } finally { try { ctx.close(); } catch { /* */ } }
    const len = Math.max(1, Math.ceil(audio.duration * 16000));
    const off = new OfflineAudioContext(1, len, 16000);
    const s = off.createBufferSource();
    s.buffer = audio;
    s.connect(off.destination);
    s.start();
    const rendered = await off.startRendering();
    return { pcm: rendered.getChannelData(0), heard };
  })();
  return { stop, done };
}

export async function transcribe(pcm) {
  const tr = await loadModel();
  const out = await tr(pcm, { language: 'polish', task: 'transcribe', chunk_length_s: 30 });
  return (out.text || '').replace(/\s+/g, ' ').trim();
}
