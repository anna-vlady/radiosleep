/* ==========================================================================
   RADIOSLEEP — Hardware EC11 Rotary Encoder USB Web Serial Controller
   ========================================================================== */

import { tuneToFrequencyIndex, getTunedIndex, getTotalArchiveCount, rotateBackgroundTracks } from './multi-track-mixer.js';
import { refreshArchiveUI } from './ui.js';

let serialPort = null;
let reader = null;
let isConnected = false;

/**
 * Initializes Web Serial USB Link for physical EC11 Rotary Encoder
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
      btnConnect.innerText = 'Disconnect USB Knob';
      btnConnect.classList.add('connected');
    }
    if (statusLabel) {
      statusLabel.innerText = 'USB KNOB CONNECTED (115200 BAUD)';
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
    btnConnect.innerText = 'Connect USB Knob';
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
        buffer = lines.pop(); // Keep incomplete line fragment in buffer

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

/**
 * Parses Serial commands from Arduino sketch
 * Commands: "VAL:0.45", "POT:512", "+1", "-1", "CW", "CCW", "SW", "PUSH"
 */
function handleSerialCommand(cmd) {
  const totalCount = getTotalArchiveCount();
  const currentIdx = getTunedIndex();

  // --- Analog Potentiometer Position Control (0.0 to 1.0 or 0 to 1023) ---
  if (cmd.startsWith('VAL:') || cmd.startsWith('POT:')) {
    if (totalCount === 0) return;

    let ratio = 0;
    if (cmd.startsWith('VAL:')) {
      ratio = parseFloat(cmd.replace('VAL:', ''));
    } else if (cmd.startsWith('POT:')) {
      const rawVal = parseInt(cmd.replace('POT:', ''), 10);
      ratio = rawVal / 1023.0;
    }

    // Clamp ratio between 0.0 and 0.9999 & invert direction for natural clockwise rotation
    ratio = Math.max(0, Math.min(0.9999, 1.0 - ratio));
    const targetIdx = Math.floor(ratio * totalCount);

    if (targetIdx !== currentIdx) {
      tuneToFrequencyIndex(targetIdx);
      refreshArchiveUI();
    }
    return;
  }

  // --- Incremental Ticks ---
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
  } else if (cmd === 'SW' || cmd === 'PUSH' || cmd === 'BUTTON') {
    rotateBackgroundTracks();
  }
}

