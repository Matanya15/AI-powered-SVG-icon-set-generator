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
from flask import Flask, request, jsonify, render_template
from google import genai
from google.genai import types
from google.genai.types import Modality
from system_prompt import SYSTEM_PROMPT, SPEC_PROMPT, IMAGE_GEN_PROMPT, IMAGE_GEN_SUFFIX

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


def is_svg_empty(svg_string):
    """Return True if the SVG has no meaningful path data (all <path d=""> are empty)."""
    paths = re.findall(r'd="([^"]*)"', svg_string)
    return not paths or all(not d.strip() for d in paths)


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


# ── Routes ──────────────────────────────────────────────────────────


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/pipeline")
def pipeline():
    return render_template(
        "pipeline.html",
        image_gen_prompt=IMAGE_GEN_PROMPT,
        image_gen_suffix=IMAGE_GEN_SUFFIX,
    )


# ── API: Studio ─────────────────────────────────────────────────────


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


# ── API: Pipeline ───────────────────────────────────────────────────


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
        kept_names = []
        for i, icon_data in enumerate(icons):
            _header, b64 = icon_data.split(",", 1)
            raw_bytes = base64.b64decode(b64)
            name = names[i] if i < len(names) else None
            svg = trace_image_to_svg(raw_bytes, name=name)
            if not is_svg_empty(svg):
                svgs.append(svg)
                kept_names.append(name or "")
        elapsed = round(time.time() - start, 2)
        return jsonify({"svgs": svgs, "names": kept_names, "elapsed": elapsed})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 502


if __name__ == "__main__":
    app.run(debug=True, port=5001)
