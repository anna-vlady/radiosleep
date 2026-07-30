/* ==========================================================================
   RADIOSLEEP — Dynamic Infinite Chopping & Mangled Audio DSP Pipeline Engine
   ========================================================================== */

import { getAudioContext, getActiveTrackBus, getBgTrackBus } from './audio-context.js';

// Global Intelligibility Factor (1.0 = 100% Clear Words, 0.0 = Ethereal Ambient Cloud)
let globalIntelligibility = 0.7;

// Active Track Scrub Playhead Position (0.0 to 1.0)
let activeScrubOffsetRatio = 0.5;

export function setIntelligibility(val) {
  globalIntelligibility = Math.max(0, Math.min(1, val));
}

export function getIntelligibility() {
  return globalIntelligibility;
}

export function setScrubOffsetRatio(ratio) {
  activeScrubOffsetRatio = Math.max(0, Math.min(1.0, ratio));
}

export function getScrubOffsetRatio() {
  return activeScrubOffsetRatio;
}


/**
 * Universal Generative Stream Function
 * Dynamically extracts UNIQUE random slice positions & varied lengths (0.5s to 3.5s)
 * on-the-fly for every trigger iteration—guaranteeing zero repetitiveness!
 *
 * @param {AudioBuffer} sampleBuffer - Raw undisturbed recording buffer
 * @param {String} role - 'active' or 'background'
 * @param {Number} trackIndex - 0 for Active, 1-4 for BG Layers
 * @param {String} color - Persistent Hex Color for this sample
 * @param {Function} onSlicePlayCallback - Callback for visualizer & DAW timeline logger
 */
export function processAudioSampleToGenerativeStream(sampleBuffer, role = 'background', trackIndex = 0, color = '#00D2FF', onSlicePlayCallback) {
  if (!sampleBuffer || sampleBuffer.duration < 0.2) return null;

  const ctx = getAudioContext();
  const targetBus = role === 'active' ? getActiveTrackBus() : getBgTrackBus();

  let isStopped = false;
  let activeNodes = [];
  let sliceCounter = 0;

  /**
   * Dynamic Scheduler: Extracts a UNIQUE random chop position & length on EVERY turn!
   */
  function scheduleNextSlice() {
    if (isStopped || !ctx) return;

    // 1. Extract a BRAND NEW unique random slice position & duration on-the-fly!
    const slice = extractDynamicRandomSlice(ctx, sampleBuffer, 0.5, 3.5, role);
    if (!slice) return;

    sliceCounter++;
    
    // 2. Select Mangled FX Transformation weighted by Intelligibility
    const fxType = selectMangledFX(globalIntelligibility);

    // 3. Synthesize Mangled FX / Granular Texture
    const { duration, nodes } = playMangledSliceWithFX(
      ctx,
      slice,
      fxType,
      targetBus,
      role,
      globalIntelligibility
    );

    activeNodes.push(...nodes);

    if (onSlicePlayCallback) {
      onSlicePlayCallback({
        role,
        trackIndex,
        color,
        fxType,
        duration,
        sliceIndex: sliceCounter,
        totalSlices: 999, // Infinite unique chops
        startTime: ctx.currentTime
      });
    }

    // 4. Dense triggering schedule for packed, non-sparse ear-candy soundscapes
    // Active Track: Micro silence gap (10ms - 50ms) for continuous dense voice stream
    // Background Tracks: 0.1s - 0.7s for rich overlapping layers
    let silenceGap = 0;
    if (role === 'active') {
      silenceGap = Math.random() < 0.90 ? (0.01 + Math.random() * 0.04) : (0.10 + Math.random() * 0.10);
    } else {
      silenceGap = 0.1 + Math.random() * 0.6;
    }

    const totalDelayMs = (duration + silenceGap) * 1000;

    const timerId = setTimeout(() => {
      scheduleNextSlice();
    }, totalDelayMs);

    activeNodes.push({ stop: () => clearTimeout(timerId) });
  }

  scheduleNextSlice();

  return {
    role,
    trackIndex,
    color,
    stop: () => {
      isStopped = true;
      activeNodes.forEach(n => {
        try {
          if (n.stop) n.stop();
          if (n.disconnect) n.disconnect();
        } catch (e) {}
      });
      activeNodes = [];
    }
  };
}

/**
 * Dynamically extracts a UNIQUE random slice position & length from raw AudioBuffer on-the-fly!
 */
function extractDynamicRandomSlice(ctx, buffer, minSec = 0.5, maxSec = 3.5, role = 'background') {
  const totalDuration = buffer.duration;
  const sampleRate = buffer.sampleRate;

  // 1. Pick a random slice duration between minSec (0.5s) and maxSec (3.5s)
  const sliceLenSec = Math.min(minSec + Math.random() * (maxSec - minSec), totalDuration);

  // 2. Pick start position: centered around scrub head for active track, random for background
  let startOffsetSec = 0;
  if (role === 'active') {
    const scrubCenterSec = activeScrubOffsetRatio * totalDuration;
    const jitter = (Math.random() - 0.5) * 0.4;
    startOffsetSec = Math.max(0, Math.min(totalDuration - sliceLenSec, scrubCenterSec + jitter));
  } else {
    const maxStartOffset = Math.max(0, totalDuration - sliceLenSec);
    startOffsetSec = Math.random() * maxStartOffset;
  }

  const startSample = Math.floor(startOffsetSec * sampleRate);
  const frameCount = Math.floor(sliceLenSec * sampleRate);

  if (frameCount <= 0) return null;

  const sliceBuffer = ctx.createBuffer(buffer.numberOfChannels, frameCount, sampleRate);

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const srcData = buffer.getChannelData(c);
    const destData = sliceBuffer.getChannelData(c);
    for (let i = 0; i < frameCount; i++) {
      destData[i] = srcData[startSample + i] || 0;
    }
  }

  return sliceBuffer;
}

/**
 * Selects Mangled FX Transformation based on Intelligibility setting
 * Presets: NORMAL, STUTTER, WARP, LONG_STRETCH, REVERSE, PITCH_DRIFT
 */
function selectMangledFX(intelligibility) {
  if (intelligibility > 0.85 && Math.random() < intelligibility) {
    return 'NORMAL';
  }

  const fxList = ['STUTTER', 'WARP', 'LONG_STRETCH', 'REVERSE', 'PITCH_DRIFT', 'NORMAL'];
  const abstractWeight = 1 - intelligibility;

  const weights = [
    0.25 * abstractWeight + 0.15, // STUTTER (rhythmic micro-repeats)
    0.20 * abstractWeight + 0.10, // WARP (pitch warping & semitone bends)
    0.20 * abstractWeight + 0.10, // LONG_STRETCH (slow-mo grain expansion)
    0.15 * abstractWeight + 0.10, // REVERSE (backward vocal swells)
    0.15 * abstractWeight + 0.05, // PITCH_DRIFT (octave & fifth jumps)
    intelligibility * 0.5         // NORMAL
  ];

  const rand = Math.random();
  let cumulative = 0;
  for (let i = 0; i < fxList.length; i++) {
    cumulative += weights[i];
    if (rand <= cumulative) return fxList[i];
  }
  return 'STUTTER';
}

/**
 * Plays a dynamically extracted slice using Mangled FX & Dense Granular Synthesis
 */
function playMangledSliceWithFX(ctx, sliceBuffer, fxType, outputBus, role, intelligibility) {
  const nodes = [];
  let duration = sliceBuffer.duration;
  const abstractness = 1 - intelligibility;

  // Master Filter per Slice (60Hz highpass clean voice foundation + dynamic lowpass morph)
  const hpFilter = ctx.createBiquadFilter();
  hpFilter.type = 'highpass';
  hpFilter.frequency.setValueAtTime(60, ctx.currentTime);

  const lpFilter = ctx.createBiquadFilter();
  lpFilter.type = 'lowpass';
  lpFilter.frequency.setValueAtTime(5500 + (intelligibility * 10000), ctx.currentTime);

  hpFilter.connect(lpFilter);
  lpFilter.connect(outputBus);

  nodes.push(hpFilter, lpFilter);

  // --- 1. REVERSE FX (Backward vocal swells & ear candy) ---
  if (fxType === 'REVERSE') {
    const reversedBuffer = createReversedBuffer(ctx, sliceBuffer);
    const src = ctx.createBufferSource();
    src.buffer = reversedBuffer;

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.random() * 1.6 - 0.8, ctx.currentTime);

    src.connect(panner);
    panner.connect(hpFilter);
    src.start(ctx.currentTime);

    nodes.push(src, panner);
    return { duration, nodes };
  }

  // --- 2. STUTTER FX (Rhythmic micro-burst repeats) ---
  if (fxType === 'STUTTER') {
    const stutterChunkSec = 0.03 + Math.random() * 0.06; // 30ms - 90ms micro-burst
    const repeatCount = 4 + Math.floor(Math.random() * (8 * abstractness + 2)); // 4 to 12 repeats
    duration = stutterChunkSec * repeatCount;

    for (let r = 0; r < repeatCount; r++) {
      const src = ctx.createBufferSource();
      src.buffer = sliceBuffer;

      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.7, ctx.currentTime + (r * stutterChunkSec));

      src.connect(panner);
      panner.connect(hpFilter);

      const startTime = ctx.currentTime + (r * stutterChunkSec);
      src.start(startTime, 0, stutterChunkSec);
      nodes.push(src, panner);
    }
    return { duration, nodes };
  }

  // --- 3. WARP FX (Dynamic Pitch Warping & Glides) ---
  if (fxType === 'WARP') {
    const maxSemitones = 2 + (10 * abstractness);
    const semitones = (Math.random() * (maxSemitones * 2)) - maxSemitones;
    const playbackRate = Math.pow(2, semitones / 12);
    duration = sliceBuffer.duration / playbackRate;

    const src = ctx.createBufferSource();
    src.buffer = sliceBuffer;

    src.playbackRate.setValueAtTime(playbackRate, ctx.currentTime);
    src.playbackRate.exponentialRampToValueAtTime(Math.max(0.2, playbackRate * (0.8 + Math.random() * 0.4)), ctx.currentTime + duration);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.8, ctx.currentTime);

    src.connect(panner);
    panner.connect(hpFilter);
    src.start(ctx.currentTime);

    nodes.push(src, panner);
    return { duration, nodes };
  }

  // --- 4. PITCH_DRIFT FX (Octave & Fifth Jumps) ---
  if (fxType === 'PITCH_DRIFT') {
    const intervals = [12, -12, 7, -5, 0];
    const semitones = intervals[Math.floor(Math.random() * intervals.length)] * abstractness;
    const playbackRate = Math.pow(2, semitones / 12);
    duration = sliceBuffer.duration / playbackRate;

    const src = ctx.createBufferSource();
    src.buffer = sliceBuffer;
    src.playbackRate.setValueAtTime(playbackRate, ctx.currentTime);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.85, ctx.currentTime);

    src.connect(panner);
    panner.connect(hpFilter);
    src.start(ctx.currentTime);

    nodes.push(src, panner);
    return { duration, nodes };
  }

  // --- 5. LONG_STRETCH & DENSE GRANULAR SYNTHESIS ---
  let grainDuration = fxType === 'LONG_STRETCH' ? 0.14 : 0.08;
  let grainOverlap = fxType === 'LONG_STRETCH' ? 6.0 : 4.0;
  let stretchFactor = fxType === 'LONG_STRETCH' ? (1.5 + (2.5 * abstractness)) : 1.0;
  
  duration = sliceBuffer.duration * stretchFactor;
  const hopSize = grainDuration / grainOverlap;
  const numGrains = Math.floor(duration / hopSize);
  const hanningCurve = createHanningCurve(128);

  for (let g = 0; g < Math.min(numGrains, 45); g++) {
    const grainTime = ctx.currentTime + (g * hopSize);
    const bufferOffset = ((g * hopSize) / stretchFactor) % Math.max(0.1, sliceBuffer.duration - grainDuration);

    const grainSrc = ctx.createBufferSource();
    grainSrc.buffer = sliceBuffer;

    const detuneCents = (Math.random() * 2 - 1) * (12 * abstractness);
    const rate = Math.pow(2, detuneCents / 1200);
    grainSrc.playbackRate.setValueAtTime(rate, grainTime);

    const grainGain = ctx.createGain();
    grainGain.gain.setValueCurveAtTime(hanningCurve.map(v => v * 0.75), grainTime, grainDuration);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.8, grainTime);

    grainSrc.connect(grainGain);
    grainGain.connect(panner);
    panner.connect(hpFilter);

    grainSrc.start(grainTime, bufferOffset, grainDuration);
    nodes.push(grainSrc, grainGain, panner);
  }

  return { duration, nodes };
}

/**
 * Creates a reversed copy of an AudioBuffer for backward vocal textures
 */
function createReversedBuffer(ctx, buffer) {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;
  const reversed = ctx.createBuffer(numChannels, length, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const srcData = buffer.getChannelData(c);
    const destData = reversed.getChannelData(c);
    for (let i = 0; i < length; i++) {
      destData[i] = srcData[length - 1 - i];
    }
  }

  return reversed;
}

function createHanningCurve(length = 128) {
  const curve = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    curve[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
  }
  return curve;
}
