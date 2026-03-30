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
  document.querySelectorAll('.svg-preview svg').forEach(s => { s.style.width = pct + '%'; s.style.maxWidth = pct + '%'; });
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
let isColorTrace = false;
let parsedSpec = null;
let pipeRefImageData = null;

// ── Reference image ──
const pipeRefFileInput = document.getElementById('pipeRefFileInput');
const pipeRefPreview = document.getElementById('pipeRefPreview');
const pipeRefThumb = document.getElementById('pipeRefThumb');
const pipeAttachBtn = document.getElementById('pipeAttachBtn');

const imageGenRefBadge = document.getElementById('imageGenRefBadge');
const imageGenRefThumb = document.getElementById('imageGenRefThumb');

function syncRefBadge() {
  if (pipeRefImageData) {
    imageGenRefThumb.src = pipeRefImageData;
    imageGenRefBadge.classList.remove('hidden');
  } else {
    imageGenRefBadge.classList.add('hidden');
    imageGenRefThumb.src = '';
  }
}

function setPipeRef(dataUrl) {
  pipeRefImageData = dataUrl;
  pipeRefThumb.src = dataUrl;
  pipeRefPreview.classList.remove('hidden');
  pipeAttachBtn.classList.add('has-ref');
  syncRefBadge();
}

function clearPipeRef() {
  pipeRefImageData = null;
  pipeRefThumb.src = '';
  pipeRefPreview.classList.add('hidden');
  pipeAttachBtn.classList.remove('has-ref');
  syncRefBadge();
}

function loadPipeRefFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (file.type === 'image/svg+xml') {
    const reader = new FileReader();
    reader.onload = () => rasterizePipeSvg(reader.result);
    reader.readAsDataURL(file);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => setPipeRef(reader.result);
  reader.readAsDataURL(file);
}

function rasterizePipeSvg(svgDataUrl) {
  const img = new Image();
  img.onload = () => {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    setPipeRef(canvas.toDataURL('image/png'));
  };
  img.src = svgDataUrl;
}

pipeAttachBtn.addEventListener('click', () => pipeRefFileInput.click());
pipeRefThumb.addEventListener('click', () => pipeRefFileInput.click());

pipeRefFileInput.addEventListener('change', () => {
  if (pipeRefFileInput.files[0]) loadPipeRefFile(pipeRefFileInput.files[0]);
  pipeRefFileInput.value = '';
});

document.getElementById('pipeRefRemove').addEventListener('click', clearPipeRef);
document.getElementById('imageGenRefClear').addEventListener('click', clearPipeRef);

// ── Potrace tuning panel ──
const potraceTuning = document.getElementById('potraceTuning');
const tracerModeSelect = document.getElementById('tracerMode');
const ptSliders = {
  threshold:     { slider: document.getElementById('sliderThreshold'), label: document.getElementById('valThreshold') },
  turdsize:      { slider: document.getElementById('sliderTurd'),      label: document.getElementById('valTurd') },
  alphamax:      { slider: document.getElementById('sliderAlpha'),     label: document.getElementById('valAlpha') },
  opttolerance:  { slider: document.getElementById('sliderOptTol'),    label: document.getElementById('valOptTol') },
  scale:         { slider: document.getElementById('sliderScale'),     label: document.getElementById('valScale') },
};
const ptInvertCheck = document.getElementById('checkInvert');

Object.values(ptSliders).forEach(({ slider, label }) => {
  slider.addEventListener('input', () => { label.textContent = slider.value; });
});

function getPotraceParams() {
  return {
    threshold:    Number(ptSliders.threshold.slider.value),
    turdsize:     Number(ptSliders.turdsize.slider.value),
    alphamax:     Number(ptSliders.alphamax.slider.value),
    opttolerance: Number(ptSliders.opttolerance.slider.value),
    scale:        Number(ptSliders.scale.slider.value),
    invert:       ptInvertCheck.checked,
  };
}

// ── VTracer tuning panel ──
const vtracerTuning = document.getElementById('vtracerTuning');
const vtSliders = {
  filter_speckle: { slider: document.getElementById('sliderSpeckle'), label: document.getElementById('valSpeckle') },
  color_precision: { slider: document.getElementById('sliderColorPrec'), label: document.getElementById('valColorPrec') },
  layer_difference: { slider: document.getElementById('sliderLayerDiff'), label: document.getElementById('valLayerDiff') },
  corner_threshold: { slider: document.getElementById('sliderCorner'), label: document.getElementById('valCorner') },
  length_threshold: { slider: document.getElementById('sliderLength'), label: document.getElementById('valLength') },
  splice_threshold: { slider: document.getElementById('sliderSplice'), label: document.getElementById('valSplice') },
  max_iterations: { slider: document.getElementById('sliderMaxIter'), label: document.getElementById('valMaxIter') },
  path_precision: { slider: document.getElementById('sliderPathPrec'), label: document.getElementById('valPathPrec') },
};
const vtModeSelect = document.getElementById('selectMode');
const vtHierarchicalSelect = document.getElementById('selectHierarchical');

Object.values(vtSliders).forEach(({ slider, label }) => {
  slider.addEventListener('input', () => { label.textContent = slider.value; });
});

tracerModeSelect.addEventListener('change', () => {
  const isVtracer = tracerModeSelect.value === 'vtracer';
  vtracerTuning.style.display = isVtracer ? 'grid' : 'none';
  potraceTuning.style.display = isVtracer ? 'none' : 'grid';
});

function getVtracerParams() {
  return {
    filter_speckle: Number(vtSliders.filter_speckle.slider.value),
    color_precision: Number(vtSliders.color_precision.slider.value),
    layer_difference: Number(vtSliders.layer_difference.slider.value),
    corner_threshold: Number(vtSliders.corner_threshold.slider.value),
    length_threshold: Number(vtSliders.length_threshold.slider.value),
    splice_threshold: Number(vtSliders.splice_threshold.slider.value),
    max_iterations: Number(vtSliders.max_iterations.slider.value),
    path_precision: Number(vtSliders.path_precision.slider.value),
    mode: vtModeSelect.value,
    hierarchical: vtHierarchicalSelect.value,
  };
}

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
let pipelineStartTime = null;

briefPrompt.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runBrief(); }
});

document.querySelectorAll('.quick-prompt').forEach(btn => {
  btn.addEventListener('click', () => {
    briefPrompt.value = btn.dataset.prompt;
    briefPrompt.focus();
  });
});

const briefColorMode = document.getElementById('briefColorMode');

const STYLE_PREFIX = 'Icon style family should be: ';
const styleRegex = new RegExp('\\n?' + STYLE_PREFIX + '.*$', 'm');
const COUNT_PREFIX = 'Number of icons: ';
const countRegex = new RegExp('\\n?' + COUNT_PREFIX + '\\d+.*$', 'm');
const COLOR_PREFIX = 'Icon color mode: ';
const colorRegex = new RegExp('\\n?' + COLOR_PREFIX + '.*$', 'm');

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

function isBlackAndWhite() { return briefColorMode.value === 'bw'; }

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

briefColorMode.addEventListener('change', () => {
  updatePromptLine(COLOR_PREFIX, colorRegex, COLOR_LABELS[briefColorMode.value] || briefColorMode.value);
  const tracerMode = document.getElementById('tracerMode');
  if (isBlackAndWhite()) {
    tracerMode.value = 'potrace';
  } else {
    tracerMode.value = 'vtracer';
  }
  tracerMode.dispatchEvent(new Event('change'));
});

async function runBrief() {
  pipelineStartTime = Date.now();
  if (!styleRegex.test(briefPrompt.value) && briefPrompt.value.trim()) {
    briefPrompt.value += '\n' + STYLE_PREFIX + briefStyle.value;
  }
  if (!countRegex.test(briefPrompt.value) && briefPrompt.value.trim()) {
    briefPrompt.value += '\n' + COUNT_PREFIX + briefIconCount.value;
  }
  if (!colorRegex.test(briefPrompt.value) && briefPrompt.value.trim()) {
    briefPrompt.value += '\n' + COLOR_PREFIX + (COLOR_LABELS[briefColorMode.value] || briefColorMode.value);
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
    const briefBody = { prompt, model: briefModel.value };
    if (pipeRefImageData) briefBody.reference_image = pipeRefImageData;
    const res = await fetch('/api/pipeline/brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(briefBody),
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
      const imgPromptBase = (b === 0 && pipeRefImageData) ? IMAGE_GEN_PROMPT_REF
        : isBlackAndWhite() ? IMAGE_GEN_PROMPT_BW : IMAGE_GEN_PROMPT_COLOR;
      const batchPrompt = batchPayload
        ? imgPromptBase + batchPayload + IMAGE_GEN_SUFFIX
        : imgPromptBase + brief + IMAGE_GEN_SUFFIX;

      const reqBody = { prompt: batchPrompt, model: imageGenModel.value };
      if (b === 0 && pipeRefImageData) {
        reqBody.reference_image = pipeRefImageData;
        reqBody.user_ref = true;
      } else if (b > 0 && generatedImages.length > 0) {
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

  const tracerMode = document.getElementById('tracerMode');
  isColorTrace = tracerMode.value === 'vtracer';

  traceOutput.className = 'output-card visible';
  traceOutput.innerHTML = '<div class="loading"><div class="spinner"></div>Tracing ' + croppedIcons.length + ' icons (' + tracerMode.value + ')...</div>';
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
      body: JSON.stringify(Object.assign(
        { icons: croppedIcons, names: iconNames, tracer: tracerMode.value },
        tracerMode.value === 'vtracer' ? { vtracer_params: getVtracerParams() } : { potrace_params: getPotraceParams() }
      )),
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
      if (isColorTrace) preview.classList.add('color-svg');
      preview.innerHTML = svg;
      const svgEl = preview.querySelector('svg');
      if (svgEl) {
        if (!svgEl.getAttribute('viewBox') && svgEl.getAttribute('width') && svgEl.getAttribute('height')) {
          svgEl.setAttribute('viewBox', '0 0 ' + svgEl.getAttribute('width') + ' ' + svgEl.getAttribute('height'));
        }
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
        svgEl.style.width = sizeSlider.value + '%';
      }

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
      const dlSvgBtn = document.createElement('button');
      dlSvgBtn.className = 'dl-btn';
      dlSvgBtn.textContent = '↓ SVG';
      dlSvgBtn.addEventListener('click', () => downloadSingleSvg(svg, i));
      const dlPngBtn = document.createElement('button');
      dlPngBtn.className = 'dl-btn';
      dlPngBtn.textContent = '↓ PNG';
      dlPngBtn.addEventListener('click', () => downloadSinglePng(svg, i));
      actions.appendChild(togBtn);
      actions.appendChild(cpBtn);
      actions.appendChild(dlSvgBtn);
      actions.appendChild(dlPngBtn);
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

    let statusMsg = data.svgs.length + ' icons traced in <span class="timer">' + data.elapsed + 's</span>';
    if (pipelineStartTime) {
      const totalSec = ((Date.now() - pipelineStartTime) / 1000).toFixed(1);
      statusMsg += ' &mdash; total pipeline: <span class="timer">' + totalSec + 's</span>';
    }
    traceStatus.innerHTML = statusMsg;
  } catch (e) {
    traceTimer.stop();
    traceOutput.className = 'output-card visible error';
    traceOutput.textContent = e.message;
    traceStatus.textContent = '';
  }
}

// ═══════════════════════════════════
// Downloads
// ═══════════════════════════════════
function iconFileName(idx, ext) {
  const name = (iconNames[idx] || 'icon-' + (idx + 1))
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return name + '.' + ext;
}

function downloadSingleSvg(svgCode, idx) {
  const blob = new Blob([svgCode], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = iconFileName(idx, 'svg');
  a.click();
  URL.revokeObjectURL(a.href);
}

function svgToPngBlob(svgCode, size) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgCode], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
      const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      canvas.toBlob(b => { URL.revokeObjectURL(url); resolve(b); }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('PNG render failed')); };
    img.src = url;
  });
}

async function downloadSinglePng(svgCode, idx) {
  const blob = await svgToPngBlob(svgCode, 512);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = iconFileName(idx, 'png');
  a.click();
  URL.revokeObjectURL(a.href);
}

async function downloadAllSvgsZip() {
  if (!tracedSvgs.length) return;
  const zip = new JSZip();
  tracedSvgs.forEach((svg, i) => zip.file(iconFileName(i, 'svg'), svg));
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'icons-svg.zip';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function downloadAllPngsZip() {
  if (!tracedSvgs.length) return;
  const zip = new JSZip();
  await Promise.all(tracedSvgs.map(async (svg, i) => {
    const blob = await svgToPngBlob(svg, 512);
    zip.file(iconFileName(i, 'png'), blob);
  }));
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'icons-png.zip';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ═══════════════════════════════════
// Mockup Modal
// ═══════════════════════════════════
const mockupOverlay = document.getElementById('mockupOverlay');

function openMockup() {
  if (!tracedSvgs.length) return;

  function fixSvgViewBox(container) {
    const s = container.querySelector('svg');
    if (!s) return;
    if (!s.getAttribute('viewBox') && s.getAttribute('width') && s.getAttribute('height')) {
      s.setAttribute('viewBox', '0 0 ' + s.getAttribute('width') + ' ' + s.getAttribute('height'));
    }
    s.removeAttribute('width');
    s.removeAttribute('height');
  }

  // Nav icons — first 3 SVGs
  for (let i = 0; i < 3; i++) {
    const el = document.getElementById('mockupNavIcon' + i);
    if (el) {
      el.innerHTML = tracedSvgs[i] || '';
      el.classList.toggle('color-svg', isColorTrace);
      fixSvgViewBox(el);
    }
  }

  // Feature cards — dynamically generated from all traced SVGs
  const featuresContainer = document.querySelector('.mockup-features');
  featuresContainer.innerHTML = '';
  const cols = tracedSvgs.length <= 3 ? tracedSvgs.length : tracedSvgs.length <= 4 ? 2 : 3;
  featuresContainer.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';

  tracedSvgs.forEach((svg, i) => {
    const card = document.createElement('div');
    card.className = 'mockup-feature';
    const colorClass = isColorTrace ? ' color-svg' : '';
    card.innerHTML =
      '<div class="mockup-feature-icon' + colorClass + '">' + svg + '</div>' +
      '<div class="mockup-feature-label">' + (iconNames[i] || 'Feature') + '</div>' +
      '<div class="mockup-feature-desc"></div>' +
      '<div class="mockup-feature-desc2"></div>';
    fixSvgViewBox(card.querySelector('.mockup-feature-icon'));
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
