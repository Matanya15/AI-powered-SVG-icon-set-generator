/* ═══════════════════════════════════════════════════════════════
   Generate Page — Orchestration
   ═══════════════════════════════════════════════════════════════ */

// ── State ──
let generatedImages = [];
let croppedIcons = [];
let tracedSvgs = [];
let iconNames = [];
let isColorTrace = false;
let parsedSpec = null;
let currentAbort = null;
let lightMode = false;

// ── Constants ──
const STYLE_PREFIX = 'Icon style family should be: ';
const COUNT_PREFIX = 'Number of icons: ';
const COLOR_PREFIX = 'Icon color mode: ';
const COLOR_LABELS = {
  'bw': 'black & white only',
  'grayscale': 'grayscale (shades of gray)',
  'monochrome': 'monochrome single hue (e.g. all blue or all teal)',
  'duotone': 'duotone (two contrasting colors)',
  'pastel': 'pastel soft colors',
  'vibrant': 'vibrant colorful',
  'gradient': 'gradient fills',
  'neon-colors': 'neon bright glowing colors',
  'earth-tones': 'earth tones (warm browns, greens, tans)',
};

// ── Custom Style Dropdown ──
const styleDropdown = document.getElementById('styleDropdown');
const styleTrigger = document.getElementById('styleTrigger');
const stylePanel = document.getElementById('stylePanel');
let selectedStyle = 'outline';

styleTrigger.addEventListener('click', () => {
  styleDropdown.classList.toggle('open');
});

document.addEventListener('click', (e) => {
  if (!styleDropdown.contains(e.target)) styleDropdown.classList.remove('open');
});

stylePanel.querySelectorAll('.style-option').forEach(opt => {
  opt.addEventListener('click', () => {
    stylePanel.querySelector('.selected')?.classList.remove('selected');
    opt.classList.add('selected');
    selectedStyle = opt.dataset.value;
    styleTrigger.querySelector('.style-label').textContent = opt.querySelector('span:last-child').textContent;
    styleDropdown.classList.remove('open');
  });
});

// ── Quick Prompts ──
document.querySelectorAll('.quick-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('prompt').value = btn.dataset.prompt;
    document.getElementById('prompt').focus();
  });
});

// ── Helpers ──
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function isBlackAndWhite() {
  return document.getElementById('colorMode').value === 'bw';
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function fmtTime(ms) {
  return (ms / 1000).toFixed(1) + 's';
}

// ── Progress Log ──
const progressSection = document.getElementById('progressSection');
const progressLog = document.getElementById('progressLog');
const STEPS = [
  { id: 'plan', num: 1, name: 'Planning', descActive: 'Analyzing your request and designing the icon set...' },
  { id: 'draw', num: 2, name: 'Drawing',  descActive: 'Generating icon grid image...' },
  { id: 'cut',  num: 3, name: 'Cutting',  descActive: 'Cropping individual icons from the grid...' },
  { id: 'vec',  num: 4, name: 'Vectorizing', descActive: 'Converting to scalable SVG vectors...' },
];
let stepTimers = {};
let stepElements = {};

function resetProgress() {
  progressLog.innerHTML = '';
  stepTimers = {};
  stepElements = {};
}

function addStep(stepDef, customDesc) {
  const entry = document.createElement('div');
  entry.className = 'step-entry active';
  entry.id = 'step-' + stepDef.id;

  const desc = customDesc || stepDef.descActive;

  entry.innerHTML =
    '<div class="step-rail">' +
      '<div class="step-indicator">' + stepDef.num + '</div>' +
      '<div class="step-connector"></div>' +
    '</div>' +
    '<div class="step-body">' +
      '<div class="step-header">' +
        '<span class="step-name">' + stepDef.name + '</span>' +
        '<span class="step-timer" id="timer-' + stepDef.id + '">0.0s</span>' +
      '</div>' +
      '<div class="step-desc">' + desc + '</div>' +
      '<div class="step-summary" id="summary-' + stepDef.id + '" style="display:none"></div>' +
      '<div class="step-error-msg" id="error-' + stepDef.id + '" style="display:none"></div>' +
    '</div>';

  progressLog.appendChild(entry);
  stepElements[stepDef.id] = entry;

  const t0 = Date.now();
  const timerEl = document.getElementById('timer-' + stepDef.id);
  const iv = setInterval(() => {
    timerEl.textContent = fmtTime(Date.now() - t0);
  }, 100);
  stepTimers[stepDef.id] = { t0, iv };

  entry.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function completeStep(stepId, summaryHtml) {
  const timer = stepTimers[stepId];
  if (timer) {
    clearInterval(timer.iv);
    const elapsed = fmtTime(Date.now() - timer.t0);
    document.getElementById('timer-' + stepId).textContent = elapsed;
  }
  const entry = stepElements[stepId];
  if (entry) {
    entry.classList.remove('active');
    entry.classList.add('done');
    entry.querySelector('.step-indicator').innerHTML = '&#10003;';
  }
  if (summaryHtml) {
    const s = document.getElementById('summary-' + stepId);
    s.innerHTML = summaryHtml;
    s.style.display = '';
  }
}

function failStep(stepId, errorMsg, retryFn) {
  const timer = stepTimers[stepId];
  if (timer) clearInterval(timer.iv);
  const entry = stepElements[stepId];
  if (entry) {
    entry.classList.remove('active');
    entry.classList.add('error');
    entry.querySelector('.step-indicator').innerHTML = '&#10007;';
  }
  const errEl = document.getElementById('error-' + stepId);
  errEl.textContent = errorMsg;
  errEl.style.display = '';
  if (retryFn) {
    const btn = document.createElement('button');
    btn.className = 'retry-btn';
    btn.textContent = 'Retry';
    btn.addEventListener('click', retryFn);
    errEl.appendChild(btn);
  }
}

function updateStepDesc(stepId, desc) {
  const entry = stepElements[stepId];
  if (entry) entry.querySelector('.step-desc').textContent = desc;
}

// ── Main Generation Flow ──
async function startGeneration() {
  const prompt = document.getElementById('prompt').value.trim();
  if (!prompt) return;

  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  document.getElementById('generateLabel').textContent = 'Generating...';

  if (currentAbort) currentAbort.abort();
  currentAbort = new AbortController();

  generatedImages = [];
  croppedIcons = [];
  tracedSvgs = [];
  iconNames = [];
  parsedSpec = null;

  const generationStart = Date.now();

  document.getElementById('resultsSection').classList.add('hidden');
  progressSection.classList.remove('hidden');
  resetProgress();

  const colorMode = document.getElementById('colorMode').value;
  const iconCount = Math.max(4, Math.min(27, parseInt(document.getElementById('iconCount').value) || 9));
  isColorTrace = colorMode !== 'bw';

  const fullPrompt = prompt +
    '\n' + STYLE_PREFIX + selectedStyle +
    '\n' + COUNT_PREFIX + iconCount +
    '\n' + COLOR_PREFIX + (COLOR_LABELS[colorMode] || colorMode);

  try {
    // ──── STEP 1: Brief ────
    await runStepBrief(fullPrompt);
    if (currentAbort.signal.aborted) return;

    // ──── STEP 2: Image Gen ────
    await runStepImageGen();
    if (currentAbort.signal.aborted) return;

    // ──── STEP 3: Crop ────
    await runStepCrop();
    if (currentAbort.signal.aborted) return;

    // ──── STEP 4: Trace ────
    await runStepTrace();
    if (currentAbort.signal.aborted) return;

    renderResults(Date.now() - generationStart);
  } catch (e) {
    if (e.name === 'AbortError') return;
  } finally {
    btn.disabled = false;
    document.getElementById('generateLabel').textContent = 'Generate Icons';
    currentAbort = null;
  }
}

// ── Step 1: Brief ──
async function runStepBrief(fullPrompt) {
  const stepDef = STEPS[0];
  addStep(stepDef);

  const res = await fetch('/api/pipeline/brief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: fullPrompt, model: 'gemini-2.0-flash' }),
    signal: currentAbort.signal,
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    failStep(stepDef.id, data.error || 'HTTP ' + res.status, () => startGeneration());
    throw new Error(data.error || 'Brief failed');
  }

  const briefText = data.text || '';
  try {
    parsedSpec = JSON.parse(briefText);
    iconNames = (parsedSpec.icons || []).map(ic => ic.name);
  } catch (_) {
    parsedSpec = null;
    iconNames = [];
  }

  const nameList = iconNames.length
    ? 'Planned ' + iconNames.length + ' icons: ' + iconNames.join(', ')
    : 'Spec generated';
  completeStep(stepDef.id, nameList);
}

// ── Step 2: Image Gen ──
async function runStepImageGen() {
  const stepDef = STEPS[1];
  let batches;
  if (parsedSpec && parsedSpec.icons && parsedSpec.icons.length > 0) {
    batches = chunkArray(parsedSpec.icons, 9);
  } else {
    batches = [null];
  }

  const totalBatches = batches.length;
  const descBase = totalBatches > 1
    ? 'Generating icon grid images (0/' + totalBatches + ')...'
    : 'Generating icon grid image...';
  addStep(stepDef, descBase);

  generatedImages = [];

  for (let b = 0; b < totalBatches; b++) {
    if (totalBatches > 1) {
      updateStepDesc(stepDef.id, 'Generating icon grid image (' + (b + 1) + '/' + totalBatches + ')...');
    }

    let batchPayload;
    if (batches[b]) {
      const specWithBatch = Object.assign({}, parsedSpec, { icons: batches[b] });
      batchPayload = JSON.stringify(specWithBatch, null, 2);
    }
    const imgPromptBase = isBlackAndWhite() ? IMAGE_GEN_PROMPT_BW : IMAGE_GEN_PROMPT_COLOR;
    const briefText = parsedSpec ? JSON.stringify(parsedSpec, null, 2) : '';
    const batchPrompt = batchPayload
      ? imgPromptBase + batchPayload + IMAGE_GEN_SUFFIX
      : imgPromptBase + briefText + IMAGE_GEN_SUFFIX;

    const reqBody = { prompt: batchPrompt, model: 'gemini-3.1-flash-image-preview' };
    if (b > 0 && generatedImages.length > 0) {
      reqBody.reference_image = generatedImages[0];
    }

    const res = await fetch('/api/pipeline/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
      signal: currentAbort.signal,
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      failStep(stepDef.id, data.error || 'HTTP ' + res.status, () => startGeneration());
      throw new Error(data.error || 'Image gen failed');
    }
    if (data.image) generatedImages.push(data.image);
  }

  const summaryHtml = totalBatches > 1
    ? totalBatches + ' grid images generated'
    : 'Grid image generated';
  completeStep(stepDef.id, summaryHtml);
}

// ── Step 3: Crop ──
async function runStepCrop() {
  const stepDef = STEPS[2];
  addStep(stepDef, 'Cropping ' + generatedImages.length + ' grid(s) into individual icons...');

  const results = await Promise.all(generatedImages.map(imgData =>
    fetch('/api/pipeline/crop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_data: imgData }),
      signal: currentAbort.signal,
    }).then(r => r.json()).then(d => {
      if (d.error) throw new Error(d.error);
      return d.icons;
    })
  ));

  croppedIcons = results.flat();
  completeStep(stepDef.id, croppedIcons.length + ' icons extracted');
}

// ── Step 4: Trace ──
async function runStepTrace() {
  const stepDef = STEPS[3];
  const tracerMode = isColorTrace ? 'vtracer' : 'potrace';
  addStep(stepDef, 'Converting ' + croppedIcons.length + ' icons to SVG (' + tracerMode + ')...');

  const body = {
    icons: croppedIcons,
    names: iconNames,
    tracer: tracerMode,
  };

  const res = await fetch('/api/pipeline/trace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: currentAbort.signal,
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    failStep(stepDef.id, data.error || 'HTTP ' + res.status, () => startGeneration());
    throw new Error(data.error || 'Trace failed');
  }

  tracedSvgs = data.svgs;
  if (data.names) iconNames = data.names;
  completeStep(stepDef.id, data.svgs.length + ' SVGs ready');
}

// ── Render Results ──
function renderResults(totalMs) {
  const section = document.getElementById('resultsSection');
  const grid = document.getElementById('resultsGrid');
  section.classList.remove('hidden');
  grid.innerHTML = '';

  const totalSec = (totalMs / 1000).toFixed(1);
  document.getElementById('resultsTitle').innerHTML =
    tracedSvgs.length + ' Icon' + (tracedSvgs.length === 1 ? '' : 's') + ' Generated <span class="total-time">' + totalSec + 's</span>';

  tracedSvgs.forEach((svg, i) => {
    const card = document.createElement('div');
    card.className = 'icon-card';

    const preview = document.createElement('div');
    preview.className = 'icon-preview';
    preview.innerHTML = svg;

    const svgEl = preview.querySelector('svg');
    if (svgEl) {
      if (!svgEl.getAttribute('viewBox') && svgEl.getAttribute('width') && svgEl.getAttribute('height')) {
        svgEl.setAttribute('viewBox', '0 0 ' + svgEl.getAttribute('width') + ' ' + svgEl.getAttribute('height'));
      }
      svgEl.removeAttribute('width');
      svgEl.removeAttribute('height');
    }

    const name = document.createElement('div');
    name.className = 'icon-name';
    name.textContent = iconNames[i] || 'icon-' + (i + 1);
    name.title = iconNames[i] || 'icon-' + (i + 1);

    const actions = document.createElement('div');
    actions.className = 'icon-actions';
    actions.innerHTML =
      '<button class="icon-action-btn" title="Copy SVG" onclick="copySingleSvg(' + i + ')">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>' +
      '</button>' +
      '<button class="icon-action-btn" title="Download SVG" onclick="downloadSingleSvg(' + i + ')">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
      '</button>' +
      '<button class="icon-action-btn" title="Download PNG" onclick="downloadSinglePng(' + i + ')">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>' +
      '</button>';

    card.appendChild(actions);
    card.appendChild(preview);
    card.appendChild(name);
    grid.appendChild(card);
  });

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Toolbox ──
function toggleMode() {
  lightMode = !lightMode;
  const btn = document.getElementById('modeBtn');
  btn.innerHTML = lightMode ? '&#9790; Dark' : '&#9788; Light';
  document.getElementById('resultsGrid').classList.toggle('light-mode', lightMode);
}

document.getElementById('sizeSlider').addEventListener('input', function () {
  const pct = this.value;
  document.getElementById('sizeValue').textContent = pct + '%';
  document.querySelectorAll('.icon-preview svg').forEach(s => {
    s.style.width = pct + '%';
    s.style.height = pct + '%';
  });
});

// ═══════════════════════════════════════════════════════════════
// Downloads
// ═══════════════════════════════════════════════════════════════

function getIconName(i) {
  return (iconNames[i] || 'icon-' + (i + 1)).replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Single SVG
function copySingleSvg(i) {
  navigator.clipboard.writeText(tracedSvgs[i]);
  showToast('SVG copied!');
}

function downloadSingleSvg(i) {
  const blob = new Blob([tracedSvgs[i]], { type: 'image/svg+xml' });
  triggerDownload(blob, getIconName(i) + '.svg');
}

// Single PNG
function downloadSinglePng(i) {
  svgToPngBlob(tracedSvgs[i], 512, 512).then(blob => {
    triggerDownload(blob, getIconName(i) + '.png');
  });
}

// Copy All
function copyAllSvgs() {
  navigator.clipboard.writeText(tracedSvgs.join('\n\n'));
  showToast('All SVGs copied!');
}

// Bulk SVG zip
async function downloadAllSvgs() {
  if (typeof JSZip === 'undefined') { showToast('JSZip not loaded'); return; }
  const zip = new JSZip();
  tracedSvgs.forEach((svg, i) => {
    zip.file(getIconName(i) + '.svg', svg);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, 'icons-svg.zip');
}

// Bulk PNG zip
async function downloadAllPngs() {
  if (typeof JSZip === 'undefined') { showToast('JSZip not loaded'); return; }
  const zip = new JSZip();
  const promises = tracedSvgs.map((svg, i) =>
    svgToPngBlob(svg, 512, 512).then(blob => {
      zip.file(getIconName(i) + '.png', blob);
    })
  );
  await Promise.all(promises);
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, 'icons-png.zip');
}

// ── SVG to PNG ──
function svgToPngBlob(svgStr, w, h) {
  return new Promise((resolve, reject) => {
    let processedSvg = svgStr;
    const parser = new DOMParser();
    const doc = parser.parseFromString(processedSvg, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (svgEl) {
      if (!svgEl.getAttribute('viewBox') && svgEl.getAttribute('width') && svgEl.getAttribute('height')) {
        svgEl.setAttribute('viewBox', '0 0 ' + svgEl.getAttribute('width') + ' ' + svgEl.getAttribute('height'));
      }
      svgEl.setAttribute('width', w);
      svgEl.setAttribute('height', h);
      if (!svgEl.getAttribute('xmlns')) svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      processedSvg = new XMLSerializer().serializeToString(svgEl);
    }

    const blob = new Blob([processedSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => resolve(b), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to render SVG'));
    };
    img.src = url;
  });
}

function triggerDownload(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}
