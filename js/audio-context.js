/* ==========================================================================
   RADIOSLEEP — AudioContext Manager & Master Ethereal DSP Bus Architecture
   ========================================================================== */

let audioCtx = null;
let masterGain = null;
let masterLimiter = null;
let masterReverb = null;
let reverbDryWetGain = null;

let activeTrackBusGain = null;
let bgTrackBusGain = null;
let ambientBusGain = null;

// Ethereal DSP Busses: FDN Delay & Modal Resonator Bank
let fdnDelayLeft = null;
let fdnDelayRight = null;
let fdnFeedbackGain = null;
let fdnFilterNode = null;
let fdnSendGain = null;

let modalResonatorBank = [];
let modalSendGain = null;

/**
 * Initializes AudioContext & Master Ethereal Audio Busses
 */
export function initAudioContext() {
  if (audioCtx) return audioCtx;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContextClass();

  // Master Limiter / Compressor (Prevents clipping & distortion)
  masterLimiter = audioCtx.createDynamicsCompressor();
  masterLimiter.threshold.setValueAtTime(-2.0, audioCtx.currentTime);
  masterLimiter.knee.setValueAtTime(0, audioCtx.currentTime);
  masterLimiter.ratio.setValueAtTime(20, audioCtx.currentTime);
  masterLimiter.attack.setValueAtTime(0.003, audioCtx.currentTime);
  masterLimiter.release.setValueAtTime(0.1, audioCtx.currentTime);

  // Master Gain
  masterGain = audioCtx.createGain();
  masterGain.gain.setValueAtTime(0.85, audioCtx.currentTime);

  // --- 1. Deep Bloom Reverb ---
  masterReverb = audioCtx.createConvolver();
  reverbDryWetGain = audioCtx.createGain();
  reverbDryWetGain.gain.setValueAtTime(0.45, audioCtx.currentTime);
  masterReverb.buffer = createDeepBloomImpulseResponse(audioCtx, 4.5, 2.5);

  // --- 2. Feedback Delay Network (FDN) ---
  fdnSendGain = audioCtx.createGain();
  fdnSendGain.gain.setValueAtTime(0.25, audioCtx.currentTime);

  fdnDelayLeft = audioCtx.createDelay(2.0);
  fdnDelayLeft.delayTime.setValueAtTime(0.375, audioCtx.currentTime); // 375ms

  fdnDelayRight = audioCtx.createDelay(2.0);
  fdnDelayRight.delayTime.setValueAtTime(0.500, audioCtx.currentTime); // 500ms

  // Safe non-runaway feedback gain (0.25)
  fdnFeedbackGain = audioCtx.createGain();
  fdnFeedbackGain.gain.setValueAtTime(0.25, audioCtx.currentTime);

  fdnFilterNode = audioCtx.createBiquadFilter();
  fdnFilterNode.type = 'lowpass';
  fdnFilterNode.frequency.setValueAtTime(2400, audioCtx.currentTime); // Soft warm damping

  // FDN Routing: Send -> Delays -> Filter -> Feedback Gain -> Cross-Feed
  fdnSendGain.connect(fdnDelayLeft);
  fdnSendGain.connect(fdnDelayRight);

  fdnDelayLeft.connect(fdnFilterNode);
  fdnDelayRight.connect(fdnFilterNode);

  fdnFilterNode.connect(fdnFeedbackGain);
  fdnFeedbackGain.connect(fdnDelayRight);
  fdnFeedbackGain.connect(fdnDelayLeft);

  fdnFilterNode.connect(masterReverb);
  fdnFilterNode.connect(masterLimiter);

  // --- 3. Sympathetic Modal Resonator Bank ---
  modalSendGain = audioCtx.createGain();
  modalSendGain.gain.setValueAtTime(0.20, audioCtx.currentTime);

  // Modal Pentatonic Scale Frequencies (Hz): C3, G3, B3, C4, D4
  const modalFreqs = [130.81, 196.00, 246.94, 261.63, 293.66];
  modalResonatorBank = modalFreqs.map(freq => {
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, audioCtx.currentTime);
    filter.Q.setValueAtTime(6.0, audioCtx.currentTime); // Smooth warm resonance

    modalSendGain.connect(filter);
    filter.connect(masterReverb);
    filter.connect(masterLimiter);
    return filter;
  });

  // --- Track Busses ---
  activeTrackBusGain = audioCtx.createGain();
  activeTrackBusGain.gain.setValueAtTime(1.0, audioCtx.currentTime);

  bgTrackBusGain = audioCtx.createGain();
  bgTrackBusGain.gain.setValueAtTime(0.35, audioCtx.currentTime);

  ambientBusGain = audioCtx.createGain();
  ambientBusGain.gain.setValueAtTime(0.5, audioCtx.currentTime);

  // Wiring Busses to Output & Effects
  activeTrackBusGain.connect(masterLimiter);
  activeTrackBusGain.connect(masterReverb);
  activeTrackBusGain.connect(fdnSendGain);
  activeTrackBusGain.connect(modalSendGain);

  bgTrackBusGain.connect(masterLimiter);
  bgTrackBusGain.connect(masterReverb);
  bgTrackBusGain.connect(fdnSendGain);
  bgTrackBusGain.connect(modalSendGain);

  ambientBusGain.connect(masterLimiter);
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

export function getReverbNode() {
  return masterReverb;
}

export function getFdnSendBus() {
  return fdnSendGain;
}

export function getModalSendBus() {
  return modalSendGain;
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
 * Generates impulse response for Bloom Reverb
 */
function createDeepBloomImpulseResponse(ctx, duration = 4.5, decay = 2.5) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, sampleRate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const n = i / length;
    const envelope = Math.pow(1 - n, decay) * (1 - Math.exp(-n * 10));
    left[i] = (Math.random() * 2 - 1) * envelope * 0.5;
    right[i] = (Math.random() * 2 - 1) * envelope * 0.5;
  }

  return impulse;
}

let currentMasterGainValue = 0.85;
let staticMuteTimeoutId = null;

/**
 * Plays a loud, crisp burst of radio static noise when switching active radio channels.
 * Completely mutes/ducks the rest of the soundscape for the burst duration (inter-station drop out).
 */
export function playRadioStaticBurst(durationSec = 0.22) {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;
  const sampleRate = audioCtx.sampleRate;
  const bufferSize = Math.floor(sampleRate * durationSec);
  const buffer = audioCtx.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);

  // High density radio static noise with punchy crackle bursts
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    const crackle = Math.random() < 0.12 ? (Math.random() * 2 - 1) * 1.6 : 1.0;
    data[i] = white * crackle;
  }

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  // Bandpass filter for crisp radio inter-station static hiss
  const radioFilter = audioCtx.createBiquadFilter();
  radioFilter.type = 'bandpass';
  radioFilter.frequency.setValueAtTime(2400, now);
  radioFilter.Q.setValueAtTime(1.1, now);

  // High volume static burst (a lot louder)
  const burstGain = audioCtx.createGain();
  burstGain.gain.setValueAtTime(0.001, now);
  burstGain.gain.setValueAtTime(1.6, now + 0.002);
  burstGain.gain.setValueAtTime(1.6, now + durationSec - 0.004);
  burstGain.gain.setValueAtTime(0.001, now + durationSec);

  source.connect(radioFilter);
  radioFilter.connect(burstGain);

  // Connect static directly to hardware destination so it bypasses masterGain ducking
  burstGain.connect(audioCtx.destination);

  // --- DUCK / MUTE THE ENTIRE SOUNDSCAPE DURING STATIC ---
  if (masterGain) {
    if (masterGain.gain.value > 0.01) {
      currentMasterGainValue = masterGain.gain.value;
    }

    // Instant hard mute (no fade)
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(0.0, now);

    if (staticMuteTimeoutId) {
      clearTimeout(staticMuteTimeoutId);
    }

    // Instant hard unmute when static finishes
    staticMuteTimeoutId = setTimeout(() => {
      if (audioCtx && masterGain) {
        const unmuteTime = audioCtx.currentTime;
        masterGain.gain.cancelScheduledValues(unmuteTime);
        masterGain.gain.setValueAtTime(currentMasterGainValue, unmuteTime);
      }
    }, durationSec * 1000);
  }

  source.start(now);
}


