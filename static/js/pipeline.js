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
// STEP 1 — Brief
// ═══════════════════════════════════
const s1Prompt = document.getElementById('s1Prompt');
const s1Output = document.getElementById('s1Output');
const s1Status = document.getElementById('s1Status');
const s1Send = document.getElementById('s1Send');
const s1Model = document.getElementById('s1Model');
const s1Forward = document.getElementById('s1Forward');
const s1Timer = createTimer(s1Status);
let s1Ctrl = null;
let s1Text = '';

s1Prompt.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runStep1(); }
});

async function runStep1() {
  const prompt = s1Prompt.value.trim();
  if (!prompt) return;
  if (s1Ctrl) s1Ctrl.abort();
  s1Ctrl = new AbortController();

  s1Send.disabled = true;
  s1Send.textContent = 'Generating...';
  s1Output.className = 'output-card visible';
  s1Output.innerHTML = '<div class="loading"><div class="spinner"></div>Thinking...</div>';
  s1Forward.style.display = 'none';
  s1Timer.start();

  try {
    const res = await fetch('/api/pipeline/brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model: s1Model.value }),
      signal: s1Ctrl.signal,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);

    s1Timer.stop();
    s1Text = data.text || '(empty)';
    s1Output.className = 'output-card visible';

    try {
      parsedSpec = JSON.parse(s1Text);
      iconNames = (parsedSpec.icons || []).map(ic => ic.name);

      let html = '<div style="margin-bottom:8px"><strong>Style:</strong> '
        + (parsedSpec.style ? [parsedSpec.style.family, parsedSpec.style.size, parsedSpec.style.stroke, parsedSpec.style.colors].filter(Boolean).join(' \u00b7 ') : '\u2014')
        + '</div><ol style="margin:0;padding-left:20px">';
      (parsedSpec.icons || []).forEach(ic => {
        html += '<li><strong>' + ic.name + '</strong> \u2014 ' + ic.description + '</li>';
      });
      html += '</ol>';
      s1Output.innerHTML = html;
    } catch (_) {
      parsedSpec = null;
      iconNames = [];
      s1Output.textContent = s1Text;
    }

    const cp = document.createElement('button');
    cp.className = 'copy-btn';
    cp.textContent = 'Copy JSON';
    cp.addEventListener('click', () => {
      navigator.clipboard.writeText(s1Text);
      cp.textContent = 'Copied!';
      setTimeout(() => cp.textContent = 'Copy JSON', 1500);
    });
    s1Output.prepend(cp);

    s1Forward.style.display = 'inline-block';
    s1Status.innerHTML = 'Completed in <span class="timer">' + data.elapsed + 's</span>';
  } catch (e) {
    if (e.name === 'AbortError') return;
    s1Timer.stop();
    s1Output.className = 'output-card visible error';
    s1Output.textContent = e.message;
    s1Status.textContent = '';
  } finally {
    s1Send.disabled = false;
    s1Send.textContent = 'Generate Brief';
    s1Ctrl = null;
  }
}

function forwardToStep2() {
  document.getElementById('s2Prompt').value = s1Text;
  document.getElementById('s2Prompt').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ═══════════════════════════════════
// STEP 2 — Image Generation
// ═══════════════════════════════════
const s2Prompt = document.getElementById('s2Prompt');
const s2ImageOutput = document.getElementById('s2ImageOutput');
const s2Output = document.getElementById('s2Output');
const s2Status = document.getElementById('s2Status');
const s2Send = document.getElementById('s2Send');
const s2Model = document.getElementById('s2Model');
const s2Forward = document.getElementById('s2Forward');
const s2Timer = createTimer(s2Status);
let s2Ctrl = null;

s2Prompt.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runStep2(); }
});

async function runStep2() {
  const brief = s2Prompt.value.trim();
  if (!brief) return;
  if (s2Ctrl) s2Ctrl.abort();
  s2Ctrl = new AbortController();

  const prompt = IMAGE_GEN_PROMPT + brief + IMAGE_GEN_SUFFIX;

  s2Send.disabled = true;
  s2Send.textContent = 'Generating...';
  s2ImageOutput.className = 'image-output';
  s2ImageOutput.innerHTML = '';
  s2Output.className = 'output-card visible';
  s2Output.innerHTML = '<div class="loading"><div class="spinner"></div>Generating image...</div>';
  s2Forward.style.display = 'none';
  s2Timer.start();

  try {
    const res = await fetch('/api/pipeline/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model: s2Model.value }),
      signal: s2Ctrl.signal,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);

    s2Timer.stop();
    generatedImageData = data.image;

    s2Output.className = 'output-card';
    s2Output.innerHTML = '';
    if (data.text) {
      s2Output.className = 'output-card visible';
      s2Output.textContent = data.text;
    }

    const img = document.createElement('img');
    img.src = data.image;
    s2ImageOutput.innerHTML = '';
    s2ImageOutput.appendChild(img);
    s2ImageOutput.className = 'image-output visible';

    s2Forward.style.display = 'inline-block';
    s2Status.innerHTML = 'Completed in <span class="timer">' + data.elapsed + 's</span>';
  } catch (e) {
    if (e.name === 'AbortError') return;
    s2Timer.stop();
    s2Output.className = 'output-card visible error';
    s2Output.textContent = e.message;
    s2Status.textContent = '';
  } finally {
    s2Send.disabled = false;
    s2Send.textContent = 'Generate Image';
    s2Ctrl = null;
  }
}

// ═══════════════════════════════════
// STEP 2b — Crop (deterministic)
// ═══════════════════════════════════
const s2bOutput = document.getElementById('s2bOutput');
const s2bGrid = document.getElementById('s2bGrid');
const s2bStatus = document.getElementById('s2bStatus');
const s2bForward = document.getElementById('s2bForward');
const s2bTimer = createTimer(s2bStatus);

async function runStep2b() {
  if (!generatedImageData) return;
  croppedIcons = [];
  tracedSvgs = [];

  s2bOutput.className = 'output-card visible';
  s2bOutput.innerHTML = '<div class="loading"><div class="spinner"></div>Cropping icons...</div>';
  s2bGrid.style.display = 'none';
  s2bGrid.innerHTML = '';
  s2bForward.style.display = 'none';
  s2bTimer.start();

  try {
    const res = await fetch('/api/pipeline/crop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_data: generatedImageData }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);

    s2bTimer.stop();
    croppedIcons = data.icons;

    s2bOutput.className = 'output-card';
    s2bOutput.innerHTML = '';

    s2bGrid.innerHTML = '';
    data.icons.forEach((src, i) => {
      const cell = document.createElement('div');
      cell.className = 'icon-grid-cell';
      cell.innerHTML = '<span class="cell-label">' + (i + 1) + '</span>'
        + '<img src="' + src + '">';
      s2bGrid.appendChild(cell);
    });
    s2bGrid.style.display = 'grid';

    s2bForward.style.display = 'inline-block';
    s2bStatus.innerHTML = 'Cropped in <span class="timer">' + data.elapsed + 's</span>';
  } catch (e) {
    s2bTimer.stop();
    s2bOutput.className = 'output-card visible error';
    s2bOutput.textContent = e.message;
    s2bStatus.textContent = '';
  }
}

// ═══════════════════════════════════
// STEP 2c — Trace (deterministic)
// ═══════════════════════════════════
const s2cOutput = document.getElementById('s2cOutput');
const s2cGrid = document.getElementById('s2cGrid');
const s2cStatus = document.getElementById('s2cStatus');
const s2cForward = document.getElementById('s2cForward');
const s2cTimer = createTimer(s2cStatus);

async function runStep2c() {
  if (!croppedIcons.length) return;
  tracedSvgs = [];

  s2cOutput.className = 'output-card visible';
  s2cOutput.innerHTML = '<div class="loading"><div class="spinner"></div>Tracing 9 icons...</div>';
  s2cGrid.style.display = 'none';
  s2cGrid.innerHTML = '';
  s2cForward.style.display = 'none';
  s2cTimer.start();

  try {
    const res = await fetch('/api/pipeline/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icons: croppedIcons, names: iconNames }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);

    s2cTimer.stop();
    tracedSvgs = data.svgs;

    s2cOutput.className = 'output-card';
    s2cOutput.innerHTML = '';

    s2cGrid.innerHTML = '';
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

      s2cGrid.appendChild(row);
    });
    s2cGrid.style.display = 'flex';
    toolbox.classList.add('visible');

    s2cForward.style.display = 'inline-block';
    s2cStatus.innerHTML = 'Traced in <span class="timer">' + data.elapsed + 's</span>';
  } catch (e) {
    s2cTimer.stop();
    s2cOutput.className = 'output-card visible error';
    s2cOutput.textContent = e.message;
    s2cStatus.textContent = '';
  }
}

function forwardToStep3() {
  if (!croppedIcons.length || !tracedSvgs.length) return;

  const grid = document.getElementById('s3Previews');
  grid.innerHTML = '';
  tracedSvgs.forEach((svg, i) => {
    const cell = document.createElement('div');
    cell.className = 'icon-grid-cell';
    const wrap = document.createElement('div');
    wrap.className = 'svg-wrap';
    wrap.innerHTML = svg || '';
    const svgEl = wrap.querySelector('svg');
    if (svgEl) { svgEl.style.width = '100%'; svgEl.style.height = 'auto'; }
    cell.innerHTML = '<span class="cell-label">' + (i + 1) + '</span>';
    cell.appendChild(wrap);
    grid.appendChild(cell);
  });
  grid.style.display = 'grid';
  document.getElementById('s3Prompt').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ═══════════════════════════════════
// STEP 3 — AI Clean & Polish
// ═══════════════════════════════════
const s3Prompt = document.getElementById('s3Prompt');
const s3Output = document.getElementById('s3Output');
const s3Status = document.getElementById('s3Status');
const s3Send = document.getElementById('s3Send');
const s3Model = document.getElementById('s3Model');
const s3Timer = createTimer(s3Status);
let s3Ctrl = null;

s3Prompt.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runStep3(); }
});

async function runStep3() {
  if (!croppedIcons.length || !tracedSvgs.length) {
    s3Output.className = 'output-card visible error';
    s3Output.textContent = 'Complete Steps 2b and 2c first (crop, then trace).';
    return;
  }
  if (s3Ctrl) s3Ctrl.abort();
  s3Ctrl = new AbortController();

  s3Send.disabled = true;
  s3Send.textContent = 'Cleaning...';
  s3Output.className = 'output-card visible';
  s3Output.innerHTML = '<div class="loading"><div class="spinner"></div>AI cleaning icons...</div>';
  s3Timer.start();

  try {
    const res = await fetch('/api/pipeline/convert-svg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        svgs: tracedSvgs,
        model: s3Model.value,
        prompt: s3Prompt.value.trim(),
      }),
      signal: s3Ctrl.signal,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);

    s3Timer.stop();
    renderSvgs(data.text || '');
    s3Status.innerHTML = 'Completed in <span class="timer">' + data.elapsed + 's</span>';
  } catch (e) {
    if (e.name === 'AbortError') return;
    s3Timer.stop();
    s3Output.className = 'output-card visible error';
    s3Output.textContent = e.message;
    s3Status.textContent = '';
  } finally {
    s3Send.disabled = false;
    s3Send.textContent = 'Clean Icons';
    s3Ctrl = null;
  }
}

function renderSvgs(rawText) {
  s3Output.innerHTML = '';
  s3Output.className = 'output-card visible';

  let text = rawText.replace(/```(?:svg|xml|html)?\s*\n?(<svg[\s\S]*?<\/svg>)\s*\n?```/gi, '$1');
  const re = /<svg[\s\S]*?<\/svg>/gi;
  let last = 0, m, hasSvg = false;

  while ((m = re.exec(text)) !== null) {
    hasSvg = true;
    const src = m[0];

    if (m.index > last) {
      const sp = document.createElement('span');
      sp.className = 'text-segment';
      sp.textContent = text.slice(last, m.index);
      s3Output.appendChild(sp);
    }

    const block = document.createElement('div');
    block.className = 'svg-block';

    const preview = document.createElement('div');
    preview.className = 'svg-preview';
    if (lightMode) preview.classList.add('light');
    preview.innerHTML = src;
    const svgEl = preview.querySelector('svg');
    if (svgEl) svgEl.style.width = sizeSlider.value + '%';
    block.appendChild(preview);

    const actions = document.createElement('div');
    actions.className = 'svg-actions';
    const togBtn = document.createElement('button');
    togBtn.textContent = 'Show Code';
    const cpBtn = document.createElement('button');
    cpBtn.textContent = 'Copy SVG';
    actions.appendChild(togBtn);
    actions.appendChild(cpBtn);
    block.appendChild(actions);

    const code = document.createElement('pre');
    code.className = 'svg-code hidden';
    code.textContent = src;
    block.appendChild(code);

    togBtn.addEventListener('click', () => {
      code.classList.toggle('hidden');
      togBtn.textContent = code.classList.contains('hidden') ? 'Show Code' : 'Hide Code';
    });
    cpBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(src);
      cpBtn.textContent = 'Copied!';
      setTimeout(() => cpBtn.textContent = 'Copy SVG', 1500);
    });

    s3Output.appendChild(block);
    last = m.index + m[0].length;
  }

  if (last < text.length) {
    const sp = document.createElement('span');
    sp.className = 'text-segment';
    sp.textContent = text.slice(last);
    s3Output.appendChild(sp);
  }

  if (hasSvg) { toolbox.classList.add('visible'); }
  else { toolbox.classList.remove('visible'); }

  if (!hasSvg && !text.trim()) { s3Output.textContent = '(empty response)'; }
}
