/* ==========================================================================
   RADIOSLEEP — User Interface Controller & Ableton DAW Multi-Track Timeline
   ========================================================================== */

import { getAllArchivedRecordings } from './recorder.js';
import { setActiveRecordingItem, getActiveItem, getBgItems } from './multi-track-mixer.js';
import { setIntelligibility, getIntelligibility } from './generative-engine.js';
import { setAbletonFileReference, applyAbletonMp3File } from './ambient-soundscape.js';

let dawCanvas = null;
let dawCtx = null;
let visualizerAnimationId = null;

// Active Audio Clip Blocks on the Timeline: { trackIndex, startTime, duration, fxType, color, itemName }
const activeClips = [];

// Mute & Solo States
const trackMuteStates = [false, false, false, false, false, false];
const trackSoloStates = [false, false, false, false, false, false];

let startTimeMs = Date.now();

/**
 * Initializes UI Elements & Ableton DAW Multi-Track Timeline Canvas
 */
export function initUI({ onStartRecord, onStopRecord, onPresetSelect, onSourceChange, onVolChange, onGainChange, onForceRotate, onClearArchive }) {
  dawCanvas = document.getElementById('daw-timeline-canvas');
  if (dawCanvas) {
    dawCtx = dawCanvas.getContext('2d');
    startDawTimelineLoop();
  }

  const btnHoldRecord = document.getElementById('btn-hold-record');
  const recLed = document.getElementById('recording-led');
  const ledText = document.getElementById('led-status-text');
  const ledSubText = document.getElementById('led-sub-text');

  // --- Clear Archive Button ---
  const btnClearArchive = document.getElementById('btn-clear-archive');
  if (btnClearArchive) {
    btnClearArchive.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete all stored recordings and start completely fresh?')) {
        if (onClearArchive) await onClearArchive();
        activeClips.length = 0;
        refreshArchiveUI();
      }
    });
  }

  // --- Ableton MP3 File Selection & Apply Button ---
  const fileInput = document.getElementById('input-ableton-file');
  const btnApplyAbleton = document.getElementById('btn-apply-ableton');
  const fileNameDisplay = document.getElementById('ableton-file-name');

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        setAbletonFileReference(file);
        if (fileNameDisplay) {
          fileNameDisplay.innerText = `Selected File: ${file.name} (Click Done / Load MP3 to play)`;
        }
      }
    });
  }

  if (btnApplyAbleton) {
    btnApplyAbleton.addEventListener('click', async () => {
      const ok = await applyAbletonMp3File();
      if (ok && fileNameDisplay) {
        fileNameDisplay.innerText = `Ableton MP3 Loaded & Active Loop`;
        fileNameDisplay.style.color = '#00E699';
      }
    });
  }

  // --- Vocal Intelligibility Slider ---
  const intelligibilitySlider = document.getElementById('slider-intelligibility');
  const intelligibilityReadout = document.getElementById('intelligibility-readout');

  if (intelligibilitySlider) {
    intelligibilitySlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      setIntelligibility(val);
      if (intelligibilityReadout) {
        const pct = Math.round(val * 100);
        let label = 'Abstract FX';
        if (pct > 75) label = 'Clear Words';
        else if (pct > 40) label = 'Balanced FX';
        intelligibilityReadout.innerText = `${pct}% (${label})`;
      }
    });
  }

  // --- Hold To Record Mouse / Touch Handlers ---
  let isPointerDown = false;

  const triggerStart = async (e) => {
    if (e) e.preventDefault();
    if (isPointerDown || btnHoldRecord.disabled) return;
    isPointerDown = true;

    btnHoldRecord.classList.add('recording');
    recLed.className = 'led-indicator active';
    ledText.innerText = 'RECORDING ACTIVE';
    ledSubText.innerText = 'Capturing vocal input...';

    if (onStartRecord) await onStartRecord();
  };

  const triggerStop = (e) => {
    if (e) e.preventDefault();
    if (!isPointerDown) return;
    isPointerDown = false;

    btnHoldRecord.classList.remove('recording');
    recLed.className = 'led-indicator idle';
    ledText.innerText = 'PROCESSING SAMPLE';
    ledSubText.innerText = 'Chopping & Applying FX...';

    if (onStopRecord) {
      onStopRecord().then(() => {
        ledText.innerText = 'IDLE / LISTENING';
        ledSubText.innerText = 'Generative Soundscape Active';
        refreshArchiveUI();
      });
    }
  };

  btnHoldRecord.addEventListener('mousedown', triggerStart);
  btnHoldRecord.addEventListener('mouseup', triggerStop);
  btnHoldRecord.addEventListener('mouseleave', triggerStop);

  btnHoldRecord.addEventListener('touchstart', triggerStart, { passive: false });
  btnHoldRecord.addEventListener('touchend', triggerStop, { passive: false });

  // --- Keyboard Spacebar Hold Listener ---
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT') {
      triggerStart(e);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
      triggerStop(e);
    }
  });

  // --- Mute & Solo DAW Buttons ---
  document.querySelectorAll('.btn-mute').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-track'));
      trackMuteStates[idx] = !trackMuteStates[idx];
      btn.classList.toggle('active', trackMuteStates[idx]);
    });
  });

  document.querySelectorAll('.btn-solo').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-track'));
      trackSoloStates[idx] = !trackSoloStates[idx];
      btn.classList.toggle('active', trackSoloStates[idx]);
    });
  });

  // --- Preset Demo Buttons ---
  document.querySelectorAll('.btn-demo-sample').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-preset');
      onPresetSelect(type);
    });
  });

  // --- Ambient Source Radios ---
  document.querySelectorAll('input[name="ambient-source"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const val = e.target.value;
      const uploadBox = document.getElementById('ableton-upload-container');
      if (val === 'ableton') {
        uploadBox.classList.remove('hidden');
      } else {
        uploadBox.classList.add('hidden');
      }
      onSourceChange(val);
    });
  });

  // Sliders
  document.getElementById('slider-ambient-vol').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('ambient-vol-readout').innerText = `${Math.round(val * 100)}%`;
    onVolChange(val);
  });

  document.getElementById('slider-active-gain').addEventListener('input', (e) => {
    onGainChange('active', parseFloat(e.target.value));
  });

  document.getElementById('slider-bg-gain').addEventListener('input', (e) => {
    onGainChange('bg', parseFloat(e.target.value));
  });

  document.getElementById('slider-reverb-send').addEventListener('input', (e) => {
    onGainChange('reverb', parseFloat(e.target.value));
  });

  document.getElementById('btn-force-rotate').addEventListener('click', () => {
    onForceRotate();
  });

  refreshArchiveUI();
}

/**
 * Updates Mic VU Level Meter
 */
export function updateVuMeter(level) {
  const fill = document.getElementById('vu-bar-fill');
  const dbText = document.getElementById('vu-db-text');
  if (fill) fill.style.width = `${Math.min(100, level * 100)}%`;
  if (dbText) {
    const db = level > 0.001 ? Math.round(20 * Math.log10(level)) : -60;
    dbText.innerText = `${db} dB`;
  }
}

/**
 * Updates Multi-Track Names & Registers Triggered Clips on Timeline
 */
export function updateTrackMatrixUI(info) {
  const activeItem = getActiveItem();
  const bgItems = getBgItems();

  const dawT1 = document.getElementById('daw-t1-name');
  const stripT1 = document.getElementById('strip-t1');
  if (dawT1) {
    dawT1.innerText = activeItem ? activeItem.name : 'Empty';
  }
  if (stripT1 && activeItem) {
    stripT1.style.setProperty('--track-strip-color', activeItem.color);
  }

  for (let i = 1; i <= 4; i++) {
    const dawNode = document.getElementById(`daw-t${i+1}-name`);
    const item = bgItems[i - 1];
    if (dawNode) {
      dawNode.innerText = item ? item.name : 'Empty';
    }
  }

  if (info.fxType && info.duration) {
    const now = (Date.now() - startTimeMs) / 1000;
    const trackIndex = info.role === 'active' ? 0 : info.slotIndex;

    activeClips.push({
      trackIndex,
      startTime: now,
      duration: info.duration,
      color: info.color || '#00D2FF',
      fxType: info.fxType,
      itemName: info.role === 'active' ? (activeItem ? activeItem.name : 'Active') : (bgItems[info.slotIndex - 1] ? bgItems[info.slotIndex - 1].name : 'Sample')
    });
  }

  refreshArchiveUI();
}

/**
 * Updates 2-Minute Rotation Countdown Bar
 */
export function updateRotationTimerUI(secondsLeft, totalSeconds) {
  const timerText = document.getElementById('rotation-timer-text');
  const timerFill = document.getElementById('rotation-progress-fill');

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  if (timerText) timerText.innerText = formatted;
  if (timerFill) {
    const pct = (secondsLeft / totalSeconds) * 100;
    timerFill.style.width = `${pct}%`;
  }
}

/**
 * Refreshes Stored Archive List UI with Color Codes & ACTIVE, BG LAYER, STORED Badges
 */
export async function refreshArchiveUI() {
  const archiveList = document.getElementById('archive-list');
  const countBadge = document.getElementById('archive-count');
  if (!archiveList) return;

  const items = await getAllArchivedRecordings();
  const activeItem = getActiveItem();
  const bgItems = getBgItems();

  const activeName = activeItem ? activeItem.name : null;
  const bgNames = bgItems.map(b => b ? b.name : null);

  if (countBadge) countBadge.innerText = `${items.length} SAMPLES`;

  if (items.length === 0) {
    archiveList.innerHTML = `<div class="empty-archive">No recordings stored yet. Hold record to capture the first vocal sample!</div>`;
    return;
  }

  archiveList.innerHTML = items.reverse().map(item => {
    let statusBadgeHtml = '';
    let actionBtnHtml = '';

    if (activeName && item.name === activeName) {
      statusBadgeHtml = `<span class="archive-status-badge badge-active">ACTIVE TRACK</span>`;
      actionBtnHtml = `<span class="archive-active-indicator" style="color: var(--accent-red); font-weight:700; font-size:0.7rem;">★ Active Now</span>`;
    } else if (bgNames.includes(item.name)) {
      const layerIdx = bgNames.indexOf(item.name) + 1;
      statusBadgeHtml = `<span class="archive-status-badge badge-bg">BG LAYER ${layerIdx}</span>`;
      actionBtnHtml = `<button class="btn-secondary btn-play-archive" data-id="${item.id}">Promote to Active</button>`;
    } else {
      statusBadgeHtml = `<span class="archive-status-badge badge-stored">STATIONARY / STORED</span>`;
      actionBtnHtml = `<button class="btn-secondary btn-play-archive" data-id="${item.id}">Promote to Active</button>`;
    }

    return `
      <div class="archive-item" style="border-left: 4px solid ${item.color || '#00D2FF'}">
        <div class="archive-item-info">
          <div class="archive-item-header">
            <span class="archive-color-dot" style="background-color: ${item.color || '#00D2FF'}"></span>
            <span class="archive-item-title">${item.name}</span>
            ${statusBadgeHtml}
          </div>
          <span class="archive-item-meta">${item.duration.toFixed(2)}s | ${new Date(item.timestamp).toLocaleTimeString()}</span>
        </div>
        <div class="archive-actions">
          ${actionBtnHtml}
          <button class="btn-icon btn-dl-archive" data-id="${item.id}" title="Download WAV">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  archiveList.querySelectorAll('.btn-play-archive').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const item = items.find(i => i.id === id);
      if (item) {
        setActiveRecordingItem(item);
        refreshArchiveUI();
      }
    });
  });

  archiveList.querySelectorAll('.btn-dl-archive').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const item = items.find(i => i.id === id);
      if (item && item.blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(item.blob);
        a.download = `${item.name}.webm`;
        a.click();
      }
    });
  });
}

/**
 * Ableton-Style Multi-Track Timeline Canvas Renderer Loop
 */
function startDawTimelineLoop() {
  if (!dawCtx) return;

  const numTracks = 6;
  const trackHeight = dawCanvas.height / numTracks;
  const pixelsPerSecond = 80;

  const render = () => {
    const now = (Date.now() - startTimeMs) / 1000;

    const timeCodeNode = document.getElementById('daw-time-code');
    if (timeCodeNode) {
      const m = Math.floor(now / 60);
      const s = Math.floor(now % 60);
      const ms = Math.floor((now % 1) * 10);
      timeCodeNode.innerText = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
    }

    dawCtx.fillStyle = '#04060A';
    dawCtx.fillRect(0, 0, dawCanvas.width, dawCanvas.height);

    const playheadX = dawCanvas.width * 0.75;
    const windowStartSec = now - (playheadX / pixelsPerSecond);

    for (let i = 0; i < numTracks; i++) {
      const y = i * trackHeight;
      dawCtx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.015)' : 'rgba(0, 0, 0, 0.2)';
      dawCtx.fillRect(0, y, dawCanvas.width, trackHeight);

      dawCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      dawCtx.lineWidth = 1;
      dawCtx.beginPath();
      dawCtx.moveTo(0, y + trackHeight);
      dawCtx.lineTo(dawCanvas.width, y + trackHeight);
      dawCtx.stroke();
    }

    const gridInterval = 1.0;
    const startGridSec = Math.floor(windowStartSec);
    const endGridSec = startGridSec + (dawCanvas.width / pixelsPerSecond) + 2;

    for (let sec = startGridSec; sec <= endGridSec; sec += gridInterval) {
      const gx = (sec - windowStartSec) * pixelsPerSecond;
      dawCtx.strokeStyle = sec % 4 === 0 ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.03)';
      dawCtx.lineWidth = 1;
      dawCtx.beginPath();
      dawCtx.moveTo(gx, 0);
      dawCtx.lineTo(gx, dawCanvas.height);
      dawCtx.stroke();
    }

    // Render Track 5: Ambient Sound Bed
    const ambY = 5 * trackHeight + 4;
    const ambH = trackHeight - 8;
    dawCtx.fillStyle = 'rgba(0, 230, 153, 0.15)';
    dawCtx.strokeStyle = '#00E699';
    dawCtx.lineWidth = 1.5;
    dawCtx.fillRect(0, ambY, dawCanvas.width, ambH);
    dawCtx.strokeRect(0, ambY, dawCanvas.width, ambH);

    dawCtx.strokeStyle = '#00E699';
    dawCtx.lineWidth = 1;
    dawCtx.beginPath();
    for (let x = 0; x < dawCanvas.width; x += 4) {
      const wy = ambY + ambH / 2 + Math.sin((x + now * 50) * 0.05) * (ambH * 0.25);
      if (x === 0) dawCtx.moveTo(x, wy);
      else dawCtx.lineTo(x, wy);
    }
    dawCtx.stroke();

    // Render Audio Clip Blocks with Persistent Sample Color-Coding
    for (let c = activeClips.length - 1; c >= 0; c--) {
      const clip = activeClips[c];
      const clipEndSec = clip.startTime + clip.duration;

      if (clipEndSec < windowStartSec - 5) {
        activeClips.splice(c, 1);
        continue;
      }

      const clipX = (clip.startTime - windowStartSec) * pixelsPerSecond;
      const clipW = clip.duration * pixelsPerSecond;
      const clipY = clip.trackIndex * trackHeight + 4;
      const clipH = trackHeight - 8;

      const clipColor = clip.color || '#00D2FF';
      const isPlayingNow = now >= clip.startTime && now <= clipEndSec;

      dawCtx.fillStyle = isPlayingNow ? clipColor : hexToRgba(clipColor, 0.35);
      dawCtx.strokeStyle = clipColor;
      dawCtx.lineWidth = isPlayingNow ? 2 : 1;

      drawRoundedRect(dawCtx, clipX, clipY, clipW, clipH, 4);
      dawCtx.fill();
      dawCtx.stroke();

      if (isPlayingNow) {
        dawCtx.save();
        dawCtx.shadowColor = clipColor;
        dawCtx.shadowBlur = 14;
        dawCtx.strokeStyle = '#FFF';
        dawCtx.stroke();
        dawCtx.restore();
      }

      dawCtx.fillStyle = '#FFF';
      dawCtx.font = 'bold 9px "JetBrains Mono"';
      dawCtx.fillText(`[${clip.fxType}]`, clipX + 6, clipY + 16);

      dawCtx.font = '8px "Outfit"';
      dawCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      dawCtx.fillText(`${clip.duration.toFixed(2)}s`, clipX + 6, clipY + 28);

      if (clipW > 20) {
        dawCtx.strokeStyle = isPlayingNow ? 'rgba(255, 255, 255, 0.95)' : clipColor;
        dawCtx.lineWidth = 1;
        dawCtx.beginPath();
        const midY = clipY + clipH / 2;
        for (let wx = clipX + 4; wx < clipX + clipW - 4; wx += 3) {
          const amp = (Math.sin((wx + clip.startTime * 100) * 0.4) * 0.5 + 0.5) * (clipH * 0.35);
          dawCtx.moveTo(wx, midY - amp);
          dawCtx.lineTo(wx, midY + amp);
        }
        dawCtx.stroke();
      }
    }

    // Playhead Line
    dawCtx.strokeStyle = '#FF3B5C';
    dawCtx.lineWidth = 2;
    dawCtx.beginPath();
    dawCtx.moveTo(playheadX, 0);
    dawCtx.lineTo(playheadX, dawCanvas.height);
    dawCtx.stroke();

    dawCtx.fillStyle = '#FF3B5C';
    dawCtx.beginPath();
    dawCtx.moveTo(playheadX - 6, 0);
    dawCtx.lineTo(playheadX + 6, 0);
    dawCtx.lineTo(playheadX, 10);
    dawCtx.closePath();
    dawCtx.fill();

    visualizerAnimationId = requestAnimationFrame(render);
  };

  render();
}

function hexToRgba(hex, alpha) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
