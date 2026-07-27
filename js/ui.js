/* ==========================================================================
   RADIOSLEEP — User Interface Controller & Ableton DAW Multi-Track Timeline
   ========================================================================== */

import { getAllArchivedRecordings } from './recorder.js';
import { 
  setActiveRecordingItem, 
  getActiveItem, 
  getBgItems, 
  tuneToFrequencyIndex, 
  getTunedIndex, 
  getTotalArchiveCount 
} from './multi-track-mixer.js';
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

  // Initialize standalone visual LED Rotary Knob
  initTactileLedKnob();

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
        let label = 'Ethereal Cloud';
        if (pct > 75) label = 'Clear Words';
        else if (pct > 40) label = 'Balanced';
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
 * Updates Multi-Track Names, Strip Color Accent Bars & Registers Triggered Clips on Timeline
 */
export function updateTrackMatrixUI(info) {
  const activeItem = getActiveItem();
  const bgItems = getBgItems();

  // 1. Track 1: Active Track Header
  const dawT1 = document.getElementById('daw-t1-name');
  const stripT1 = document.getElementById('strip-t1');
  if (dawT1) {
    dawT1.innerText = activeItem ? activeItem.name : 'Empty';
  }
  if (stripT1) {
    const activeColor = activeItem ? (activeItem.color || '#FF3B5C') : '#334155';
    stripT1.style.borderLeft = `6px solid ${activeColor}`;
  }

  // 2. Tracks 2-5: Background Layer Headers
  for (let i = 1; i <= 4; i++) {
    const dawNode = document.getElementById(`daw-t${i+1}-name`);
    const stripNode = document.getElementById(`strip-t${i+1}`);
    const item = bgItems[i - 1];
    if (dawNode) {
      dawNode.innerText = item ? item.name : 'Empty';
    }
    if (stripNode) {
      const bgColor = item ? (item.color || '#00D2FF') : '#334155';
      stripNode.style.borderLeft = `6px solid ${bgColor}`;
    }
  }

  // 3. Register clip block onto DAW Timeline Canvas
  if (info && info.fxType && info.duration) {
    const now = (Date.now() - startTimeMs) / 1000;
    const trackIndex = info.role === 'active' ? 0 : info.slotIndex;
    const currentItem = info.role === 'active' ? activeItem : bgItems[info.slotIndex - 1];
    const clipColor = currentItem ? (currentItem.color || '#00D2FF') : (info.color || '#00D2FF');

    activeClips.push({
      trackIndex,
      startTime: now,
      duration: info.duration,
      color: clipColor,
      fxType: info.fxType,
      itemName: currentItem ? currentItem.name : 'Sample'
    });
  }

  if (info && info.role === 'refresh') {
    refreshArchiveUI();
  }
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
  const tunedIdx = getTunedIndex();

  const activeName = activeItem ? activeItem.name : null;
  const bgNames = bgItems.map(b => b ? b.name : null);

  if (countBadge) countBadge.innerText = `${items.length} SAMPLES`;

  if (items.length === 0) {
    archiveList.innerHTML = `<div class="empty-archive">No recordings stored yet. Hold record to capture the first vocal sample!</div>`;
    updateKnobRotationUI(0, 0);
    return;
  }

  // Preserve items order (0 = newest)
  const sortedItems = [...items].reverse();

  archiveList.innerHTML = sortedItems.map((item, idx) => {
    let statusBadgeHtml = '';
    let actionBtnHtml = '';
    const itemColor = item.color || '#00D2FF';
    const isTunedActive = activeName && item.name === activeName;

    if (isTunedActive) {
      statusBadgeHtml = `<span class="archive-status-badge badge-active" style="background:${itemColor}; color:#000; border-color:${itemColor}; font-weight:800;">📻 TUNED ACTIVE (CH ${tunedIdx})</span>`;
      actionBtnHtml = `<span class="archive-active-indicator" style="color: ${itemColor}; font-weight:700; font-size:0.75rem;">★ TUNED ACTIVE</span>`;
    } else if (bgNames.includes(item.name)) {
      const layerIdx = bgNames.indexOf(item.name) + 1;
      statusBadgeHtml = `<span class="archive-status-badge badge-bg" style="border-color:${itemColor}; color:${itemColor}">BG LAYER ${layerIdx}</span>`;
      actionBtnHtml = `<button class="btn-secondary btn-tune-archive" data-index="${idx}">Tune Channel</button>`;
    } else {
      statusBadgeHtml = `<span class="archive-status-badge badge-stored">STORED</span>`;
      actionBtnHtml = `<button class="btn-secondary btn-tune-archive" data-index="${idx}">Tune Channel</button>`;
    }

    const cardClass = isTunedActive ? 'archive-item archive-item-active-tuned' : 'archive-item';
    const cardGlowStyle = isTunedActive 
      ? `border-left: 8px solid ${itemColor}; box-shadow: 0 0 16px ${hexToRgba(itemColor, 0.4)}, inset 0 0 12px ${hexToRgba(itemColor, 0.15)}; background: rgba(255,255,255,0.06);` 
      : `border-left: 6px solid ${itemColor};`;

    return `
      <div class="${cardClass}" id="archive-card-${idx}" style="${cardGlowStyle}">
        <div class="archive-item-info">
          <div class="archive-item-header">
            <span class="archive-color-dot" style="background-color: ${itemColor}; width:10px; height:10px; border-radius:50%; display:inline-block; box-shadow: 0 0 8px ${itemColor}"></span>
            <span class="archive-item-title" style="color: ${itemColor}; font-size:0.8rem;">${item.name}</span>
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

  archiveList.querySelectorAll('.btn-tune-archive').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.getAttribute('data-index'));
      tuneToFrequencyIndex(index);
      refreshArchiveUI();
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

  // Sync Tactile Rotary Knob rotation & LED dots
  updateKnobRotationUI(tunedIdx, sortedItems.length);
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
    const activeItem = getActiveItem();
    const bgItems = getBgItems();

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

    // Draw Track Rows with Left Color Accent Lines
    for (let i = 0; i < numTracks; i++) {
      const y = i * trackHeight;
      const currentTrackItem = i === 0 ? activeItem : (i <= 4 ? bgItems[i - 1] : null);
      const trackColor = currentTrackItem ? (currentTrackItem.color || '#00D2FF') : null;

      dawCtx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.015)' : 'rgba(0, 0, 0, 0.2)';
      dawCtx.fillRect(0, y, dawCanvas.width, trackHeight);

      // Track bottom divider line
      dawCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      dawCtx.lineWidth = 1;
      dawCtx.beginPath();
      dawCtx.moveTo(0, y + trackHeight);
      dawCtx.lineTo(dawCanvas.width, y + trackHeight);
      dawCtx.stroke();

      // Bold Left Canvas Color Indicator per Track
      if (trackColor) {
        dawCtx.fillStyle = trackColor;
        dawCtx.fillRect(0, y, 5, trackHeight);
      }
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

let isUserScrubbingDial = false;

/**
 * Updates Tactile Dark LED Rotary Knob Visual Angle & Illumination
 */
export function updateKnobRotationUI(index, totalCount) {
  const knobBody = document.getElementById('tactile-knob-body');
  const knobRing = document.getElementById('knob-led-ring');
  if (!knobBody || !knobRing) return;

  const TOTAL_DOTS = 36;
  const START_ANGLE = -135;
  const END_ANGLE = 135;
  const RANGE = END_ANGLE - START_ANGLE;

  let angle = START_ANGLE;
  if (totalCount > 1) {
    const stepAngle = RANGE / (totalCount - 1);
    angle = START_ANGLE + index * stepAngle;
  } else if (totalCount === 1) {
    angle = START_ANGLE;
  }

  knobBody.style.transform = `rotate(${angle}deg)`;

  const norm = (angle - START_ANGLE) / RANGE;
  const activeCount = totalCount > 0 ? Math.round(norm * (TOTAL_DOTS - 1)) + 1 : 0;

  const dots = knobRing.querySelectorAll('.led-dot');
  dots.forEach((dot, idx) => {
    if (idx < activeCount) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
}

/**
 * Tactile Dark LED Rotary Channel Selector Knob Controller
 * (Turning knob 1 tick tunes Active Track to sample K from archive with N ticks for N total samples)
 */
function initTactileLedKnob() {
  const knobRing = document.getElementById('knob-led-ring');
  const knobBody = document.getElementById('tactile-knob-body');
  if (!knobRing || !knobBody) return;

  const TOTAL_DOTS = 36;
  const START_ANGLE = -135;
  const END_ANGLE = 135;
  const RANGE = END_ANGLE - START_ANGLE;
  const RADIUS = 92;

  const centerX = 110;
  const centerY = 95;

  knobRing.innerHTML = '';

  // Generate 36 LED dots around the arc
  for (let i = 0; i < TOTAL_DOTS; i++) {
    const frac = i / (TOTAL_DOTS - 1);
    const angleDeg = START_ANGLE + frac * RANGE;
    const angleRad = (angleDeg - 90) * (Math.PI / 180);

    const x = centerX + RADIUS * Math.cos(angleRad);
    const y = centerY + RADIUS * Math.sin(angleRad);

    const dot = document.createElement('div');
    dot.className = 'led-dot';
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;

    knobRing.appendChild(dot);
  }

  // Interactive Dragging & Tick Tuning
  let isDragging = false;
  let startY = 0;
  let startIndex = 0;
  const DRAG_PX_PER_STEP = 28; // 28px drag = 1 channel tick

  function stepChannelTo(targetIndex) {
    const totalCount = getTotalArchiveCount();
    if (totalCount === 0) return;
    const clampedIndex = ((targetIndex % totalCount) + totalCount) % totalCount;
    if (clampedIndex !== getTunedIndex()) {
      tuneToFrequencyIndex(clampedIndex);
      refreshArchiveUI();
    }
  }

  knobBody.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    knobBody.setPointerCapture(e.pointerId);
    isDragging = true;
    isUserScrubbingDial = true;
    startY = e.clientY;
    startIndex = getTunedIndex();
  });

  knobBody.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const deltaY = e.clientY - startY; // Dragging DOWN increases channel index (newer to older)
    const steps = Math.round(deltaY / DRAG_PX_PER_STEP);
    const targetIndex = startIndex + steps;
    stepChannelTo(targetIndex);
  });

  const endDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;
    isUserScrubbingDial = false;
    if (e && e.pointerId != null) {
      try { knobBody.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    refreshArchiveUI();
  };

  knobBody.addEventListener('pointerup', endDrag);
  knobBody.addEventListener('pointercancel', endDrag);

  // Mouse Wheel scroll support
  if (knobBody.parentElement) {
    knobBody.parentElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      const totalCount = getTotalArchiveCount();
      if (totalCount === 0) return;
      const step = e.deltaY < 0 ? -1 : 1; // Scroll UP = prev channel, Scroll DOWN = next channel
      stepChannelTo(getTunedIndex() + step);
    }, { passive: false });
  }
}
