import base64
import io
import json
import os
import re
import subprocess
import tempfile
import time
import traceback
from dotenv import load_dotenv
from PIL import Image
from flask import Flask, request, jsonify
from google import genai
from google.genai import types
from google.genai.types import Modality
from system_prompt import SYSTEM_PROMPT, SPEC_PROMPT, SVG_CONVERT_PROMPT, IMAGE_GEN_PROMPT, IMAGE_GEN_SUFFIX

load_dotenv()

app = Flask(__name__)

client = genai.Client(
    api_key=os.environ["GEMINI_API_KEY"],
    http_options=types.HttpOptions(timeout=300_000),
)

AVAILABLE_MODELS = [
    "gemini-3.1-pro-preview",
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
]


IMAGE_MODELS = [
    "gemini-3.1-flash-image-preview",
]

THINKING_MODELS = {
    "gemini-3.1-pro-preview",
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
}


def trace_image_to_svg(png_bytes, name=None):
    """Convert PNG bytes to a clean, minimal SVG optimized for flat monochrome icons."""
    SCALE = 3

    img = Image.open(io.BytesIO(png_bytes)).convert("L")
    img = img.resize((img.size[0] * SCALE, img.size[1] * SCALE), Image.LANCZOS)
    bw = img.point(lambda p: 0 if p < 128 else 255, mode="1")

    pgm_fd, pgm_path = tempfile.mkstemp(suffix=".pgm")
    svg_fd, svg_path = tempfile.mkstemp(suffix=".svg")
    os.close(pgm_fd)
    os.close(svg_fd)
    try:
        bw.save(pgm_path)
        subprocess.run(
            ["potrace", pgm_path, "-s", "-o", svg_path,
             "--flat", "-t", "15", "-a", "1.334", "-O", "1.0"],
            capture_output=True, check=True,
        )
        with open(svg_path) as f:
            raw = f.read()
    finally:
        os.unlink(pgm_path)
        os.unlink(svg_path)

    raw = re.sub(r'<\?xml[^?]*\?>\s*', '', raw)
    raw = re.sub(r'<!DOCTYPE[^>]*>\s*', '', raw)
    raw = re.sub(r'<metadata>[\s\S]*?</metadata>\s*', '', raw)
    raw = re.sub(r'\s*preserveAspectRatio="[^"]*"', '', raw)
    raw = re.sub(r'\s*width="[^"]*"', '', raw)
    raw = re.sub(r'\s*height="[^"]*"', '', raw)
    raw = re.sub(r'\s*version="[^"]*"', '', raw)

    if name:
        raw = raw.replace('<svg ', f'<svg data-icon="{name}" ', 1)

    return raw.strip()


def build_config(mode, model):
    instruction = SYSTEM_PROMPT if mode == "icons" else SPEC_PROMPT
    kwargs = {"system_instruction": instruction}
    if model in THINKING_MODELS:
        kwargs["thinking_config"] = types.ThinkingConfig(thinking_level="low")
    return types.GenerateContentConfig(**kwargs)


@app.route("/")
def index():
    return HTML_PAGE


@app.route("/api/generate", methods=["POST"])
def generate():
    data = request.json
    prompt = data.get("prompt", "").strip()
    model = data.get("model", AVAILABLE_MODELS[0])
    mode = data.get("mode", "icons")

    if not prompt:
        return jsonify({"error": "Prompt cannot be empty"}), 400

    if model not in AVAILABLE_MODELS:
        return jsonify({"error": f"Unknown model: {model}"}), 400

    config = build_config(mode, model)

    try:
        start = time.time()
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=config,
        )
        elapsed = round(time.time() - start, 1)
        return jsonify({"text": response.text, "elapsed": elapsed})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/pipeline")
def pipeline():
    return PIPELINE_PAGE.replace(
        "/*__IMAGE_GEN_PROMPT__*/",
        json.dumps(IMAGE_GEN_PROMPT),
    ).replace(
        "/*__IMAGE_GEN_SUFFIX__*/",
        json.dumps(IMAGE_GEN_SUFFIX),
    )


@app.route("/api/pipeline/brief", methods=["POST"])
def pipeline_brief():
    data = request.json
    prompt = data.get("prompt", "").strip()
    model = data.get("model", AVAILABLE_MODELS[0])

    if not prompt:
        return jsonify({"error": "Prompt cannot be empty"}), 400

    kwargs = {
        "system_instruction": SPEC_PROMPT,
        "response_mime_type": "application/json",
    }
    if model in THINKING_MODELS:
        kwargs["thinking_config"] = types.ThinkingConfig(thinking_level="low")
    config = types.GenerateContentConfig(**kwargs)

    try:
        start = time.time()
        response = client.models.generate_content(
            model=model, contents=prompt, config=config,
        )
        elapsed = round(time.time() - start, 1)
        return jsonify({"text": response.text, "elapsed": elapsed})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/pipeline/generate-image", methods=["POST"])
def pipeline_generate_image():
    data = request.json
    prompt = data.get("prompt", "").strip()
    model = data.get("model", IMAGE_MODELS[0])

    if not prompt:
        return jsonify({"error": "Prompt cannot be empty"}), 400

    config = types.GenerateContentConfig(
        response_modalities=[Modality.TEXT, Modality.IMAGE],
        temperature=0,
    )

    try:
        start = time.time()
        response = client.models.generate_content(
            model=model, contents=prompt, config=config,
        )
        elapsed = round(time.time() - start, 1)

        result = {"elapsed": elapsed, "text": None, "image": None}
        for part in response.candidates[0].content.parts:
            if part.text:
                result["text"] = part.text
            elif part.inline_data:
                b64 = base64.b64encode(part.inline_data.data).decode("utf-8")
                mime = part.inline_data.mime_type or "image/png"
                result["image"] = f"data:{mime};base64,{b64}"

        if not result["image"]:
            return jsonify({"error": "Model did not return an image"}), 502

        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/pipeline/crop", methods=["POST"])
def pipeline_crop():
    """Split a 3x3 grid image into 9 individual icon images."""
    data = request.json
    image_data = data.get("image_data", "")

    if not image_data:
        return jsonify({"error": "No image provided"}), 400

    try:
        header, b64 = image_data.split(",", 1)
        mime = header.split(":")[1].split(";")[0]
        raw_bytes = base64.b64decode(b64)
    except Exception:
        return jsonify({"error": "Invalid image data"}), 400

    try:
        start = time.time()
        img = Image.open(io.BytesIO(raw_bytes))
        w, h = img.size
        cw, ch = w / 3, h / 3

        icons = []
        for row in range(3):
            for col in range(3):
                box = (round(col * cw), round(row * ch),
                       round((col + 1) * cw), round((row + 1) * ch))
                cropped = img.crop(box)
                buf = io.BytesIO()
                cropped.save(buf, format="PNG")
                b64_icon = base64.b64encode(buf.getvalue()).decode("utf-8")
                icons.append(f"data:image/png;base64,{b64_icon}")

        elapsed = round(time.time() - start, 3)
        return jsonify({"icons": icons, "elapsed": elapsed})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 502


@app.route("/api/pipeline/trace", methods=["POST"])
def pipeline_trace():
    """Trace 9 individual icon images into 9 SVGs."""
    data = request.json
    icons = data.get("icons", [])
    names = data.get("names", [])

    if not icons:
        return jsonify({"error": "No icons provided"}), 400

    try:
        start = time.time()
        svgs = []
        for i, icon_data in enumerate(icons):
            _header, b64 = icon_data.split(",", 1)
            raw_bytes = base64.b64decode(b64)
            name = names[i] if i < len(names) else None
            svgs.append(trace_image_to_svg(raw_bytes, name=name))
        elapsed = round(time.time() - start, 2)
        return jsonify({"svgs": svgs, "elapsed": elapsed})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 502


@app.route("/api/pipeline/convert-svg", methods=["POST"])
def pipeline_convert_svg():
    """Clean up each icon: receives 9 traced SVGs only."""
    data = request.json
    svgs = data.get("svgs", [])
    model = data.get("model", AVAILABLE_MODELS[0])
    prompt = data.get("prompt", "").strip()

    if not svgs:
        return jsonify({"error": "No traced SVGs provided"}), 400

    kwargs = {"system_instruction": SVG_CONVERT_PROMPT}
    if model in THINKING_MODELS:
        kwargs["thinking_config"] = types.ThinkingConfig(thinking_level="low")
    config = types.GenerateContentConfig(**kwargs)

    contents = []
    for i, svg_code in enumerate(svgs, 1):
        contents.append(f"--- Icon {i} ---\n{svg_code}")

    if prompt:
        contents.append(prompt)
    else:
        contents.append(
            "Clean up each of the 9 icons above. Return 9 polished SVG blocks."
        )

    try:
        start = time.time()
        response = client.models.generate_content(
            model=model, contents=contents, config=config,
        )
        elapsed = round(time.time() - start, 1)
        return jsonify({"text": response.text, "elapsed": elapsed})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


HTML_PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gemini Icon Studio</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f0f0f;
    color: #e0e0e0;
    height: 100vh;
    overflow: hidden;
  }

  .split-layout {
    display: flex;
    height: 100vh;
  }

  .panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .panel-header {
    padding: 16px 24px;
    border-bottom: 1px solid #1e1e1e;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .panel-header h2 {
    font-size: 0.95rem;
    font-weight: 600;
    color: #fff;
  }

  .panel-header .badge {
    font-size: 0.65rem;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .badge-spec { background: #1e3a2f; color: #4ade80; }
  .badge-icons { background: #2e1e3a; color: #a78bfa; }

  .divider {
    width: 1px;
    background: #1e1e1e;
    flex-shrink: 0;
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    padding-bottom: 80px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .controls {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  select {
    background: #1a1a1a;
    color: #e0e0e0;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 0.82rem;
    cursor: pointer;
    outline: none;
    transition: border-color 0.2s;
  }
  select:hover, select:focus { border-color: #8b5cf6; }

  .input-area { position: relative; }

  textarea {
    width: 100%;
    min-height: 140px;
    background: #1a1a1a;
    color: #e0e0e0;
    border: 1px solid #2a2a2a;
    border-radius: 10px;
    padding: 14px;
    padding-bottom: 46px;
    font-size: 0.9rem;
    font-family: inherit;
    resize: vertical;
    outline: none;
    transition: border-color 0.2s;
    line-height: 1.5;
  }
  textarea:focus { border-color: #8b5cf6; }
  textarea::placeholder { color: #555; }

  .input-footer {
    position: absolute;
    bottom: 15px;
    right: 13px;
    display: flex;
    gap: 8px;
    align-items: center;
  }

  button {
    background: #8b5cf6;
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 8px 20px;
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    box-shadow: -5px -5px 30px #0f0f0f;
    transition: background 0.2s, opacity 0.2s;
  }
  button:hover { background: #7c3aed; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }

  .output-card {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 10px;
    padding: 16px;
    # min-height: 60px;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6;
    font-size: 0.9rem;
    display: none;
    position: relative;
  }
  .output-card.visible { display: block; }
  .output-card.error {
    border-color: #ef4444;
    color: #fca5a5;
    background: #1a1111;
  }

  .copy-output-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    background: #232323;
    color: #aaa;
    font-size: 0.72rem;
    padding: 4px 12px;
    border-radius: 6px;
    border: 1px solid #333;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    z-index: 1;
  }
  .copy-output-btn:hover { background: #2e2e2e; color: #e0e0e0; }

  .status {
    font-size: 0.78rem;
    color: #888;
    min-height: 1.2em;
  }
  .status .timer { color: #8b5cf6; font-variant-numeric: tabular-nums; }

  .loading {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #888;
  }
  .spinner {
    width: 16px; height: 16px;
    border: 2px solid #333;
    border-top-color: #8b5cf6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── SVG rendering ── */

  .svg-block {
    margin: 12px 0;
    border: 1px solid #333;
    border-radius: 10px;
    overflow: hidden;
    background: #141414;
  }

  .svg-preview {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 24px;
    background: #1a1a1a;
    transition: background 0.2s;
  }

  .svg-preview.light { background: #f5f5f5; }

  .svg-preview svg {
    width: 100%;
    height: auto;
    color: #fff;
    transition: color 0.2s, width 0.15s;
    overflow: visible;
  }

  .svg-preview svg g {
    fill: #ffffff !important;
  }

  .svg-preview.light svg { color: #1a1a1a; }

  .svg-actions {
    display: flex;
    gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid #2a2a2a;
  }

  .svg-actions button {
    background: #232323;
    color: #aaa;
    font-size: 0.72rem;
    padding: 4px 12px;
    border-radius: 6px;
    border: 1px solid #333;
    transition: background 0.15s, color 0.15s;
  }
  .svg-actions button:hover { background: #2e2e2e; color: #e0e0e0; }

  .svg-code {
    margin: 0;
    padding: 14px;
    background: #111;
    color: #a78bfa;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 0.75rem;
    line-height: 1.5;
    overflow-x: auto;
    border-top: 1px solid #2a2a2a;
    white-space: pre;
    word-break: normal;
  }

  .svg-code.hidden { display: none; }

  .text-segment {
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* ── Toolbox ── */

  .toolbox {
    position: fixed;
    bottom: 20px;
    right: 24px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 12px;
    padding: 10px 20px;
    display: none;
    align-items: center;
    gap: 16px;
    z-index: 1000;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
  }
  .toolbox.visible { display: flex; }

  .toolbox-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toolbox label {
    font-size: 0.72rem;
    color: #888;
    white-space: nowrap;
  }

  .toolbox-divider {
    width: 1px;
    height: 24px;
    background: #333;
  }

  .toolbox-btn {
    background: #232323;
    color: #aaa;
    font-size: 0.72rem;
    padding: 5px 14px;
    border-radius: 6px;
    border: 1px solid #333;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .toolbox-btn:hover { background: #2e2e2e; color: #e0e0e0; }
  .toolbox-btn.active { background: #8b5cf6; color: #fff; border-color: #8b5cf6; }

  .size-slider {
    -webkit-appearance: none;
    width: 100px;
    height: 4px;
    background: #333;
    border-radius: 2px;
    outline: none;
  }
  .size-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px; height: 14px;
    background: #8b5cf6;
    border-radius: 50%;
    cursor: pointer;
  }
  .size-slider::-moz-range-thumb {
    width: 14px; height: 14px;
    background: #8b5cf6;
    border-radius: 50%;
    border: none;
    cursor: pointer;
  }

  .size-value {
    font-size: 0.68rem;
    color: #8b5cf6;
    font-variant-numeric: tabular-nums;
    min-width: 36px;
    text-align: right;
  }
</style>
</head>
<body>

<div class="split-layout">

  <!-- ── LEFT: Spec Generator ── -->
  <div class="panel">
    <div class="panel-header">
      <h2>Spec Generator</h2>
      <span class="badge badge-spec">Prompt</span>
      <a href="/pipeline" style="margin-left:auto;font-size:0.75rem;color:#888;text-decoration:none;transition:color 0.15s" onmouseover="this.style.color='#8b5cf6'" onmouseout="this.style.color='#888'">Pipeline &#8594;</a>
    </div>
    <div class="panel-body">
      <div class="controls">
        <select id="specModel">
          <option value="gemini-3.1-pro-preview" selected>Gemini 3.1 Pro</option>
          <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
          <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
          <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
          <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
          <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
        </select>
      </div>
      <div class="input-area">
        <textarea id="specPrompt" placeholder="Describe the icon set you need..." autofocus></textarea>
        <div class="input-footer">
          <button id="specSend" onclick="generateSpec()">Send</button>
        </div>
      </div>
      <div id="specOutput" class="output-card"></div>
      <div id="specStatus" class="status"></div>
    </div>
  </div>

  <div class="divider"></div>

  <!-- ── RIGHT: Icon Generator ── -->
  <div class="panel">
    <div class="panel-header">
      <h2>Icon Generator</h2>
      <span class="badge badge-icons">SVG</span>
    </div>
    <div class="panel-body">
      <div class="controls">
        <select id="iconsModel">
          <option value="gemini-3.1-pro-preview" selected>Gemini 3.1 Pro</option>
          <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
          <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
          <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
          <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
          <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
        </select>
      </div>
      <div class="input-area">
        <textarea id="iconsPrompt" placeholder="Paste spec or describe icons to generate..."></textarea>
        <div class="input-footer">
          <button id="iconsSend" onclick="generateIcons()">Generate</button>
        </div>
      </div>
      <div id="iconsOutput" class="output-card"></div>
      <div id="iconsStatus" class="status"></div>
    </div>
  </div>

</div>

<div id="toolbox" class="toolbox">
  <div class="toolbox-group">
    <label>Mode</label>
    <button id="modeBtn" class="toolbox-btn" onclick="toggleGlobalMode()">☀ Light</button>
  </div>
  <div class="toolbox-divider"></div>
  <div class="toolbox-group">
    <label>Size</label>
    <input id="sizeSlider" type="range" class="size-slider" min="0" max="100" value="100">
    <span id="sizeValue" class="size-value">100%</span>
  </div>
</div>

<script>
  // ── Shared refs ──
  const toolbox = document.getElementById('toolbox');
  const modeBtnEl = document.getElementById('modeBtn');
  const sizeSlider = document.getElementById('sizeSlider');
  const sizeValueEl = document.getElementById('sizeValue');
  let lightMode = false;

  function toggleGlobalMode() {
    lightMode = !lightMode;
    modeBtnEl.textContent = lightMode ? '☾ Dark' : '☀ Light';
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
</script>
</body>
</html>
"""

PIPELINE_PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Icon Pipeline</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f0f0f;
    color: #e0e0e0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-bottom: 80px;
  }

  .container {
    width: 100%;
    max-width: 900px;
    padding: 32px 20px;
    display: flex;
    flex-direction: column;
    gap: 0px;
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 40px;
  }

  .top-bar h1 {
    font-size: 1.3rem;
    font-weight: 600;
    color: #fff;
  }

  .top-bar h1 span { color: #8b5cf6; }

  .top-bar a {
    color: #888;
    font-size: 0.78rem;
    text-decoration: none;
    transition: color 0.15s;
  }
  .top-bar a:hover { color: #8b5cf6; }

  .step {
    background: #141414;
    border: 1px solid #1e1e1e;
    border-radius: 12px;
    overflow: hidden;
    position: relative;
    min-height: 150px;
  }

  .pipe {
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 84px;
  }

  .pipe-line {
    flex: 1;
    width: 2px;
    background: #2a2a2a;
  }

  .pipe-label {
    padding: 3px 12px;
    border-radius: 4px;
    font-weight: 500;
    text-transform: uppercase;
    font-size: 0.6rem;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }

  .pipe-json { background: #1e2a1e; color: #4ade80; }
  .pipe-png { background: #2a2a1e; color: #fbbf24; }
  .pipe-svg { background: #2e1e3a; color: #a78bfa; }

  .step-header {
    padding: 14px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid #1e1e1e;
    cursor: default;
  }

  .step-num {
    width: 26px; height: 26px;
    border-radius: 50%;
    background: #8b5cf6;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .step-header h3 {
    font-size: 0.88rem;
    font-weight: 600;
    color: #fff;
  }

  .step-badge {
    font-size: 0.6rem;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-left: auto;
  }

  .badge-text { background: #1e3a2f; color: #4ade80; }
  .badge-image { background: #3a2e1e; color: #fbbf24; }
  .badge-svg { background: #2e1e3a; color: #a78bfa; }

  .step-body {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .controls {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  select {
    background: #1a1a1a;
    color: #e0e0e0;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 7px 12px;
    font-size: 0.8rem;
    cursor: pointer;
    outline: none;
    transition: border-color 0.2s;
  }
  select:hover, select:focus { border-color: #8b5cf6; }

  .input-area { position: relative; }

  textarea {
    width: 100%;
    min-height: 260px;
    background: #1a1a1a;
    color: #e0e0e0;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 12px;
    padding-bottom: 42px;
    font-size: 0.85rem;
    font-family: inherit;
    resize: vertical;
    outline: none;
    transition: border-color 0.2s;
    line-height: 1.5;
  }
  textarea:focus { border-color: #8b5cf6; }
  textarea::placeholder { color: #555; }

  .input-footer {
    position: absolute;
    bottom: 15px;
    right: 13px;
    display: flex;
    gap: 8px;
    align-items: center;
  }

  button {
    background: #8b5cf6;
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 8px 20px;
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    box-shadow: -5px -5px 30px #0f0f0f;
    transition: background 0.2s, opacity 0.2s;
  }
  button:hover { background: #7c3aed; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-secondary {
    background: #232323;
    color: #aaa;
    border: 1px solid #333;
    font-size: 0.75rem;
    padding: 5px 14px;
  }
  .btn-secondary:hover { background: #2e2e2e; color: #e0e0e0; }

  .output-card {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 14px;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6;
    font-size: 0.85rem;
    display: none;
    position: relative;
  }
  .output-card.visible { display: block; }
  .output-card.error {
    border-color: #ef4444;
    color: #fca5a5;
    background: #1a1111;
  }

  .copy-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    background: #232323;
    color: #aaa;
    font-size: 0.7rem;
    padding: 3px 10px;
    border-radius: 5px;
    border: 1px solid #333;
    cursor: pointer;
    z-index: 1;
    transition: background 0.15s, color 0.15s;
  }
  .copy-btn:hover { background: #2e2e2e; color: #e0e0e0; }

  .image-output {
    display: none;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #2a2a2a;
  }
  .image-output.visible { display: block; }
  .image-output img {
    width: 100%;
    display: block;
    background: #1a1a1a;
  }

  .step-actions {
    display: flex;
    gap: 8px;
  }

  .status {
    font-size: 0.75rem;
    color: #888;
    min-height: 1.2em;
  }
  .status .timer { color: #8b5cf6; font-variant-numeric: tabular-nums; }

  .loading {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #888;
    font-size: 0.85rem;
  }
  .spinner {
    width: 14px; height: 14px;
    border: 2px solid #333;
    border-top-color: #8b5cf6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .icon-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .icon-grid-cell {
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    overflow: hidden;
    background: #1a1a1a;
    position: relative;
  }

  .icon-grid-cell .cell-label {
    position: absolute;
    top: 4px;
    left: 6px;
    font-size: 0.6rem;
    color: #666;
    z-index: 1;
  }

  .icon-grid-cell img {
    width: 100%;
    display: block;
  }

  .icon-grid-cell .svg-wrap {
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    aspect-ratio: 1;
  }

  .icon-grid-cell .svg-wrap svg {
    width: 100%;
    height: auto;
    display: block;
  }

  .trace-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .trace-row {
    border: 1px solid #333;
    border-radius: 8px;
    overflow: hidden;
    background: #141414;
  }

  .trace-row-top {
    display: flex;
    align-items: stretch;
  }

  .trace-row-ref {
    width: 50%;
    flex-shrink: 0;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    border-right: 1px solid #2a2a2a;
  }

  .trace-row-ref img {
    width: 100%;
    display: block;
  }

  .trace-row .svg-preview {
    flex: 1;
  }

  .trace-row-num {
    position: absolute;
    top: 6px;
    left: 8px;
    font-size: 0.6rem;
    color: #666;
    font-weight: 600;
  }

  .image-thumb {
    max-width: 200px;
    border-radius: 6px;
    border: 1px solid #2a2a2a;
  }

  .svg-block {
    margin: 10px 0;
    border: 1px solid #333;
    border-radius: 8px;
    overflow: hidden;
    background: #141414;
  }

  .svg-preview {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px;
    background: #1a1a1a;
    transition: background 0.2s;
  }
  .svg-preview.light { background: #ffffff; }

  .svg-preview svg {
    width: 100%;
    height: auto;
    color: #fff;
    transition: color 0.2s, width 0.15s;
    overflow: visible;
  }
  .svg-preview.light svg { color: #1a1a1a; }

  .svg-actions {
    display: flex;
    gap: 6px;
    padding: 6px 10px;
    border-top: 1px solid #2a2a2a;
  }
  .svg-actions button {
    background: #232323;
    color: #aaa;
    font-size: 0.7rem;
    padding: 3px 10px;
    border-radius: 5px;
    border: 1px solid #333;
    transition: background 0.15s, color 0.15s;
  }
  .svg-actions button:hover { background: #2e2e2e; color: #e0e0e0; }

  .svg-code {
    margin: 0;
    padding: 12px;
    background: #111;
    color: #a78bfa;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 0.72rem;
    line-height: 1.5;
    overflow-x: auto;
    border-top: 1px solid #2a2a2a;
    white-space: pre;
    word-break: normal;
  }
  .svg-code.hidden { display: none; }

  .text-segment {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .toolbox {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 12px;
    padding: 10px 20px;
    display: none;
    align-items: center;
    gap: 16px;
    z-index: 1000;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
  }
  .toolbox.visible { display: flex; }

  .toolbox-group { display: flex; align-items: center; gap: 8px; }
  .toolbox label { font-size: 0.72rem; color: #888; white-space: nowrap; }
  .toolbox-divider { width: 1px; height: 24px; background: #333; }

  .toolbox-btn {
    background: #232323; color: #aaa; font-size: 0.72rem;
    padding: 5px 14px; border-radius: 6px; border: 1px solid #333;
    cursor: pointer; transition: background 0.15s, color 0.15s;
  }
  .toolbox-btn:hover { background: #2e2e2e; color: #e0e0e0; }
  .toolbox-btn.active { background: #8b5cf6; color: #fff; border-color: #8b5cf6; }

  .size-slider {
    -webkit-appearance: none; width: 100px; height: 4px;
    background: #333; border-radius: 2px; outline: none;
  }
  .size-slider::-webkit-slider-thumb {
    -webkit-appearance: none; width: 14px; height: 14px;
    background: #8b5cf6; border-radius: 50%; cursor: pointer;
  }
  .size-slider::-moz-range-thumb {
    width: 14px; height: 14px; background: #8b5cf6;
    border-radius: 50%; border: none; cursor: pointer;
  }
  .size-value {
    font-size: 0.68rem; color: #8b5cf6;
    font-variant-numeric: tabular-nums; min-width: 36px; text-align: right;
  }
</style>
</head>
<body>
<div class="container">

  <div class="top-bar">
    <h1><span>&#9670;</span> Icon Pipeline</h1>
    <a href="/">Back to Studio</a>
  </div>

  <!-- ═══ STEP 1: Brief ═══ -->
  <div class="step">
    <div class="step-header">
      <div class="step-num">1</div>
      <h3>Generate Brief</h3>
      <span class="step-badge badge-text">Text</span>
    </div>
    <div class="step-body">
      <div class="controls">
        <select id="s1Model">
          <option value="gemini-3.1-pro-preview" selected>Gemini 3.1 Pro</option>
          <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
          <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
          <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
          <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
          <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
        </select>
      </div>
      <div class="input-area">
        <textarea id="s1Prompt" placeholder="Describe what you need icons for..." autofocus></textarea>
        <div class="input-footer">
          <button id="s1Send" onclick="runStep1()">Generate Brief</button>
        </div>
      </div>
      <div id="s1Output" class="output-card"></div>
      <div class="step-actions">
        <button id="s1Forward" class="btn-secondary" style="display:none" onclick="forwardToStep2()">Use as Step 2 input &#8594;</button>
      </div>
      <div id="s1Status" class="status"></div>
    </div>
  </div>

  <div class="pipe">
    <div class="pipe-line"></div>
    <span class="pipe-label pipe-json">JSON</span>
    <div class="pipe-line"></div>
  </div>

  <!-- ═══ STEP 2: Image Generation ═══ -->
  <div class="step">
    <div class="step-header">
      <div class="step-num">2</div>
      <h3>Generate Icon Grid</h3>
      <span class="step-badge badge-image">Image</span>
    </div>
    <div class="step-body">
      <div class="controls">
        <select id="s2Model">
          <option value="gemini-3.1-flash-image-preview" selected>Gemini 3.1 Flash Image</option>
        </select>
      </div>
      <div class="input-area">
        <textarea id="s2Prompt" placeholder="Paste brief or describe the 9 icons for the 3x3 grid..."></textarea>
        <div class="input-footer">
          <button id="s2Send" onclick="runStep2()">Generate Image</button>
        </div>
      </div>
      <div id="s2ImageOutput" class="image-output"></div>
      <div id="s2Output" class="output-card"></div>
      <div class="step-actions">
        <button id="s2Forward" class="btn-secondary" style="display:none" onclick="runStep2b()">Crop Icons &#8594;</button>
      </div>
      <div id="s2Status" class="status"></div>
    </div>
  </div>

  <div class="pipe">
    <div class="pipe-line"></div>
    <span class="pipe-label pipe-png">PNG</span>
    <div class="pipe-line"></div>
  </div>

  <!-- ═══ STEP 2b: Crop (deterministic) ═══ -->
  <div class="step">
    <div class="step-header">
      <div class="step-num" style="background:#059669">2b</div>
      <h3>Crop Icons</h3>
      <span class="step-badge" style="background:#1e3a2f;color:#34d399">Deterministic</span>
    </div>
    <div class="step-body">
      <div id="s2bOutput" class="output-card"></div>
      <div id="s2bGrid" class="icon-grid" style="display:none"></div>
      <div class="step-actions">
        <button id="s2bForward" class="btn-secondary" style="display:none" onclick="runStep2c()">Trace to SVG &#8594;</button>
      </div>
      <div id="s2bStatus" class="status"></div>
    </div>
  </div>

  <div class="pipe">
    <div class="pipe-line"></div>
    <span class="pipe-label pipe-png">PNG</span>
    <div class="pipe-line"></div>
  </div>

  <!-- ═══ STEP 2c: Trace (deterministic) ═══ -->
  <div class="step">
    <div class="step-header">
      <div class="step-num" style="background:#059669">2c</div>
      <h3>Trace Icons</h3>
      <span class="step-badge" style="background:#1e3a2f;color:#34d399">Deterministic</span>
    </div>
    <div class="step-body">
      <div id="s2cOutput" class="output-card"></div>
      <div id="s2cGrid" class="trace-list" style="display:none"></div>
      <div class="step-actions">
        <button id="s2cForward" class="btn-secondary" style="display:none" onclick="forwardToStep3()">Send to AI &#8594;</button>
      </div>
      <div id="s2cStatus" class="status"></div>
    </div>
  </div>

  <div class="pipe">
    <div class="pipe-line"></div>
    <span class="pipe-label pipe-svg">SVG</span>
    <div class="pipe-line"></div>
  </div>

  <!-- ═══ STEP 3: AI Clean ═══ -->
  <div class="step">
    <div class="step-header">
      <div class="step-num">3</div>
      <h3>AI Clean &amp; Polish</h3>
      <span class="step-badge badge-svg">SVG</span>
    </div>
    <div class="step-body">
      <div class="controls">
        <select id="s3Model">
          <option value="gemini-3.1-pro-preview" selected>Gemini 3.1 Pro</option>
          <option value="gemini-3-pro-preview">Gemini 3 Pro</option>
          <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
          <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
          <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
          <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
        </select>
      </div>
      <div id="s3Previews" class="icon-grid" style="display:none"></div>
      <div class="input-area">
        <textarea id="s3Prompt" placeholder="Optional: additional instructions for cleaning..."></textarea>
        <div class="input-footer">
          <button id="s3Send" onclick="runStep3()">Clean Icons</button>
        </div>
      </div>
      <div id="s3Output" class="output-card"></div>
      <div id="s3Status" class="status"></div>
    </div>
  </div>

</div>

<div id="toolbox" class="toolbox">
  <div class="toolbox-group">
    <label>Mode</label>
    <button id="modeBtn" class="toolbox-btn" onclick="toggleMode()">&#9788; Light</button>
  </div>
  <div class="toolbox-divider"></div>
  <div class="toolbox-group">
    <label>Size</label>
    <input id="sizeSlider" type="range" class="size-slider" min="0" max="100" value="100">
    <span id="sizeValue" class="size-value">100%</span>
  </div>
</div>

<script>
  const IMAGE_GEN_PROMPT = /*__IMAGE_GEN_PROMPT__*/;
  const IMAGE_GEN_SUFFIX = /*__IMAGE_GEN_SUFFIX__*/;
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
          + (parsedSpec.style ? [parsedSpec.style.family, parsedSpec.style.size, parsedSpec.style.stroke, parsedSpec.style.colors].filter(Boolean).join(' · ') : '—')
          + '</div><ol style="margin:0;padding-left:20px">';
        (parsedSpec.icons || []).forEach(ic => {
          html += '<li><strong>' + ic.name + '</strong> — ' + ic.description + '</li>';
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
</script>
</body>
</html>
"""

if __name__ == "__main__":
    app.run(debug=True, port=5001, threaded=True)
