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
  notifyMatrixUpdate();
}

/**
 * Pushes a new recording onto the stack following strict sequential logic:
 * 1st recording: Active = R1, BG1..4 = EMPTY
 * 2nd recording: Active = R2, BG1 = R1, BG2..4 = EMPTY
 * 3rd recording: Active = R3, BG1 = R2, BG2 = R1, BG3..4 = EMPTY
 * 4th recording: Active = R4, BG1 = R3, BG2 = R2, BG3 = R1, BG4 = EMPTY
 * 5th recording: Active = R5, BG1 = R4, BG2 = R3, BG3 = R2, BG4 = R1
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

  // Apply stack allocations:
  // Active = sampleStack[0]
  // BG 1  = sampleStack[1] (if exists)
  // BG 2  = sampleStack[2] (if exists)
  // BG 3  = sampleStack[3] (if exists)
  // BG 4  = sampleStack[4] (if exists)

  // 1. Update Active Track
  if (activeStream) {
    activeStream.stop();
  }

  activeItem = sampleStack[0];
  activeStream = processAudioSampleToGenerativeStream(
    activeItem.audioBuffer,
    'active',
    0,
    activeItem.color,
    (info) => handleSlicePlayEvent('active', 0, info)
  );

  // 2. Update 4 Non-Active Background Slots
  for (let i = 0; i < 4; i++) {
    const bgItemForSlot = sampleStack[i + 1] || null;

    // Stop current stream in slot i
    if (bgStreams[i]) {
      bgStreams[i].stop();
      bgStreams[i] = null;
    }

    bgItems[i] = bgItemForSlot;

    if (bgItemForSlot) {
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
 * Triggers 2-minute rotation for background slots if library has extra recordings (> 5 total)
 */
export function rotateBackgroundTracks() {
  if (sampleStack.length <= 5) {
    // If 5 or fewer samples exist, stack allocation remains fixed as requested
    return;
  }

  // Available pool of background samples = sampleStack[1..end]
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
  if (onMatrixUpdateCallback) {
    onMatrixUpdateCallback({
      role,
      slotIndex,
      activeItem,
      bgItems,
      color: info.color,
      fxType: info.fxType,
      duration: info.duration,
      startTime: info.startTime
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
