// ── Shared refs ──
const toolbox = document.getElementById('toolbox');
const modeBtnEl = document.getElementById('modeBtn');
const sizeSlider = document.getElementById('sizeSlider');
const sizeValueEl = document.getElementById('sizeValue');
let lightMode = false;

function toggleGlobalMode() {
  lightMode = !lightMode;
  modeBtnEl.textContent = lightMode ? '\u263E Dark' : '\u2600 Light';
  modeBtnEl.classList.toggle('active', lightMode);
  document.querySelectorAll('.svg-preview').forEach(p => {
    p.classList.toggle('light', lightMode);
  });
}

sizeSlider.addEventListener('input', () => {
  const pct = sizeSlider.value;
  sizeValueEl.textContent = pct + '%';
  document.querySelectorAll('.svg-preview svg').forEach(svg => {
    svg.style.width = pct + '%';
  });
});

// ── Timer helper ──
function createTimer(statusEl) {
  let interval = null;
  return {
    start() {
      const t0 = Date.now();
      clearInterval(interval);
      interval = setInterval(() => {
        const s = ((Date.now() - t0) / 1000).toFixed(1);
        statusEl.innerHTML = '<span class="timer">' + s + 's</span> waiting for response...';
      }, 100);
    },
    stop() { clearInterval(interval); interval = null; }
  };
}

// ── API call helper ──
async function callApi(prompt, model, mode, signal) {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model, mode }),
    signal,
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}

// ═══════════════════════════════════
// LEFT PANEL — Spec Generator
// ═══════════════════════════════════
const specPromptEl = document.getElementById('specPrompt');
const specOutputEl = document.getElementById('specOutput');
const specStatusEl = document.getElementById('specStatus');
const specSendBtn = document.getElementById('specSend');
const specModelEl = document.getElementById('specModel');
let specController = null;
const specTimer = createTimer(specStatusEl);

specPromptEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generateSpec(); }
});

async function generateSpec() {
  const prompt = specPromptEl.value.trim();
  if (!prompt) return;

  if (specController) specController.abort();
  specController = new AbortController();

  specSendBtn.disabled = true;
  specSendBtn.textContent = 'Generating...';
  specOutputEl.className = 'output-card visible';
  specOutputEl.innerHTML = '<div class="loading"><div class="spinner"></div>Thinking...</div>';
  specTimer.start();

  try {
    const data = await callApi(prompt, specModelEl.value, 'spec', specController.signal);
    specTimer.stop();

    const text = data.text || '(empty response)';
    specOutputEl.className = 'output-card visible';
    specOutputEl.textContent = text;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-output-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => copyBtn.textContent = 'Copy', 1500);
    });
    specOutputEl.prepend(copyBtn);

    specStatusEl.innerHTML = 'Completed in <span class="timer">' + data.elapsed + 's</span>';
  } catch (e) {
    if (e.name === 'AbortError') return;
    specTimer.stop();
    specOutputEl.className = 'output-card visible error';
    specOutputEl.textContent = e.message;
    specStatusEl.textContent = '';
  } finally {
    specSendBtn.disabled = false;
    specSendBtn.textContent = 'Send';
    specController = null;
  }
}

// ═══════════════════════════════════
// RIGHT PANEL — Icon Generator
// ═══════════════════════════════════
const iconsPromptEl = document.getElementById('iconsPrompt');
const iconsOutputEl = document.getElementById('iconsOutput');
const iconsStatusEl = document.getElementById('iconsStatus');
const iconsSendBtn = document.getElementById('iconsSend');
const iconsModelEl = document.getElementById('iconsModel');
let iconsController = null;
const iconsTimer = createTimer(iconsStatusEl);

iconsPromptEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generateIcons(); }
});

function renderSvgOutput(rawText) {
  iconsOutputEl.innerHTML = '';
  iconsOutputEl.className = 'output-card visible';

  let text = rawText.replace(/```(?:svg|xml|html)?\s*\n?(<svg[\s\S]*?<\/svg>)\s*\n?```/gi, '$1');

  const svgRegex = /<svg[\s\S]*?<\/svg>/gi;
  let lastIndex = 0;
  let match;
  let hasSvg = false;

  while ((match = svgRegex.exec(text)) !== null) {
    hasSvg = true;
    const svgSource = match[0];

    if (match.index > lastIndex) {
      const span = document.createElement('span');
      span.className = 'text-segment';
      span.textContent = text.slice(lastIndex, match.index);
      iconsOutputEl.appendChild(span);
    }

    const block = document.createElement('div');
    block.className = 'svg-block';

    const preview = document.createElement('div');
    preview.className = 'svg-preview';
    preview.innerHTML = svgSource;
    block.appendChild(preview);

    const actions = document.createElement('div');
    actions.className = 'svg-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = 'Show Code';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy SVG';

    actions.appendChild(toggleBtn);
    actions.appendChild(copyBtn);
    block.appendChild(actions);

    const codeEl = document.createElement('pre');
    codeEl.className = 'svg-code hidden';
    codeEl.textContent = svgSource;
    block.appendChild(codeEl);

    toggleBtn.addEventListener('click', () => {
      codeEl.classList.toggle('hidden');
      toggleBtn.textContent = codeEl.classList.contains('hidden') ? 'Show Code' : 'Hide Code';
    });

    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(svgSource);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => copyBtn.textContent = 'Copy SVG', 1500);
    });

    iconsOutputEl.appendChild(block);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const span = document.createElement('span');
    span.className = 'text-segment';
    span.textContent = text.slice(lastIndex);
    iconsOutputEl.appendChild(span);
  }

  if (hasSvg) {
    toolbox.classList.add('visible');
    const pct = sizeSlider.value;
    document.querySelectorAll('.svg-preview').forEach(p => {
      if (lightMode) p.classList.add('light');
      const s = p.querySelector('svg');
      if (s) s.style.width = pct + '%';
    });
  } else {
    toolbox.classList.remove('visible');
  }

  if (!hasSvg && !text.trim()) {
    iconsOutputEl.textContent = '(empty response)';
  }
}

async function generateIcons() {
  const prompt = iconsPromptEl.value.trim();
  if (!prompt) return;

  if (iconsController) iconsController.abort();
  iconsController = new AbortController();

  iconsSendBtn.disabled = true;
  iconsSendBtn.textContent = 'Generating...';
  iconsOutputEl.className = 'output-card visible';
  iconsOutputEl.innerHTML = '<div class="loading"><div class="spinner"></div>Thinking...</div>';
  iconsTimer.start();

  try {
    const data = await callApi(prompt, iconsModelEl.value, 'icons', iconsController.signal);
    iconsTimer.stop();
    renderSvgOutput(data.text || '');
    iconsStatusEl.innerHTML = 'Completed in <span class="timer">' + data.elapsed + 's</span>';
  } catch (e) {
    if (e.name === 'AbortError') return;
    iconsTimer.stop();
    iconsOutputEl.className = 'output-card visible error';
    iconsOutputEl.textContent = e.message;
    iconsStatusEl.textContent = '';
  } finally {
    iconsSendBtn.disabled = false;
    iconsSendBtn.textContent = 'Generate';
    iconsController = null;
  }
}
