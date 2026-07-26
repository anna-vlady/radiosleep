/* ==========================================================================
   RADIOSLEEP — Idle Ambient Soundscape Engine (Lush Synth Pad + Ableton MP3)
   ========================================================================== */

import { getAudioContext, getAmbientBus } from './audio-context.js';

let isPlaying = false;
let currentSourceType = 'synth'; // 'synth' or 'ableton'

// Synth Pad Nodes
let synthOscillators = [];
let synthLfo = null;
let synthFilter = null;
let synthMasterGain = null;

// Ableton MP3 Web Audio Buffer & Nodes
let abletonBuffer = null;
let abletonSourceNode = null;
let abletonGainNode = null;
let loadedAbletonFile = null;

/**
 * Initializes the Ambient Soundscape Engine
 */
export function initAmbientSoundscape() {
  const ctx = getAudioContext();
  const ambientBus = getAmbientBus();

  // Ambient Bus Gain set to 0.85 for clear volume
  ambientBus.gain.setValueAtTime(0.85, ctx.currentTime);

  // Synth Master Gain
  synthMasterGain = ctx.createGain();
  synthMasterGain.gain.setValueAtTime(0.8, ctx.currentTime);

  // Synth Lowpass Filter
  synthFilter = ctx.createBiquadFilter();
  synthFilter.type = 'lowpass';
  synthFilter.frequency.setValueAtTime(750, ctx.currentTime);
  synthFilter.Q.setValueAtTime(1.5, ctx.currentTime);

  // LFO for Shimmering Filter Modulation (Sweeps 450Hz - 1800Hz)
  synthLfo = ctx.createOscillator();
  const synthLfoGain = ctx.createGain();
  synthLfo.frequency.setValueAtTime(0.08, ctx.currentTime);
  synthLfoGain.gain.setValueAtTime(500, ctx.currentTime);

  synthLfo.connect(synthLfoGain);
  synthLfoGain.connect(synthFilter.frequency);

  synthFilter.connect(synthMasterGain);
  synthMasterGain.connect(ambientBus);

  try {
    synthLfo.start();
  } catch (e) {}

  // Ableton MP3 Loop Gain Node
  abletonGainNode = ctx.createGain();
  abletonGainNode.gain.setValueAtTime(0, ctx.currentTime);
  abletonGainNode.connect(ambientBus);
}

/**
 * Starts ambient soundscape playback
 */
export function startAmbientSoundscape() {
  if (isPlaying) return;
  const ctx = getAudioContext();

  if (currentSourceType === 'synth') {
    startSynthPad(ctx);
  } else if (currentSourceType === 'ableton' && abletonBuffer) {
    startAbletonBufferLoop(ctx);
  } else {
    startSynthPad(ctx);
  }

  isPlaying = true;
}

/**
 * Stops ambient soundscape playback
 */
export function stopAmbientSoundscape() {
  const ctx = getAudioContext();
  stopSynthPad(ctx);
  stopAbletonBufferLoop(ctx);
  isPlaying = false;
}

/**
 * Switches ambient source between 'synth' and 'ableton'
 */
export function setAmbientSource(sourceType) {
  currentSourceType = sourceType;
  const ctx = getAudioContext();

  if (sourceType === 'synth') {
    stopAbletonBufferLoop(ctx);
    startSynthPad(ctx);
  } else if (sourceType === 'ableton') {
    stopSynthPad(ctx);
    if (abletonBuffer) {
      startAbletonBufferLoop(ctx);
    }
  }
}

/**
 * Sets volume level for ambient soundscape (0.0 to 1.0)
 */
export function setAmbientVolume(vol) {
  const ctx = getAudioContext();
  const bus = getAmbientBus();
  if (bus && ctx) {
    bus.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.05);
  }
}

/**
 * Stores selected Ableton MP3 file reference
 */
export function setAbletonFileReference(file) {
  loadedAbletonFile = file;
}

/**
 * Explicitly decodes and loads Ableton MP3 file when user clicks Done/Apply
 */
export async function applyAbletonMp3File() {
  if (!loadedAbletonFile) return false;

  const ctx = getAudioContext();
  await ctx.resume();

  try {
    const arrayBuffer = await loadedAbletonFile.arrayBuffer();
    abletonBuffer = await ctx.decodeAudioData(arrayBuffer);

    setAmbientSource('ableton');
    isPlaying = true;
    return true;
  } catch (err) {
    console.error('Failed to decode uploaded Ableton MP3 file:', err);
    return false;
  }
}

/**
 * Starts lush, shimmering synth pad oscillators
 */
function startSynthPad(ctx) {
  stopSynthPad(ctx);

  // Ethereal chord frequencies (Fmaj9 / Csus2 dreamscape)
  const baseFreqs = [174.61, 261.63, 392.00, 587.33, 880.00];

  synthOscillators = baseFreqs.map(freq => {
    const osc = ctx.createOscillator();
    const detuneOsc = ctx.createOscillator();
    const oscGain = ctx.createGain();

    osc.type = 'sine';
    detuneOsc.type = 'triangle';

    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    detuneOsc.frequency.setValueAtTime(freq * 1.004, ctx.currentTime);

    oscGain.gain.setValueAtTime(0.22, ctx.currentTime);

    osc.connect(oscGain);
    detuneOsc.connect(oscGain);
    oscGain.connect(synthFilter);

    osc.start();
    detuneOsc.start();

    return { osc, detuneOsc, oscGain };
  });

  if (synthMasterGain) {
    synthMasterGain.gain.linearRampToValueAtTime(0.85, ctx.currentTime + 0.5);
  }
}

/**
 * Stops synth pad oscillators
 */
function stopSynthPad(ctx) {
  if (synthMasterGain && ctx) {
    synthMasterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
  }
  setTimeout(() => {
    synthOscillators.forEach(({ osc, detuneOsc }) => {
      try {
        osc.stop();
        detuneOsc.stop();
      } catch (e) {}
    });
    synthOscillators = [];
  }, 250);
}

/**
 * Starts looping decoded Ableton MP3 AudioBuffer
 */
function startAbletonBufferLoop(ctx) {
  stopAbletonBufferLoop(ctx);

  if (!abletonBuffer) return;

  abletonSourceNode = ctx.createBufferSource();
  abletonSourceNode.buffer = abletonBuffer;
  abletonSourceNode.loop = true;
  abletonSourceNode.connect(abletonGainNode);

  abletonGainNode.gain.setValueAtTime(0.01, ctx.currentTime);
  abletonGainNode.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 0.5);

  abletonSourceNode.start(ctx.currentTime);
}

/**
 * Stops looping Ableton MP3 AudioBuffer
 */
function stopAbletonBufferLoop(ctx) {
  if (abletonGainNode && ctx) {
    abletonGainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
  }
  setTimeout(() => {
    if (abletonSourceNode) {
      try {
        abletonSourceNode.stop();
        abletonSourceNode.disconnect();
      } catch (e) {}
      abletonSourceNode = null;
    }
  }, 250);
}
