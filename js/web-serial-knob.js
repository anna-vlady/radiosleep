import { tuneToFrequencyIndex, getTunedIndex, getTotalArchiveCount, rotateBackgroundTracks, setActiveRecordingItem } from './multi-track-mixer.js';
import { startRecording, stopRecording } from './recorder.js';
import { setIntelligibility, setScrubOffsetRatio, getScrubOffsetRatio } from './generative-engine.js';
import { setAmbientVolume } from './ambient-soundscape.js';
import { setBgGain } from './audio-context.js';
import { refreshArchiveUI } from './ui.js';

let midiOutput = null;

// Initialize Web MIDI Access for Ableton Live Effects Control
if (typeof navigator !== 'undefined' && navigator.requestMIDIAccess) {
  navigator.requestMIDIAccess().then(access => {
    const outputs = Array.from(access.outputs.values());
    if (outputs.length > 0) {
      midiOutput = outputs[0];
      console.log('🎹 Web MIDI initialized for Ableton Live:', midiOutput.name);
    }
  }).catch(err => console.warn('Web MIDI Notice:', err));
}

function sendMidiFxTrigger(isPressed) {
  if (midiOutput) {
    // Send MIDI Note 60 (C3) + CC 20 to Ableton Live
    const noteStatus = isPressed ? 0x90 : 0x80;
    midiOutput.send([noteStatus, 60, isPressed ? 127 : 0]);

    const ccStatus = 0xB0;
    midiOutput.send([ccStatus, 20, isPressed ? 127 : 0]);
  }
}

let serialPort = null;
let reader = null;
let isConnected = false;

/**
 * Initializes Web Serial USB Link for physical EC11 / Potentiometer / Hardware Controls
 */
export function initWebSerialKnob() {
  const btnConnect = document.getElementById('btn-connect-hardware');
  const statusLabel = document.getElementById('hardware-status');

  if (!('serial' in navigator)) {
    if (statusLabel) {
      statusLabel.innerText = 'WEB SERIAL NOT SUPPORTED (USE CHROME/EDGE)';
      statusLabel.style.color = '#FF3B5C';
    }
    if (btnConnect) btnConnect.disabled = true;
    return;
  }

  if (btnConnect) {
    btnConnect.addEventListener('click', async () => {
      if (isConnected) {
        disconnectSerial();
        return;
      }
      await connectSerial();
    });
  }

  // Auto disconnect on page unload
  window.addEventListener('beforeunload', () => {
    disconnectSerial();
  });
}

/**
 * Connects to Arduino USB Serial Port
 */
async function connectSerial() {
  const btnConnect = document.getElementById('btn-connect-hardware');
  const statusLabel = document.getElementById('hardware-status');

  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });

    isConnected = true;
    if (btnConnect) {
      btnConnect.innerText = 'Disconnect USB Controller';
      btnConnect.classList.add('connected');
    }
    if (statusLabel) {
      statusLabel.innerText = 'USB CONTROLLER CONNECTED (115200 BAUD)';
      statusLabel.style.color = '#00E699';
    }

    readSerialLoop();
  } catch (err) {
    console.warn('Web Serial connection cancelled or failed:', err);
    if (statusLabel) {
      statusLabel.innerText = 'PORT LOCKED! CLOSE ARDUINO SERIAL MONITOR & RETRY';
      statusLabel.style.color = '#FF3B5C';
    }
  }
}

/**
 * Disconnects Serial Port
 */
async function disconnectSerial() {
  const btnConnect = document.getElementById('btn-connect-hardware');
  const statusLabel = document.getElementById('hardware-status');

  isConnected = false;
  if (reader) {
    try {
      await reader.cancel();
      reader.releaseLock();
    } catch (_) {}
    reader = null;
  }
  if (serialPort) {
    try {
      await serialPort.close();
    } catch (_) {}
    serialPort = null;
  }

  if (btnConnect) {
    btnConnect.innerText = 'Connect USB Controller';
    btnConnect.classList.remove('connected');
  }
  if (statusLabel) {
    statusLabel.innerText = 'USB DISCONNECTED';
    statusLabel.style.color = 'rgba(255,255,255,0.5)';
  }
}

/**
 * Reads incoming serial lines from Arduino
 */
async function readSerialLoop() {
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable);
  const inputStream = textDecoder.readable;
  reader = inputStream.getReader();

  let buffer = '';

  try {
    while (isConnected) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            handleSerialCommand(trimmed);
          }
        }
      }
    }
  } catch (err) {
    console.error('Serial read loop error:', err);
  } finally {
    reader.releaseLock();
  }
}

let isHardwareRecording = false;

/**
 * Parses Serial commands from Arduino sketch
 */
async function handleSerialCommand(cmd) {
  console.log('📡 Hardware USB Command received:', cmd);

  const totalCount = getTotalArchiveCount();
  const currentIdx = getTunedIndex();

  const recLed = document.getElementById('recording-led');
  const ledText = document.getElementById('led-status-text');
  const ledSubText = document.getElementById('led-sub-text');
  const btnHoldRecord = document.getElementById('btn-hold-record');

  // --- 1. ABLETON LIVE EFFECTS BUTTON (PIN 6) ---
  if (cmd === 'FX_START' || cmd === 'FX:1' || cmd === 'FX_TRIGGER') {
    sendMidiFxTrigger(true);
    if (recLed) recLed.className = 'led-indicator active';
    if (ledText) ledText.innerText = 'ABLETON FX ACTIVE ⚡';
    if (ledSubText) ledSubText.innerText = 'Sending MIDI trigger to Ableton Live...';
    return;
  }

  if (cmd === 'FX_STOP' || cmd === 'FX:0') {
    sendMidiFxTrigger(false);
    if (recLed) recLed.className = 'led-indicator idle';
    if (ledText) ledText.innerText = 'IDLE / LISTENING';
    if (ledSubText) ledSubText.innerText = 'Generative Soundscape Active';
    return;
  }

  // --- 2. EC11 ROTARY TIMELINE SCRUBBING (PINS 2 & 3) ---
  if (cmd.startsWith('SCRUB:') || cmd.startsWith('SCRUB_POS:')) {
    let raw = cmd.replace('SCRUB_POS:', '').replace('SCRUB:', '');
    let ratio = parseFloat(raw);
    if (!isNaN(ratio)) {
      if (ratio > 1.0) ratio = ratio / 1023.0; // Scale 0-1023 to 0.0-1.0
      setScrubOffsetRatio(ratio);
    }
    return;
  }

  if (cmd === 'SCRUB:+1' || cmd === 'SCRUB_INC') {
    const current = getScrubOffsetRatio();
    setScrubOffsetRatio(current + 0.05);
    return;
  }

  if (cmd === 'SCRUB:-1' || cmd === 'SCRUB_DEC') {
    const current = getScrubOffsetRatio();
    setScrubOffsetRatio(current - 0.05);
    return;
  }

  // --- 3. HARDWARE PUSH BUTTON RECORDING (HOLD TO RECORD) ---
  if (cmd === 'REC_START' || cmd === 'REC:1') {
    if (isHardwareRecording) return;
    isHardwareRecording = true;

    if (btnHoldRecord) btnHoldRecord.classList.add('recording');
    if (recLed) recLed.className = 'led-indicator active';
    if (ledText) ledText.innerText = 'RECORDING ACTIVE (HARDWARE)';
    if (ledSubText) ledSubText.innerText = 'Capturing vocal input from hardware button...';

    startRecording();
    return;
  }

  if (cmd === 'REC_STOP' || cmd === 'REC:0') {
    if (!isHardwareRecording) return;
    isHardwareRecording = false;

    if (btnHoldRecord) btnHoldRecord.classList.remove('recording');
    if (recLed) recLed.className = 'led-indicator idle';
    if (ledText) ledText.innerText = 'PROCESSING SAMPLE';
    if (ledSubText) ledSubText.innerText = 'Chopping & Applying FX...';

    try {
      const result = await stopRecording();
      if (result && result.recordItem) {
        setActiveRecordingItem(result.recordItem);
      }
    } catch (err) {
      console.error('Hardware stop recording error:', err);
    } finally {
      if (ledText) ledText.innerText = 'IDLE / LISTENING';
      if (ledSubText) ledSubText.innerText = 'Generative Soundscape Active';
      refreshArchiveUI();
    }
    return;
  }

  // --- 2. PHYSICAL TROYKA SLIDER (NON-ACTIVE BACKGROUND GAIN CONTROL) ---
  const upperCmd = cmd.toUpperCase();
  if (upperCmd.startsWith('SLIDER') || upperCmd.startsWith('A1:') || upperCmd.startsWith('POT2:') || upperCmd.startsWith('VAL2:') || upperCmd.startsWith('S1:') || upperCmd.startsWith('DIST:') || upperCmd.startsWith('DRIVE:') || upperCmd.startsWith('BG_GAIN:')) {
    const parts = cmd.split(':');
    const rawStr = parts.length > 1 ? parts[1] : cmd;
    let num = parseFloat(rawStr);

    if (!isNaN(num)) {
      let gainVal = num > 1.0 ? num / 1023.0 : num;
      gainVal = Math.max(0, Math.min(1.0, gainVal));

      // 1. Update Web Audio DSP Gain for Non-Active Background Tracks
      setBgGain(gainVal);

      // 2. Update UI Slider Element "Non-Active Background Gain" (slider-bg-gain)
      const sliderBgGain = document.getElementById('slider-bg-gain');
      if (sliderBgGain) sliderBgGain.value = gainVal;

      // 3. Update Visual Troyka Slider (if present)
      const sliderEl = document.getElementById('slider-hardware-troyka');
      const readoutEl = document.getElementById('hardware-slider-readout');
      const pct = Math.round(gainVal * 100);
      if (sliderEl) sliderEl.value = pct;
      if (readoutEl) readoutEl.innerText = `${pct}%`;
    }
    return;
  }

  // --- 3. ANALOG POTENTIOMETER CHANNEL TUNER ---
  if (cmd.startsWith('VAL:') || cmd.startsWith('POT:')) {
    if (totalCount === 0) return;

    let ratio = 0;
    if (cmd.startsWith('VAL:')) {
      ratio = parseFloat(cmd.replace('VAL:', ''));
    } else if (cmd.startsWith('POT:')) {
      const rawVal = parseInt(cmd.replace('POT:', ''), 10);
      ratio = rawVal / 1023.0;
    }

    ratio = Math.max(0, Math.min(0.9999, 1.0 - ratio));
    setScrubOffsetRatio(ratio);

    const targetIdx = Math.floor(ratio * totalCount);

    if (targetIdx !== currentIdx) {
      tuneToFrequencyIndex(targetIdx);
      refreshArchiveUI();
    }
    return;
  }

  // --- 3. VOCAL INTELLIGIBILITY POTENTIOMETER / SLIDER (INTEL:0.0 - 1.0) ---
  if (cmd.startsWith('INTEL:')) {
    const val = parseFloat(cmd.replace('INTEL:', ''));
    if (!isNaN(val)) {
      setIntelligibility(val);
      const slider = document.getElementById('slider-intelligibility');
      const readout = document.getElementById('intelligibility-readout');
      if (slider) slider.value = val;
      if (readout) {
        const pct = Math.round(val * 100);
        readout.innerText = `${pct}% (${pct > 75 ? 'Clear Words' : pct > 40 ? 'Balanced' : 'Ethereal Cloud'})`;
      }
    }
    return;
  }

  // --- 4. AMBIENT VOLUME SLIDER (AMB_VOL:0.0 - 1.0) ---
  if (cmd.startsWith('AMB_VOL:')) {
    const val = parseFloat(cmd.replace('AMB_VOL:', ''));
    if (!isNaN(val)) {
      setAmbientVolume(val);
      const slider = document.getElementById('slider-ambient-vol');
      const readout = document.getElementById('ambient-vol-readout');
      if (slider) slider.value = val;
      if (readout) readout.innerText = `${Math.round(val * 100)}%`;
    }
    return;
  }

  // --- 5. INCREMENTAL TICKS & BUTTONS ---
  if (cmd === '+1' || cmd === 'CW' || cmd === 'STEP:1' || cmd === 'RIGHT') {
    if (totalCount === 0) return;
    const nextIdx = (currentIdx + 1) % totalCount;
    tuneToFrequencyIndex(nextIdx);
    refreshArchiveUI();
  } else if (cmd === '-1' || cmd === 'CCW' || cmd === 'STEP:-1' || cmd === 'LEFT') {
    if (totalCount === 0) return;
    const prevIdx = ((currentIdx - 1) % totalCount + totalCount) % totalCount;
    tuneToFrequencyIndex(prevIdx);
    refreshArchiveUI();
  } else if (cmd === 'SW' || cmd === 'PUSH' || cmd === 'ROTATE') {
    rotateBackgroundTracks();
  }
}


