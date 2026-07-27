/* ==========================================================================
   RADIOSLEEP — Multi-Track Layer Mixer & Sequential Stack Allocation Engine
   ========================================================================== */

import { processAudioSampleToGenerativeStream } from './generative-engine.js';

let activeStream = null;
let activeItem = null; // { name, color, audioBuffer }

// 4 Non-Active Background Tracks
const bgStreams = [null, null, null, null];
const bgItems = [null, null, null, null]; // [{ name, color, audioBuffer }]

// Recorded Samples Stack (FIFO Queue)
const sampleStack = [];
let currentTunedIndex = 0;

// 2-Minute Rotation Clock (120 seconds)
const ROTATION_INTERVAL_SEC = 120;
let rotationSecondsLeft = ROTATION_INTERVAL_SEC;
let rotationTimerId = null;

let onMatrixUpdateCallback = null;
let onTimerUpdateCallback = null;

/**
 * Initializes the Multi-Track Mixer Engine
 */
export function initMultiTrackMixer(onMatrixUpdate, onTimerUpdate) {
  onMatrixUpdateCallback = onMatrixUpdate;
  onTimerUpdateCallback = onTimerUpdate;

  startRotationClock();
}

export function getActiveItem() {
  return activeItem;
}

export function getBgItems() {
  return [...bgItems];
}

export function getTunedIndex() {
  return currentTunedIndex;
}

export function getTotalArchiveCount() {
  return sampleStack.length;
}

/**
 * Clears all active and background track streams
 */
export function clearAllTracks() {
  if (activeStream) {
    activeStream.stop();
    activeStream = null;
  }
  activeItem = null;

  for (let i = 0; i < 4; i++) {
    if (bgStreams[i]) {
      bgStreams[i].stop();
      bgStreams[i] = null;
    }
    bgItems[i] = null;
  }

  sampleStack.length = 0;
  currentTunedIndex = 0;
  notifyMatrixUpdate();
}

/**
 * Tunes Active Track (Track 1) and 4 Background Layers (Tracks 2-5) using Option 1 (Sliding Window)
 * When tuned to station K, Track 1 = Sample K, and Tracks 2-5 = Samples (K+1..K+4) mod N
 */
export function tuneToFrequencyIndex(index) {
  if (sampleStack.length === 0) return;

  const N = sampleStack.length;
  const newTunedIndex = ((index % N) + N) % N;
  const targetItem = sampleStack[newTunedIndex];

  if (!targetItem || !targetItem.audioBuffer) return;

  currentTunedIndex = newTunedIndex;

  // 1. Update Active Track (Track 1)
  if (activeStream) {
    activeStream.stop();
    activeStream = null;
  }

  activeItem = targetItem;
  activeStream = processAudioSampleToGenerativeStream(
    activeItem.audioBuffer,
    'active',
    0,
    activeItem.color,
    (info) => handleSlicePlayEvent('active', 0, info)
  );

  // 2. Update 4 Non-Active Background Slots (Tracks 2-5) using Option 1 Sliding Window
  for (let i = 0; i < 4; i++) {
    let bgItemForSlot = null;
    if (N > 1) {
      const bgIdx = (newTunedIndex + i + 1) % N;
      if (bgIdx !== newTunedIndex) {
        bgItemForSlot = sampleStack[bgIdx];
      }
    }

    if (bgStreams[i]) {
      bgStreams[i].stop();
      bgStreams[i] = null;
    }

    bgItems[i] = bgItemForSlot;

    if (bgItemForSlot && bgItemForSlot.audioBuffer) {
      bgStreams[i] = processAudioSampleToGenerativeStream(
        bgItemForSlot.audioBuffer,
        'background',
        i + 1,
        bgItemForSlot.color,
        (info) => handleSlicePlayEvent('background', i + 1, info)
      );
    }
  }

  notifyMatrixUpdate();
}

/**
 * Pushes a new recording onto the stack and tunes to channel 0 (newest recording)
 */
export function setActiveRecordingItem(item) {
  if (!item || !item.audioBuffer) return;

  // Remove duplicate item if already in stack
  const existingIdx = sampleStack.findIndex(s => s.name === item.name);
  if (existingIdx !== -1) {
    sampleStack.splice(existingIdx, 1);
  }

  // Add new item to front of stack
  sampleStack.unshift(item);

  // Force tune to newest recording (index 0)
  tuneToFrequencyIndex(0);
}

/**
 * Triggers 2-minute rotation for background slots if library has extra recordings (> 5 total)
 */
export function rotateBackgroundTracks() {
  if (sampleStack.length <= 5) {
    return;
  }

  const bgPool = sampleStack.slice(1);

  for (let i = 0; i < 4; i++) {
    const randomIdx = Math.floor(Math.random() * bgPool.length);
    const item = bgPool[randomIdx];

    if (bgStreams[i]) {
      bgStreams[i].stop();
    }

    bgItems[i] = item;
    bgStreams[i] = processAudioSampleToGenerativeStream(
      item.audioBuffer,
      'background',
      i + 1,
      item.color,
      (info) => handleSlicePlayEvent('background', i + 1, info)
    );
  }

  notifyMatrixUpdate();
}

/**
 * Starts 2-Minute (120 seconds) rotation countdown clock
 */
function startRotationClock() {
  if (rotationTimerId) clearInterval(rotationTimerId);

  rotationSecondsLeft = ROTATION_INTERVAL_SEC;

  rotationTimerId = setInterval(() => {
    rotationSecondsLeft--;

    if (onTimerUpdateCallback) {
      onTimerUpdateCallback(rotationSecondsLeft, ROTATION_INTERVAL_SEC);
    }

    if (rotationSecondsLeft <= 0) {
      rotateBackgroundTracks();
      rotationSecondsLeft = ROTATION_INTERVAL_SEC;
    }
  }, 1000);
}

/**
 * Handles visual slice play event for UI meters & Ableton DAW timeline
 */
function handleSlicePlayEvent(role, slotIndex, info) {
  const currentItem = role === 'active' ? activeItem : bgItems[slotIndex - 1];
  const itemColor = (info && info.color) ? info.color : (currentItem ? currentItem.color : '#00D2FF');

  if (onMatrixUpdateCallback) {
    onMatrixUpdateCallback({
      role,
      slotIndex,
      activeItem,
      bgItems,
      color: itemColor,
      fxType: info ? info.fxType : 'CLOUD',
      duration: info ? info.duration : 2.0,
      startTime: info ? info.startTime : 0
    });
  }
}

/**
 * Notifies UI of current track slot states
 */
function notifyMatrixUpdate() {
  if (onMatrixUpdateCallback) {
    onMatrixUpdateCallback({
      role: 'refresh',
      activeItem,
      bgItems
    });
  }
}
