/* ==========================================================================
   RADIOSLEEP — Recording Engine & Raw Audio Archiving with Color System
   ========================================================================== */

import { getAudioContext } from './audio-context.js';
import { uploadToSupabaseCloud } from './supabase-client.js';

const DB_NAME = 'RADIOSLEEP_ARCHIVE_DB';
const STORE_NAME = 'raw_recordings';

let mediaStream = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

let micAnalyser = null;
let micSourceNode = null;
let vuAnimationFrame = null;
let onVuUpdateCallback = null;

let dbPromise = null;

// Curated Palette for Persistent Recording Color-Coding
const RECORDING_COLORS = [
  '#FF3B5C', // Crimson Red
  '#00D2FF', // Neon Cyan
  '#FFB703', // Amber Gold
  '#9D4EDD', // Electric Purple
  '#00E699', // Emerald Green
  '#FF6B6B', // Coral Pink
  '#4D96FF', // Royal Blue
  '#6BCB77', // Mint Green
  '#F77F00', // Deep Orange
  '#E040FB'  // Neon Magenta
];

let globalColorIndex = 0;

/**
 * Initializes IndexedDB storage for undisturbed local archive
 */
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

/**
 * Normalizes AudioBuffer peak amplitude so whisper or quiet recordings are clear and audible
 */
export function normalizeBuffer(buffer) {
  const numChannels = buffer.numberOfChannels;
  let maxPeak = 0;

  for (let c = 0; c < numChannels; c++) {
    const channelData = buffer.getChannelData(c);
    for (let i = 0; i < channelData.length; i++) {
      const absVal = Math.abs(channelData[i]);
      if (absVal > maxPeak) maxPeak = absVal;
    }
  }

  if (maxPeak > 0.01 && maxPeak < 0.95) {
    const gainFactor = 0.90 / maxPeak;
    for (let c = 0; c < numChannels; c++) {
      const channelData = buffer.getChannelData(c);
      for (let i = 0; i < channelData.length; i++) {
        channelData[i] *= gainFactor;
      }
    }
  }
  return buffer;
}

/**
 * Saves a raw audio Blob and decoded AudioBuffer to IndexedDB local archive with persistent color
 */
export async function saveRecordingToArchive(blob, audioBuffer, namePrefix = 'dream') {
  const db = await openDB();
  const timestamp = new Date();

  // Count existing recordings to determine sequential number (dream01, dream02, ...)
  const existingCount = await new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(0);
  });

  const nextSeq = existingCount + 1;
  const seqStr = String(nextSeq).padStart(2, '0');
  const name = `dream${seqStr}`;
  const id = `rec_${Date.now()}`;

  // Assign persistent color
  const color = RECORDING_COLORS[globalColorIndex % RECORDING_COLORS.length];
  globalColorIndex++;

  // Peak normalization
  normalizeBuffer(audioBuffer);

  const channelData = [];
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    channelData.push(Array.from(audioBuffer.getChannelData(i)));
  }

  const dbItem = {
    id,
    name,
    color,
    timestamp: timestamp.toISOString(),
    duration: audioBuffer.duration,
    sampleRate: audioBuffer.sampleRate,
    numberOfChannels: audioBuffer.numberOfChannels,
    channelData,
    blob
  };

  const returnItem = {
    ...dbItem,
    audioBuffer
  };

  // 1. Automatically save raw WAV directly into c:\03-Personal\Notations\Radiosleep\dreams\
  try {
    const wavBlob = bufferToWavBlob(audioBuffer);
    fetch('/api/save-dream', {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/wav',
        'X-Filename': `${name}.wav`
      },
      body: wavBlob
    }).then(res => {
      if (res.ok) console.log(`📁 Saved to local project directory: dreams/${name}.wav`);
    }).catch(() => {
      // Fallback to browser download if server endpoint is not running
      downloadRecordingAsWav(audioBuffer, `${name}.wav`);
    });
  } catch (e) {
    downloadRecordingAsWav(audioBuffer, `${name}.wav`);
  }

  // 2. Asynchronously sync to Supabase Cloud Archive (dream01.wav, dream02.wav...)
  uploadToSupabaseCloud(returnItem);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(dbItem);
    tx.oncomplete = () => resolve(returnItem);
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Encodes an AudioBuffer into a WAV Blob
 */
export function bufferToWavBlob(audioBuffer) {
  if (!audioBuffer) return new Blob();
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bitDepth = 16;

  let samples;
  if (numChannels === 2) {
    const inputL = audioBuffer.getChannelData(0);
    const inputR = audioBuffer.getChannelData(1);
    const length = inputL.length + inputR.length;
    samples = new Float32Array(length);
    let index = 0, inputIndex = 0;
    while (index < length) {
      samples[index++] = inputL[inputIndex];
      samples[index++] = inputR[inputIndex];
      inputIndex++;
    }
  } else {
    samples = audioBuffer.getChannelData(0);
  }

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (v, offset, str) => {
    for (let i = 0; i < str.length; i++) v.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Encodes an AudioBuffer into a downloadable WAV Blob and triggers browser download
 */
export function downloadRecordingAsWav(audioBuffer, filename = 'sample.wav') {
  if (!audioBuffer) return;
  const wavBlob = bufferToWavBlob(audioBuffer);
  const downloadUrl = URL.createObjectURL(wavBlob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename.endsWith('.wav') ? filename : `${filename}.wav`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

/**
 * Retrieves all stored raw recordings from IndexedDB
 */
export async function getAllArchivedRecordings() {
  const db = await openDB();
  const ctx = getAudioContext();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const items = req.result.map(item => {
        const buffer = ctx.createBuffer(item.numberOfChannels, item.channelData[0].length, item.sampleRate);
        for (let i = 0; i < item.numberOfChannels; i++) {
          buffer.copyToChannel(new Float32Array(item.channelData[i]), i);
        }
        return {
          id: item.id,
          name: item.name,
          color: item.color || '#00D2FF',
          timestamp: item.timestamp,
          duration: item.duration,
          audioBuffer: buffer,
          blob: item.blob
        };
      });
      resolve(items);
    };

    req.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Clears ALL stored recordings from IndexedDB to start fresh
 */
export async function clearAllArchivedRecordings() {
  const db = await openDB();
  globalColorIndex = 0;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Initializes Microphone Stream & VU Meter Analyzer
 */
export async function initMicrophone(onVuUpdate) {
  onVuUpdateCallback = onVuUpdate;
  const ctx = getAudioContext();

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micSourceNode = ctx.createMediaStreamSource(mediaStream);
    micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 256;
    micSourceNode.connect(micAnalyser);

    startVuMeterLoop();
    return true;
  } catch (err) {
    console.warn('Microphone access not granted or unavailable:', err);
    return false;
  }
}

/**
 * Runs VU meter calculation loop
 */
function startVuMeterLoop() {
  if (!micAnalyser) return;
  const dataArray = new Uint8Array(micAnalyser.frequencyBinCount);

  const checkVu = () => {
    micAnalyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const avg = sum / dataArray.length;
    const normalizedLevel = Math.min(1.0, avg / 128);

    if (onVuUpdateCallback) {
      onVuUpdateCallback(normalizedLevel);
    }
    vuAnimationFrame = requestAnimationFrame(checkVu);
  };

  checkVu();
}

let recordingStartTimeMs = 0;
let recordingMaxTimeoutId = null;

/**
 * Starts recording vocal sample (with 15s max limit auto-stop)
 */
export function startRecording(onAutoStop) {
  if (isRecording || !mediaStream) return false;
  audioChunks = [];
  isRecording = true;
  recordingStartTimeMs = Date.now();

  if (recordingMaxTimeoutId) clearTimeout(recordingMaxTimeoutId);

  // 15-second maximum recording limit (auto-stop and save)
  recordingMaxTimeoutId = setTimeout(async () => {
    if (isRecording) {
      console.log('⏰ 15-second maximum recording limit reached. Auto-stopping & saving...');
      if (onAutoStop) onAutoStop();
    }
  }, 15000);

  try {
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.start(10);
    return true;
  } catch (e) {
    console.error('Failed to start MediaRecorder:', e);
    isRecording = false;
    if (recordingMaxTimeoutId) clearTimeout(recordingMaxTimeoutId);
    return false;
  }
}

/**
 * Stops recording and enforces duration bounds (Discard <3s, Auto-Clamp >15s)
 */
export function stopRecording() {
  return new Promise((resolve, reject) => {
    if (recordingMaxTimeoutId) {
      clearTimeout(recordingMaxTimeoutId);
      recordingMaxTimeoutId = null;
    }

    if (!isRecording || !mediaRecorder) {
      resolve(null);
      return;
    }

    isRecording = false;

    mediaRecorder.onstop = async () => {
      const elapsedSec = (Date.now() - recordingStartTimeMs) / 1000.0;
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const ctx = getAudioContext();
      const arrayBuffer = await blob.arrayBuffer();

      try {
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const rawDuration = audioBuffer.duration;

        // --- RULE 1: DISCARD IF LESS THAN 1.5 SECONDS (< 1.5s) ---
        if (rawDuration < 1.5 || elapsedSec < 1.3) {
          console.warn(`⚠️ Recording too short (${rawDuration.toFixed(2)}s). Minimum 1.5 seconds required. Discarding sample!`);
          resolve({ recordItem: null, audioBuffer: null, discarded: true, reason: 'too_short', duration: rawDuration });
          return;
        }

        // --- RULE 2: CLAMP/TRIM TO 15 SECONDS MAXIMUM IF OVER 15s (> 15.0s) ---
        let finalBuffer = audioBuffer;
        if (rawDuration > 15.0) {
          const sampleRate = audioBuffer.sampleRate;
          const maxFrames = Math.floor(15.0 * sampleRate);
          const clampedBuffer = ctx.createBuffer(audioBuffer.numberOfChannels, maxFrames, sampleRate);
          for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
            clampedBuffer.copyToChannel(audioBuffer.getChannelData(c).subarray(0, maxFrames), c);
          }
          finalBuffer = clampedBuffer;
        }

        const recordItem = await saveRecordingToArchive(blob, finalBuffer, 'voice_recording');
        resolve({ recordItem, audioBuffer: finalBuffer, discarded: false, duration: finalBuffer.duration });
      } catch (err) {
        console.error('Audio decode error:', err);
        reject(err);
      }
    };

    mediaRecorder.stop();
  });
}

/**
 * Generates synthetic preset audio samples for testing
 */
export function generatePresetTestBuffer(type = 'whisper') {
  const ctx = getAudioContext();
  const sampleRate = ctx.sampleRate;
  const duration = 4.0;
  const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    if (type === 'whisper') {
      const noise = (Math.random() * 2 - 1) * Math.sin(t * Math.PI * 1.5);
      data[i] = noise * 0.45;
    } else if (type === 'humming') {
      const f1 = Math.sin(2 * Math.PI * 174.61 * t);
      const f2 = Math.sin(2 * Math.PI * 261.63 * t + 0.5) * 0.6;
      const f3 = Math.sin(2 * Math.PI * 392.00 * t + 1.0) * 0.3;
      const env = Math.sin(t * Math.PI / duration);
      data[i] = (f1 + f2 + f3) * 0.4 * env;
    } else {
      const pitch = 140 + Math.sin(t * 8) * 20;
      const carrier = Math.sin(2 * Math.PI * pitch * t);
      const formant = Math.sin(2 * Math.PI * (800 + Math.sin(t * 12) * 400) * t);
      const env = (Math.sin(t * Math.PI * 4) > 0 ? 1 : 0.1) * Math.sin(t * Math.PI / duration);
      data[i] = carrier * formant * env * 0.45;
    }
  }

  return normalizeBuffer(buffer);
}
