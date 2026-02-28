// ── Toolbox ──
const toolbox = document.getElementById('toolbox');
const modeBtnEl = document.getElementById('modeBtn');
const sizeSlider = document.getElementById('sizeSlider');
const sizeValueEl = document.getElementById('sizeValue');
let lightMode = false;

function toggleMode() {
  lightMode = !lightMode;
  modeBtnEl.innerHTML = lightMode ? '&#9790; Dark' : '&#9788; Light';
  modeBtnEl.classList.toggle('active', lightMode);
  document.querySelectorAll('.svg-preview').forEach(p => p.classList.toggle('light', lightMode));
}

sizeSlider.addEventListener('input', () => {
  const pct = sizeSlider.value;
  sizeValueEl.textContent = pct + '%';
  document.querySelectorAll('.svg-preview svg').forEach(s => { s.style.width = pct + '%'; });
});

// ── Timer helper ──
function createTimer(el) {
  let iv = null, t0 = 0;
  return {
    start() {
      t0 = Date.now();
      clearInterval(iv);
      iv = setInterval(() => {
        el.innerHTML = '<span class="timer">' + ((Date.now()-t0)/1000).toFixed(1) + 's</span> waiting...';
      }, 100);
    },
    stop() { clearInterval(iv); iv = null; },
    elapsed() { return ((Date.now()-t0)/1000).toFixed(1); }
  };
}

// ── Shared state ──
let generatedImages = [];
let croppedIcons = [];
let tracedSvgs = [];
let iconNames = [];
let parsedSpec = null;

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// ═══════════════════════════════════
// STEP 1 — Generate Brief
// ═══════════════════════════════════
const briefPrompt = document.getElementById('briefPrompt');
const briefOutput = document.getElementById('briefOutput');
const briefStatus = document.getElementById('briefStatus');
const briefSend = document.getElementById('briefSend');
const briefModel = document.getElementById('briefModel');
const briefStyle = document.getElementById('briefStyle');
const briefIconCount = document.getElementById('briefIconCount');
const briefForward = document.getElementById('briefForward');
const briefTimer = createTimer(briefStatus);
let briefCtrl = null;
let briefText = '';

briefPrompt.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runBrief(); }
});

const STYLE_PREFIX = 'Icon style family should be: ';
const styleRegex = new RegExp('\\n?' + STYLE_PREFIX + '.*$');
const COUNT_PREFIX = 'Number of icons: ';
const countRegex = new RegExp('\\n?' + COUNT_PREFIX + '\\d+');

function updatePromptLine(prefix, regex, value) {
  const newLine = '\n' + prefix + value;
  if (regex.test(briefPrompt.value)) {
    briefPrompt.value = briefPrompt.value.replace(regex, newLine);
  } else if (briefPrompt.value.trim()) {
    briefPrompt.value += newLine;
  }
}

briefStyle.addEventListener('change', () => {
  updatePromptLine(STYLE_PREFIX, styleRegex, briefStyle.value);
});

briefIconCount.addEventListener('change', () => {
  const v = Math.max(4, Math.min(27, parseInt(briefIconCount.value) || 9));
  briefIconCount.value = v;
  updatePromptLine(COUNT_PREFIX, countRegex, v);
});

async function runBrief() {
  if (!styleRegex.test(briefPrompt.value) && briefPrompt.value.trim()) {
    briefPrompt.value += '\n' + STYLE_PREFIX + briefStyle.value;
  }
  if (!countRegex.test(briefPrompt.value) && briefPrompt.value.trim()) {
    briefPrompt.value += '\n' + COUNT_PREFIX + briefIconCount.value;
  }
  const prompt = briefPrompt.value.trim();
  if (!prompt) return;
  if (briefCtrl) briefCtrl.abort();
  briefCtrl = new AbortController();

  briefSend.disabled = true;
  briefSend.textContent = 'Generating...';
  briefOutput.className = 'output-card visible';
  briefOutput.innerHTML = '<div class="loading"><div class="spinner"></div>Thinking...</div>';
  briefForward.style.display = 'none';
  briefTimer.start();

  try {
    const res = await fetch('/api/pipeline/brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model: briefModel.value }),
      signal: briefCtrl.signal,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);

    briefTimer.stop();
    briefText = data.text || '(empty)';
    briefOutput.className = 'output-card visible';

    try {
      parsedSpec = JSON.parse(briefText);
      iconNames = (parsedSpec.icons || []).map(ic => ic.name);

      let html = '<div style="margin-bottom:8px"><strong>Style:</strong> '
        + (parsedSpec.style ? [parsedSpec.style.family, parsedSpec.style.size, parsedSpec.style.stroke, parsedSpec.style.colors].filter(Boolean).join(' \u00b7 ') : '\u2014')
        + '</div><ol style="margin:0;padding-left:20px">';
      (parsedSpec.icons || []).forEach(ic => {
        html += '<li><strong>' + ic.name + '</strong> \u2014 ' + ic.description + '</li>';
      });
      html += '</ol>';
      briefOutput.innerHTML = html;
    } catch (_) {
      parsedSpec = null;
      iconNames = [];
      briefOutput.textContent = briefText;
    }

    const cp = document.createElement('button');
    cp.className = 'copy-btn';
    cp.textContent = 'Copy JSON';
    cp.addEventListener('click', () => {
      navigator.clipboard.writeText(briefText);
      cp.textContent = 'Copied!';
      setTimeout(() => cp.textContent = 'Copy JSON', 1500);
    });
    briefOutput.prepend(cp);

    briefForward.style.display = 'inline-block';
    briefStatus.innerHTML = 'Completed in <span class="timer">' + data.elapsed + 's</span>';
  } catch (e) {
    if (e.name === 'AbortError') return;
    briefTimer.stop();
    briefOutput.className = 'output-card visible error';
    briefOutput.textContent = e.message;
    briefStatus.textContent = '';
  } finally {
    briefSend.disabled = false;
    briefSend.textContent = 'Generate Brief';
    briefCtrl = null;
  }
}

function forwardToImageGen() {
  imageGenPrompt.value = briefText;
  imageGenPrompt.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ═══════════════════════════════════
// STEP 2 — Generate Icon Grid
// ═══════════════════════════════════
const imageGenPrompt = document.getElementById('imageGenPrompt');
const imageGenImageOutput = document.getElementById('imageGenImageOutput');
const imageGenOutput = document.getElementById('imageGenOutput');
const imageGenStatus = document.getElementById('imageGenStatus');
const imageGenSend = document.getElementById('imageGenSend');
const imageGenModel = document.getElementById('imageGenModel');
const imageGenForward = document.getElementById('imageGenForward');
const imageGenTimer = createTimer(imageGenStatus);
let imageGenCtrl = null;

imageGenPrompt.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runImageGen(); }
});

async function runImageGen() {
  const brief = imageGenPrompt.value.trim();
  if (!brief) return;
  if (imageGenCtrl) imageGenCtrl.abort();
  imageGenCtrl = new AbortController();

  // Determine batches: chunk parsedSpec.icons into groups of 9, or fall back to a single batch
  let batches;
  if (parsedSpec && parsedSpec.icons && parsedSpec.icons.length > 0) {
    batches = chunkArray(parsedSpec.icons, 9);
  } else {
    batches = [null]; // single batch using the raw brief text
  }

  const totalBatches = batches.length;
  generatedImages = [];

  imageGenSend.disabled = true;
  imageGenSend.textContent = 'Generating...';
  imageGenImageOutput.className = 'image-output';
  imageGenImageOutput.innerHTML = '';
  imageGenOutput.className = 'output-card visible';
  imageGenForward.style.display = 'none';
  imageGenTimer.start();

  try {
    for (let b = 0; b < totalBatches; b++) {
      const label = totalBatches > 1
        ? 'Generating grid ' + (b + 1) + ' of ' + totalBatches + '...'
        : 'Generating image...';
      imageGenOutput.innerHTML = '<div class="loading"><div class="spinner"></div>' + label + '</div>';

      let batchPayload;
      if (batches[b]) {
        const specWithBatch = Object.assign({}, parsedSpec, { icons: batches[b] });
        batchPayload = JSON.stringify(specWithBatch, null, 2);
      }
      const batchPrompt = batchPayload
        ? IMAGE_GEN_PROMPT + batchPayload + IMAGE_GEN_SUFFIX
        : IMAGE_GEN_PROMPT + brief + IMAGE_GEN_SUFFIX;

      const reqBody = { prompt: batchPrompt, model: imageGenModel.value };
      if (b > 0 && generatedImages.length > 0) {
        reqBody.reference_image = generatedImages[0];
      }

      const res = await fetch('/api/pipeline/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
        signal: imageGenCtrl.signal,
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);

      if (data.image) generatedImages.push(data.image);
    }

    imageGenTimer.stop();

    imageGenOutput.className = 'output-card';
    imageGenOutput.innerHTML = '';

    imageGenImageOutput.innerHTML = '';
    generatedImages.forEach((src, i) => {
      const img = document.createElement('img');
      img.src = src;
      if (totalBatches > 1) img.title = 'Grid ' + (i + 1) + ' of ' + totalBatches;
      imageGenImageOutput.appendChild(img);
    });
    imageGenImageOutput.className = 'image-output visible';

    imageGenForward.style.display = 'inline-block';
    const batchLabel = totalBatches > 1 ? totalBatches + ' grids generated' : 'Completed';
    imageGenStatus.innerHTML = batchLabel + ' in <span class="timer">' + imageGenTimer.elapsed() + 's</span>';
  } catch (e) {
    if (e.name === 'AbortError') return;
    imageGenTimer.stop();
    imageGenOutput.className = 'output-card visible error';
    imageGenOutput.textContent = e.message;
    imageGenStatus.textContent = '';
  } finally {
    imageGenSend.disabled = false;
    imageGenSend.textContent = 'Generate Image';
    imageGenCtrl = null;
  }
}

// ═══════════════════════════════════
// STEP 3 — Crop Icons (deterministic)
// ═══════════════════════════════════
const cropOutput = document.getElementById('cropOutput');
const cropGrid = document.getElementById('cropGrid');
const cropStatus = document.getElementById('cropStatus');
const cropForward = document.getElementById('cropForward');
const cropTimer = createTimer(cropStatus);

async function runCrop() {
  if (!generatedImages.length) return;
  croppedIcons = [];
  tracedSvgs = [];

  cropOutput.className = 'output-card visible';
  cropOutput.innerHTML = '<div class="loading"><div class="spinner"></div>Cropping ' + generatedImages.length + ' grid(s)...</div>';
  cropGrid.style.display = 'none';
  cropGrid.innerHTML = '';
  cropForward.style.display = 'none';
  cropTimer.start();

  try {
    const results = await Promise.all(generatedImages.map(imgData =>
      fetch('/api/pipeline/crop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: imgData }),
      }).then(r => r.json()).then(d => {
        if (d.error) throw new Error(d.error);
        return d.icons;
      })
    ));

    cropTimer.stop();
    croppedIcons = results.flat();

    cropOutput.className = 'output-card';
    cropOutput.innerHTML = '';

    cropGrid.innerHTML = '';
    croppedIcons.forEach((src, i) => {
      const cell = document.createElement('div');
      cell.className = 'icon-grid-cell';
      cell.innerHTML = '<span class="cell-label">' + (i + 1) + '</span>'
        + '<img src="' + src + '">';
      cropGrid.appendChild(cell);
    });
    cropGrid.style.display = 'grid';

    cropForward.style.display = 'inline-block';
    cropStatus.innerHTML = croppedIcons.length + ' cells cropped in <span class="timer">' + cropTimer.elapsed() + 's</span>';
  } catch (e) {
    cropTimer.stop();
    cropOutput.className = 'output-card visible error';
    cropOutput.textContent = e.message;
    cropStatus.textContent = '';
  }
}

// ═══════════════════════════════════
// STEP 4 — Trace Icons (deterministic)
// ═══════════════════════════════════
const traceOutput = document.getElementById('traceOutput');
const traceGrid = document.getElementById('traceGrid');
const traceStatus = document.getElementById('traceStatus');
const traceActions = document.getElementById('traceActions');
const traceShowAll = document.getElementById('traceShowAll');
const traceAllCode = document.getElementById('traceAllCode');
const traceTimer = createTimer(traceStatus);

function getAllSvgText() {
  return tracedSvgs.join('\n\n');
}

function toggleAllCode() {
  traceAllCode.classList.toggle('hidden');
  if (!traceAllCode.classList.contains('hidden')) {
    traceAllCode.textContent = getAllSvgText();
    traceShowAll.textContent = 'Hide All Code';
  } else {
    traceShowAll.textContent = 'Show All Code';
  }
}

function copyAllSvgs() {
  navigator.clipboard.writeText(getAllSvgText());
  const btn = document.getElementById('traceCopyAll');
  btn.textContent = 'Copied!';
  setTimeout(() => btn.textContent = 'Copy All SVGs', 1500);
}

async function runTrace() {
  if (!croppedIcons.length) return;
  tracedSvgs = [];

  traceOutput.className = 'output-card visible';
  traceOutput.innerHTML = '<div class="loading"><div class="spinner"></div>Tracing ' + croppedIcons.length + ' icons...</div>';
  traceGrid.style.display = 'none';
  traceGrid.innerHTML = '';
  traceActions.style.display = 'none';
  traceAllCode.classList.add('hidden');
  traceShowAll.textContent = 'Show All Code';
  traceTimer.start();

  try {
    const res = await fetch('/api/pipeline/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icons: croppedIcons, names: iconNames }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);

    traceTimer.stop();
    tracedSvgs = data.svgs;
    if (data.names) iconNames = data.names;
    const keptIndices = data.indices || data.svgs.map((_, i) => i);

    traceOutput.className = 'output-card';
    traceOutput.innerHTML = '';

    traceGrid.innerHTML = '';
    data.svgs.forEach((svg, i) => {
      const row = document.createElement('div');
      row.className = 'trace-row';
      row.style.position = 'relative';

      const top = document.createElement('div');
      top.className = 'trace-row-top';

      const ref = document.createElement('div');
      ref.className = 'trace-row-ref';
      const refIdx = keptIndices[i] !== undefined ? keptIndices[i] : i;
      ref.innerHTML = '<img src="' + (croppedIcons[refIdx] || '') + '">';

      const preview = document.createElement('div');
      preview.className = 'trace-row-svg svg-preview';
      if (lightMode) preview.classList.add('light');
      preview.innerHTML = svg;
      const svgEl = preview.querySelector('svg');
      if (svgEl) svgEl.style.width = sizeSlider.value + '%';

      top.appendChild(ref);
      top.appendChild(preview);
      row.appendChild(top);

      const num = document.createElement('span');
      num.className = 'trace-row-num';
      num.textContent = (i + 1);
      row.appendChild(num);

      const actions = document.createElement('div');
      actions.className = 'svg-actions';
      const togBtn = document.createElement('button');
      togBtn.textContent = 'Show Code';
      const cpBtn = document.createElement('button');
      cpBtn.textContent = 'Copy SVG';
      actions.appendChild(togBtn);
      actions.appendChild(cpBtn);
      row.appendChild(actions);

      const code = document.createElement('pre');
      code.className = 'svg-code hidden';
      code.textContent = svg;
      row.appendChild(code);

      togBtn.addEventListener('click', () => {
        code.classList.toggle('hidden');
        togBtn.textContent = code.classList.contains('hidden') ? 'Show Code' : 'Hide Code';
      });
      cpBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(svg);
        cpBtn.textContent = 'Copied!';
        setTimeout(() => cpBtn.textContent = 'Copy SVG', 1500);
      });

      traceGrid.appendChild(row);
    });
    traceGrid.style.display = 'flex';
    traceActions.style.display = 'flex';
    toolbox.classList.add('visible');

    traceStatus.innerHTML = data.svgs.length + ' icons traced in <span class="timer">' + data.elapsed + 's</span>';
  } catch (e) {
    traceTimer.stop();
    traceOutput.className = 'output-card visible error';
    traceOutput.textContent = e.message;
    traceStatus.textContent = '';
  }
}

// ═══════════════════════════════════
// Mockup Modal
// ═══════════════════════════════════
const mockupOverlay = document.getElementById('mockupOverlay');

function openMockup() {
  if (!tracedSvgs.length) return;

  // Nav icons — first 3 SVGs
  for (let i = 0; i < 3; i++) {
    const el = document.getElementById('mockupNavIcon' + i);
    if (el) el.innerHTML = tracedSvgs[i] || '';
  }

  // Feature cards — dynamically generated from all traced SVGs
  const featuresContainer = document.querySelector('.mockup-features');
  featuresContainer.innerHTML = '';
  const cols = tracedSvgs.length <= 3 ? tracedSvgs.length : tracedSvgs.length <= 4 ? 2 : 3;
  featuresContainer.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';

  tracedSvgs.forEach((svg, i) => {
    const card = document.createElement('div');
    card.className = 'mockup-feature';
    card.innerHTML =
      '<div class="mockup-feature-icon">' + svg + '</div>' +
      '<div class="mockup-feature-label">' + (iconNames[i] || 'Feature') + '</div>' +
      '<div class="mockup-feature-desc"></div>' +
      '<div class="mockup-feature-desc2"></div>';
    featuresContainer.appendChild(card);
  });

  // Re-apply dark mode if active
  if (mockupDark) {
    document.querySelector('.mockup-page').classList.add('mockup-dark');
  }

  mockupOverlay.classList.add('visible');
}

function closeMockup() {
  mockupOverlay.classList.remove('visible');
}

let mockupDark = false;
function toggleMockupDark() {
  mockupDark = !mockupDark;
  document.querySelector('.mockup-page').classList.toggle('mockup-dark', mockupDark);
  document.getElementById('mockupDarkBtn').classList.toggle('active', mockupDark);
  document.getElementById('mockupDarkBtn').innerHTML = mockupDark ? '&#9788;' : '&#9790;';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && mockupOverlay.classList.contains('visible')) closeMockup();
});
