/* ==========================================================================
   RADIOSLEEP — Universal Generative Chopper, Splicer & FX Pipeline Engine
   ========================================================================== */

import { getAudioContext, getActiveTrackBus, getBgTrackBus } from './audio-context.js';

// Global Intelligibility Factor (1.0 = 100% Clear Words, 0.0 = Abstract FX)
let globalIntelligibility = 0.7;

export function setIntelligibility(val) {
  globalIntelligibility = Math.max(0, Math.min(1, val));
}

export function getIntelligibility() {
  return globalIntelligibility;
}

/**
 * Universal Generative Stream Function
 * Applies identical chopping (1s - 3s), random clip chaining, silence gaps,
 * and random FX transformations (stutter, pitch warp, long stretch, space FX)
 * to any audio sample (both Active Track and 4 Background Layers).
 *
 * @param {AudioBuffer} sampleBuffer - Raw undisturbed recording buffer
 * @param {String} role - 'active' or 'background'
 * @param {Number} trackIndex - 0 for Active, 1-4 for BG Layers
 * @param {String} color - Persistent Hex Color for this sample
 * @param {Function} onSlicePlayCallback - Callback for visualizer & DAW timeline logger
 */
export function processAudioSampleToGenerativeStream(sampleBuffer, role = 'background', trackIndex = 0, color = '#00D2FF', onSlicePlayCallback) {
  if (!sampleBuffer) return null;

  const ctx = getAudioContext();
  const targetBus = role === 'active' ? getActiveTrackBus() : getBgTrackBus();

  let isStopped = false;
  let activeSources = [];

  // 1. Slice raw buffer into chunks strictly 1.0s to 3.0s in length
  const slices = createBufferSlices(sampleBuffer, 1.0, 3.0);
  if (slices.length === 0) return null;

  // 2. Shuffle slice order for random chaining playback
  let shuffledSlices = shuffleArray([...slices]);
  let currentSliceIndex = 0;

  /**
   * Schedules next clip in the generative chain
   */
  function scheduleNextSlice() {
    if (isStopped || !ctx) return;

    if (currentSliceIndex >= shuffledSlices.length) {
      shuffledSlices = shuffleArray([...slices]);
      currentSliceIndex = 0;
    }

    const slice = shuffledSlices[currentSliceIndex++];
    
    // 3. Pick random FX transformation weighted by Intelligibility
    const fxType = selectRandomFX(globalIntelligibility);

    // Play the slice with chosen FX
    const { duration, nodes } = playSliceWithFX(ctx, slice, fxType, targetBus, role, globalIntelligibility);
    activeSources.push(...nodes);

    if (onSlicePlayCallback) {
      onSlicePlayCallback({
        role,
        trackIndex,
        color,
        fxType,
        duration,
        sliceIndex: currentSliceIndex,
        totalSlices: slices.length,
        startTime: ctx.currentTime
      });
    }

    // 4. Calculate silence gap before next slice
    // Active Track: Minimal silence gap (0.02s - 0.1s mostly, 0.15s - 0.3s occasionally) for continuous voice flow
    // Background Tracks: 0.3s - 1.8s for ambient bleed
    let silenceGap = 0;
    if (role === 'active') {
      silenceGap = Math.random() < 0.85 ? (0.02 + Math.random() * 0.08) : (0.15 + Math.random() * 0.15);
    } else {
      silenceGap = 0.3 + Math.random() * 1.5;
    }

    const totalDelayMs = (duration + silenceGap) * 1000;

    const timerId = setTimeout(() => {
      scheduleNextSlice();
    }, totalDelayMs);

    activeSources.push({ stop: () => clearTimeout(timerId) });
  }

  scheduleNextSlice();

  return {
    role,
    trackIndex,
    color,
    stop: () => {
      isStopped = true;
      activeSources.forEach(s => {
        try {
          if (s.stop) s.stop();
          if (s.disconnect) s.disconnect();
        } catch (e) {}
      });
      activeSources = [];
    }
  };
}

/**
 * Choops an AudioBuffer into smaller slices between minSec (1.0s) and maxSec (3.0s)
 */
function createBufferSlices(buffer, minSec = 1.0, maxSec = 3.0) {
  const sampleRate = buffer.sampleRate;
  const totalDuration = buffer.duration;
  const slices = [];

  let currentTime = 0;
  while (currentTime < totalDuration) {
    const sliceLenSec = Math.min(minSec + Math.random() * (maxSec - minSec), totalDuration - currentTime);

    if (sliceLenSec < 0.5 && slices.length > 0) {
      break;
    }

    const startSample = Math.floor(currentTime * sampleRate);
    const frameCount = Math.floor(sliceLenSec * sampleRate);

    if (frameCount > 0) {
      const sliceBuffer = getAudioContext().createBuffer(buffer.numberOfChannels, frameCount, sampleRate);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const channelData = buffer.getChannelData(c);
        const sliceData = sliceBuffer.getChannelData(c);
        for (let i = 0; i < frameCount; i++) {
          sliceData[i] = channelData[startSample + i] || 0;
        }
      }
      slices.push(sliceBuffer);
    }

    currentTime += sliceLenSec;
  }

  return slices;
}

/**
 * Selects FX transformation based on Intelligibility setting
 */
function selectRandomFX(intelligibility) {
  if (intelligibility > 0.8 && Math.random() < intelligibility) {
    return 'NORMAL';
  }

  const fxList = ['NORMAL', 'STUTTER', 'WARP', 'LONG_STRETCH', 'SPACE_FILTER'];
  const abstractWeight = 1 - intelligibility;
  
  const weights = [
    intelligibility * 0.5 + 0.1,
    0.2 * abstractWeight + 0.05,
    0.35 * abstractWeight + 0.05,
    0.35 * abstractWeight + 0.05,
    0.1 * abstractWeight
  ];

  const rand = Math.random();
  let cumulative = 0;
  for (let i = 0; i < fxList.length; i++) {
    cumulative += weights[i];
    if (rand <= cumulative) return fxList[i];
  }
  return 'NORMAL';
}

/**
 * Plays a single slice with assigned FX pipeline
 */
function playSliceWithFX(ctx, sliceBuffer, fxType, outputBus, role, intelligibility) {
  const nodes = [];
  let duration = sliceBuffer.duration;

  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime((Math.random() * 2 - 1) * (0.6 * (1 - intelligibility)), ctx.currentTime);

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.setValueAtTime(60, ctx.currentTime);

  panner.connect(filter);
  filter.connect(outputBus);
  nodes.push(panner, filter);

  if (fxType === 'STUTTER') {
    const stutterChunkSec = 0.05 + Math.random() * 0.08;
    const repeatCount = 3 + Math.floor(Math.random() * (6 * (1 - intelligibility)));
    duration = stutterChunkSec * repeatCount;

    for (let r = 0; r < repeatCount; r++) {
      const src = ctx.createBufferSource();
      src.buffer = sliceBuffer;
      src.connect(panner);

      const startTime = ctx.currentTime + (r * stutterChunkSec);
      src.start(startTime, 0, stutterChunkSec);
      nodes.push(src);
    }

  } else if (fxType === 'WARP') {
    const maxSemitones = 1 + (11 * (1 - intelligibility));
    const semitones = (Math.random() * (maxSemitones * 2)) - maxSemitones;
    const playbackRate = Math.pow(2, semitones / 12);
    duration = sliceBuffer.duration / playbackRate;

    const src = ctx.createBufferSource();
    src.buffer = sliceBuffer;
    src.playbackRate.setValueAtTime(playbackRate, ctx.currentTime);

    src.connect(panner);
    src.start(ctx.currentTime);
    nodes.push(src);

  } else if (fxType === 'LONG_STRETCH') {
    const stretchFactor = 1.2 + (2.5 * (1 - intelligibility));
    const grainSize = 0.09;
    const hopSize = grainSize / stretchFactor;
    duration = sliceBuffer.duration * stretchFactor;

    const numGrains = Math.floor(sliceBuffer.duration / hopSize);
    for (let g = 0; g < Math.min(numGrains, 45); g++) {
      const src = ctx.createBufferSource();
      src.buffer = sliceBuffer;

      const grainGain = ctx.createGain();
      grainGain.gain.setValueAtTime(0, ctx.currentTime);

      const playTime = ctx.currentTime + (g * grainSize);
      const bufferOffset = g * hopSize;

      if (bufferOffset < sliceBuffer.duration) {
        src.connect(grainGain);
        grainGain.connect(panner);

        grainGain.gain.setValueAtTime(0.01, playTime);
        grainGain.gain.linearRampToValueAtTime(0.8, playTime + grainSize * 0.3);
        grainGain.gain.linearRampToValueAtTime(0.01, playTime + grainSize);

        src.start(playTime, bufferOffset, grainSize);
        nodes.push(src, grainGain);
      }
    }

  } else {
    const src = ctx.createBufferSource();
    src.buffer = sliceBuffer;
    src.connect(panner);
    src.start(ctx.currentTime);
    nodes.push(src);
  }

  return { duration, nodes };
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
