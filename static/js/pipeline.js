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
  let iv = null;
  return {
    start() {
      const t0 = Date.now();
      clearInterval(iv);
      iv = setInterval(() => {
        el.innerHTML = '<span class="timer">' + ((Date.now()-t0)/1000).toFixed(1) + 's</span> waiting...';
      }, 100);
    },
    stop() { clearInterval(iv); iv = null; }
  };
}

// ── Shared state ──
let generatedImageData = null;
let croppedIcons = [];
let tracedSvgs = [];
let iconNames = [];
let parsedSpec = null;

// ═══════════════════════════════════
// STEP 1 — Generate Brief
// ═══════════════════════════════════
const briefPrompt = document.getElementById('briefPrompt');
const briefOutput = document.getElementById('briefOutput');
const briefStatus = document.getElementById('briefStatus');
const briefSend = document.getElementById('briefSend');
const briefModel = document.getElementById('briefModel');
const briefForward = document.getElementById('briefForward');
const briefTimer = createTimer(briefStatus);
let briefCtrl = null;
let briefText = '';

briefPrompt.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runBrief(); }
});

async function runBrief() {
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

  const prompt = IMAGE_GEN_PROMPT + brief + IMAGE_GEN_SUFFIX;

  imageGenSend.disabled = true;
  imageGenSend.textContent = 'Generating...';
  imageGenImageOutput.className = 'image-output';
  imageGenImageOutput.innerHTML = '';
  imageGenOutput.className = 'output-card visible';
  imageGenOutput.innerHTML = '<div class="loading"><div class="spinner"></div>Generating image...</div>';
  imageGenForward.style.display = 'none';
  imageGenTimer.start();

  try {
    const res = await fetch('/api/pipeline/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model: imageGenModel.value }),
      signal: imageGenCtrl.signal,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);

    imageGenTimer.stop();
    generatedImageData = data.image;

    imageGenOutput.className = 'output-card';
    imageGenOutput.innerHTML = '';
    if (data.text) {
      imageGenOutput.className = 'output-card visible';
      imageGenOutput.textContent = data.text;
    }

    const img = document.createElement('img');
    img.src = data.image;
    imageGenImageOutput.innerHTML = '';
    imageGenImageOutput.appendChild(img);
    imageGenImageOutput.className = 'image-output visible';

    imageGenForward.style.display = 'inline-block';
    imageGenStatus.innerHTML = 'Completed in <span class="timer">' + data.elapsed + 's</span>';
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
  if (!generatedImageData) return;
  croppedIcons = [];
  tracedSvgs = [];

  cropOutput.className = 'output-card visible';
  cropOutput.innerHTML = '<div class="loading"><div class="spinner"></div>Cropping icons...</div>';
  cropGrid.style.display = 'none';
  cropGrid.innerHTML = '';
  cropForward.style.display = 'none';
  cropTimer.start();

  try {
    const res = await fetch('/api/pipeline/crop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_data: generatedImageData }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);

    cropTimer.stop();
    croppedIcons = data.icons;

    cropOutput.className = 'output-card';
    cropOutput.innerHTML = '';

    cropGrid.innerHTML = '';
    data.icons.forEach((src, i) => {
      const cell = document.createElement('div');
      cell.className = 'icon-grid-cell';
      cell.innerHTML = '<span class="cell-label">' + (i + 1) + '</span>'
        + '<img src="' + src + '">';
      cropGrid.appendChild(cell);
    });
    cropGrid.style.display = 'grid';

    cropForward.style.display = 'inline-block';
    cropStatus.innerHTML = 'Cropped in <span class="timer">' + data.elapsed + 's</span>';
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
  traceOutput.innerHTML = '<div class="loading"><div class="spinner"></div>Tracing 9 icons...</div>';
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
      ref.innerHTML = '<img src="' + croppedIcons[i] + '">';

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

    traceStatus.innerHTML = 'Traced in <span class="timer">' + data.elapsed + 's</span>';
  } catch (e) {
    traceTimer.stop();
    traceOutput.className = 'output-card visible error';
    traceOutput.textContent = e.message;
    traceStatus.textContent = '';
  }
}
