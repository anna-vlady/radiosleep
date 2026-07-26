/* ==========================================================================
   RADIOSLEEP — Recording Engine & Raw Audio Archiving with Color System
   ========================================================================== */

import { getAudioContext } from './audio-context.js';

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
export async function saveRecordingToArchive(blob, audioBuffer, namePrefix = 'sample') {
  const db = await openDB();
  const timestamp = new Date();
  const formattedDate = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const id = `rec_${Date.now()}`;
  const name = `${namePrefix}_${formattedDate}`;

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

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(dbItem);
    tx.oncomplete = () => resolve(returnItem);
    tx.onerror = (e) => reject(e.target.error);
  });
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

/**
 * Starts recording vocal sample
 */
export function startRecording() {
  if (isRecording || !mediaStream) return false;
  audioChunks = [];
  isRecording = true;

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
    return false;
  }
}

/**
 * Stops recording and returns decoded AudioBuffer & saved Archive record
 */
export function stopRecording() {
  return new Promise((resolve, reject) => {
    if (!isRecording || !mediaRecorder) {
      resolve(null);
      return;
    }

    isRecording = false;

    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const ctx = getAudioContext();
      const arrayBuffer = await blob.arrayBuffer();

      try {
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const recordItem = await saveRecordingToArchive(blob, audioBuffer, 'voice_recording');
        resolve({ recordItem, audioBuffer });
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
