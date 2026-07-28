/* ==========================================================================
   RADIOSLEEP — Main Application Entry Point & Controller
   ========================================================================== */

import { initAudioContext, setActiveGain, setBgGain, setReverbSend } from './audio-context.js';
import { initAmbientSoundscape, startAmbientSoundscape, setAmbientSource, setAmbientVolume } from './ambient-soundscape.js';
import { initMicrophone, startRecording, stopRecording, saveRecordingToArchive, getAllArchivedRecordings, clearAllArchivedRecordings, generatePresetTestBuffer } from './recorder.js';
import { initMultiTrackMixer, setActiveRecordingItem, rotateBackgroundTracks, clearAllTracks } from './multi-track-mixer.js';
import { initUI, updateVuMeter, updateTrackMatrixUI, updateRotationTimerUI, refreshArchiveUI } from './ui.js';
import { initWebSerialKnob } from './web-serial-knob.js';

let isEngineStarted = false;


async function ensureAudioEngineStarted() {
  if (isEngineStarted) return;

  const btnPower = document.getElementById('btn-power-audio');
  const audioStatus = document.getElementById('audio-context-status');

  const ctx = initAudioContext();
  await ctx.resume();

  initAmbientSoundscape();
  startAmbientSoundscape();

  initMultiTrackMixer(
    (info) => updateTrackMatrixUI(info),
    (secsLeft, totalSecs) => updateRotationTimerUI(secsLeft, totalSecs)
  );

  // Auto-hydrate existing archived recordings so most recent is AUTOMATICALLY Active
  try {
    const existing = await getAllArchivedRecordings();
    if (existing && existing.length > 0) {
      // Sort oldest to newest, then push each into stack so newest ends up at top (Active)
      existing.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      for (const rec of existing) {
        setActiveRecordingItem(rec);
      }
    }
  } catch (err) {
    console.warn('Archive hydration notice:', err);
  }

  const micReady = await initMicrophone((level) => updateVuMeter(level));

  if (audioStatus) {
    audioStatus.innerText = micReady ? 'ONLINE (MIC ACTIVE)' : 'ONLINE (SYNTH ONLY)';
    audioStatus.className = 'status-value online';
  }
  if (btnPower) {
    btnPower.innerText = 'Audio Engine Active';
    btnPower.disabled = true;
  }

  isEngineStarted = true;
  refreshArchiveUI();
}

document.addEventListener('DOMContentLoaded', () => {
  const btnPower = document.getElementById('btn-power-audio');
  const btnHoldRecord = document.getElementById('btn-hold-record');

  if (btnPower) {
    btnPower.addEventListener('click', () => ensureAudioEngineStarted());
  }

  if (btnHoldRecord) {
    btnHoldRecord.disabled = false;
  }

  // Initialize UI Bindings
  initUI({
    onStartRecord: async () => {
      await ensureAudioEngineStarted();
      startRecording();
    },
    onStopRecord: async () => {
      try {
        const result = await stopRecording();
        if (result && result.recordItem) {
          // AUTOMATICALLY set freshly recorded sample as ACTIVE immediately!
          setActiveRecordingItem(result.recordItem);
          refreshArchiveUI();
        }
      } catch (err) {
        console.error('Stop recording error:', err);
      }
    },
    onPresetSelect: async (type) => {
      await ensureAudioEngineStarted();

      const testBuffer = generatePresetTestBuffer(type);
      const name = `Preset_${type.toUpperCase()}`;
      
      const blob = new Blob([new Uint8Array(100)], { type: 'audio/wav' });
      const recordItem = await saveRecordingToArchive(blob, testBuffer, name);
      
      // AUTOMATICALLY set freshly generated sample as ACTIVE immediately!
      setActiveRecordingItem(recordItem);
      refreshArchiveUI();
    },
    onSourceChange: async (sourceType) => {
      await ensureAudioEngineStarted();
      setAmbientSource(sourceType);
    },
    onVolChange: (vol) => {
      setAmbientVolume(vol);
    },
    onGainChange: (type, val) => {
      if (type === 'active') setActiveGain(val);
      if (type === 'bg') setBgGain(val);
      if (type === 'reverb') setReverbSend(val);
    },
    onForceRotate: () => {
      rotateBackgroundTracks();
    },
    onClearArchive: async () => {
      await clearAllArchivedRecordings();
      clearAllTracks();
    }
  });

  // Initialize USB Web Serial hardware knob listener
  initWebSerialKnob();
});

