/* ==========================================================================
   RADIOSLEEP — AudioContext Manager & Master Bus Architecture
   ========================================================================== */

let audioCtx = null;
let masterGain = null;
let masterLimiter = null;
let masterReverb = null;
let reverbDryWetGain = null;
let activeTrackBusGain = null;
let bgTrackBusGain = null;
let ambientBusGain = null;

export function initAudioContext() {
  if (audioCtx) return audioCtx;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContextClass();

  // Master Limiter / Compressor (Prevents clipping & distortion)
  masterLimiter = audioCtx.createDynamicsCompressor();
  masterLimiter.threshold.setValueAtTime(-1.0, audioCtx.currentTime);
  masterLimiter.knee.setValueAtTime(0, audioCtx.currentTime);
  masterLimiter.ratio.setValueAtTime(20, audioCtx.currentTime);
  masterLimiter.attack.setValueAtTime(0.003, audioCtx.currentTime);
  masterLimiter.release.setValueAtTime(0.1, audioCtx.currentTime);

  // Master Gain
  masterGain = audioCtx.createGain();
  masterGain.gain.setValueAtTime(0.9, audioCtx.currentTime);

  // Reverb Send Architecture
  masterReverb = audioCtx.createConvolver();
  reverbDryWetGain = audioCtx.createGain();
  reverbDryWetGain.gain.setValueAtTime(0.6, audioCtx.currentTime);

  // Generate Synthetic Impulsive Reverb Response (Spacey Hall)
  masterReverb.buffer = createImpulseResponse(audioCtx, 3.5, 2.2);

  // Bus Gain Nodes
  activeTrackBusGain = audioCtx.createGain();
  activeTrackBusGain.gain.setValueAtTime(1.0, audioCtx.currentTime);

  bgTrackBusGain = audioCtx.createGain();
  bgTrackBusGain.gain.setValueAtTime(0.35, audioCtx.currentTime);

  ambientBusGain = audioCtx.createGain();
  ambientBusGain.gain.setValueAtTime(0.5, audioCtx.currentTime);

  // Wiring Nodes:
  // Active/BG/Ambient Busses -> Master Limiter -> Master Gain -> Audio Destination
  activeTrackBusGain.connect(masterLimiter);
  bgTrackBusGain.connect(masterLimiter);
  ambientBusGain.connect(masterLimiter);

  // Reverb Routing
  activeTrackBusGain.connect(masterReverb);
  bgTrackBusGain.connect(masterReverb);
  ambientBusGain.connect(masterReverb);

  masterReverb.connect(reverbDryWetGain);
  reverbDryWetGain.connect(masterLimiter);

  masterLimiter.connect(masterGain);
  masterGain.connect(audioCtx.destination);

  return audioCtx;
}

export function getAudioContext() {
  return audioCtx;
}

export function getActiveTrackBus() {
  return activeTrackBusGain;
}

export function getBgTrackBus() {
  return bgTrackBusGain;
}

export function getAmbientBus() {
  return ambientBusGain;
}

export function setReverbSend(value) {
  if (reverbDryWetGain && audioCtx) {
    reverbDryWetGain.gain.linearRampToValueAtTime(value, audioCtx.currentTime + 0.1);
  }
}

export function setActiveGain(value) {
  if (activeTrackBusGain && audioCtx) {
    activeTrackBusGain.gain.linearRampToValueAtTime(value, audioCtx.currentTime + 0.1);
  }
}

export function setBgGain(value) {
  if (bgTrackBusGain && audioCtx) {
    bgTrackBusGain.gain.linearRampToValueAtTime(value, audioCtx.currentTime + 0.1);
  }
}

/**
 * Generates synthetic impulse response for lush spacey ambient reverb
 */
function createImpulseResponse(ctx, duration, decay) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const n = i / length;
    const factor = Math.pow(1 - n, decay);
    left[i] = (Math.random() * 2 - 1) * factor;
    right[i] = (Math.random() * 2 - 1) * factor;
  }

  return impulse;
}
