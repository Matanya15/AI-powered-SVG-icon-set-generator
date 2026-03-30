import base64
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import traceback
from dotenv import load_dotenv
from PIL import Image
from flask import Flask, request, jsonify, render_template
from google import genai
from google.genai import types
from google.genai.types import Modality
from system_prompt import SYSTEM_PROMPT, SPEC_PROMPT, IMAGE_GEN_PROMPT_BW, IMAGE_GEN_PROMPT_COLOR, IMAGE_GEN_PROMPT_REF, IMAGE_GEN_SUFFIX

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
    "gemini-3-pro-image-preview",
    "gemini-2.5-flash-image",
    "imagen-4.0-generate-001",
    "imagen-4.0-fast-generate-001",
    "imagen-4.0-ultra-generate-001",
]

IMAGEN_MODELS = {
    "imagen-4.0-generate-001",
    "imagen-4.0-fast-generate-001",
    "imagen-4.0-ultra-generate-001",
}

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


POTRACE_DEFAULTS = dict(
    threshold=128, turdsize=15, alphamax=1.0,
    opttolerance=1.0, scale=3, invert=False,
)


def trace_image_to_svg(png_bytes, name=None, params=None):
    """Convert PNG bytes to a clean, minimal SVG optimized for flat monochrome icons."""
    p = {**POTRACE_DEFAULTS, **(params or {})}
    scale = max(1, min(6, int(p['scale'])))
    threshold = max(0, min(255, int(p['threshold'])))
    turdsize = max(0, min(100, int(p['turdsize'])))
    alphamax = max(0.0, min(1.334, float(p['alphamax'])))
    opttolerance = max(0.0, min(5.0, float(p['opttolerance'])))
    invert = bool(p.get('invert', False))

    img = Image.open(io.BytesIO(png_bytes)).convert("L")
    img = img.resize((img.size[0] * scale, img.size[1] * scale), Image.LANCZOS)
    if invert:
        bw = img.point(lambda px: 255 if px < threshold else 0, mode="1")
    else:
        bw = img.point(lambda px: 0 if px < threshold else 255, mode="1")
    img.close()

    pgm_fd, pgm_path = tempfile.mkstemp(suffix=".pgm")
    svg_fd, svg_path = tempfile.mkstemp(suffix=".svg")
    os.close(pgm_fd)
    os.close(svg_fd)
    try:
        bw.save(pgm_path)
        bw.close()
        subprocess.run(
            ["potrace", pgm_path, "-s", "-o", svg_path,
             "--flat", "-t", str(turdsize),
             "-a", str(alphamax), "-O", str(opttolerance)],
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


VTRACER_PYTHON = os.environ.get("VTRACER_PYTHON", "/tmp/vtracer_env/bin/python3.12")

VTRACER_DEFAULTS = dict(
    filter_speckle=10, color_precision=8, layer_difference=64,
    corner_threshold=50, length_threshold=3.5, splice_threshold=10,
    max_iterations=20, path_precision=1, mode='spline', hierarchical='stacked',
)

def trace_image_to_svg_color(png_bytes, name=None, params=None):
    """Convert PNG bytes to SVG preserving colors using VTracer in a subprocess.

    Runs VTracer via a separate Python 3.12 interpreter to avoid Rust binding
    segfaults on Python 3.14. Set VTRACER_PYTHON env var to override the path.
    """
    p = {**VTRACER_DEFAULTS, **(params or {})}
    script = f"""
import sys, vtracer
png = sys.stdin.buffer.read()
svg = vtracer.convert_raw_image_to_svg(
    png, img_format='png', colormode='color',
    hierarchical='{p['hierarchical']}',
    filter_speckle={int(p['filter_speckle'])},
    color_precision={int(p['color_precision'])},
    layer_difference={int(p['layer_difference'])},
    corner_threshold={int(p['corner_threshold'])},
    length_threshold={float(p['length_threshold'])},
    splice_threshold={int(p['splice_threshold'])},
    max_iterations={int(p['max_iterations'])},
    path_precision={int(p['path_precision'])},
    mode='{p['mode']}',
)
sys.stdout.write(svg)
"""
    result = subprocess.run(
        [VTRACER_PYTHON, "-c", script],
        input=png_bytes, capture_output=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"VTracer failed: {result.stderr.decode()}")
    svg = result.stdout.decode()
    svg = re.sub(r'<\?xml[^?]*\?>\s*', '', svg)

    if 'viewBox' not in svg:
        wm = re.search(r'\bwidth="(\d+)"', svg)
        hm = re.search(r'\bheight="(\d+)"', svg)
        if wm and hm:
            svg = svg.replace('<svg ', f'<svg viewBox="0 0 {wm.group(1)} {hm.group(1)}" ', 1)

    svg = _remove_background_paths(svg)

    if name:
        svg = svg.replace('<svg ', f'<svg data-icon="{name}" ', 1)
    return svg.strip()


def _normalize_color(color_str):
    """Normalize a CSS color string to uppercase 6-digit hex for comparison."""
    c = color_str.strip().upper()
    if c.startswith('#') and len(c) == 4:
        c = '#' + c[1]*2 + c[2]*2 + c[3]*2
    return c


def _remove_background_paths(svg):
    """Detect the background fill from the first <path> and remove all paths
    sharing that color, making the SVG background transparent."""
    first = re.search(r'<path\b[^>]*?fill="([^"]+)"', svg)
    if not first:
        return svg
    bg_color = _normalize_color(first.group(1))

    def _replace_path(m):
        fill_match = re.search(r'fill="([^"]+)"', m.group(0))
        if fill_match and _normalize_color(fill_match.group(1)) == bg_color:
            return ''
        return m.group(0)

    return re.sub(r'<path\b[^>]*/>', _replace_path, svg)


def build_config(mode, model):
    instruction = SYSTEM_PROMPT if mode == "icons" else SPEC_PROMPT
    kwargs = {"system_instruction": instruction}
    if model in THINKING_MODELS:
        kwargs["thinking_config"] = types.ThinkingConfig(thinking_level="low")
    return types.GenerateContentConfig(**kwargs)


# ── Routes ──────────────────────────────────────────────────────────


@app.route("/")
def generate_page():
    return render_template(
        "generate.html",
        image_gen_prompt_bw=IMAGE_GEN_PROMPT_BW,
        image_gen_prompt_color=IMAGE_GEN_PROMPT_COLOR,
        image_gen_prompt_ref=IMAGE_GEN_PROMPT_REF,
        image_gen_suffix=IMAGE_GEN_SUFFIX,
    )


@app.route("/studio")
def studio():
    return render_template("index.html")


@app.route("/pipeline")
def pipeline():
    return render_template(
        "pipeline.html",
        image_gen_prompt_bw=IMAGE_GEN_PROMPT_BW,
        image_gen_prompt_color=IMAGE_GEN_PROMPT_COLOR,
        image_gen_prompt_ref=IMAGE_GEN_PROMPT_REF,
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
    ref_image = data.get("reference_image")

    if not prompt:
        return jsonify({"error": "Prompt cannot be empty"}), 400

    kwargs = {
        "system_instruction": SPEC_PROMPT,
        "response_mime_type": "application/json",
    }
    config = types.GenerateContentConfig(**kwargs)

    contents = []
    if ref_image:
        try:
            header, b64_ref = ref_image.split(",", 1)
            mime_ref = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
            img_bytes = base64.b64decode(b64_ref)
            print(f"[brief] ref image: mime={mime_ref}, size={len(img_bytes)} bytes", flush=True)
            contents.append(
                "The user has attached a reference image. Analyze its visual style — "
                "stroke weight, color palette, level of detail, and overall aesthetic. "
                "Use this to inform the style section of the spec and write icon descriptions "
                "that match this visual language."
            )
            contents.append(types.Part.from_bytes(data=img_bytes, mime_type=mime_ref))
        except Exception as e:
            print(f"[brief] ERROR parsing ref image: {e}", flush=True)
    contents.append(prompt)

    try:
        start = time.time()
        response = client.models.generate_content(
            model=model, contents=contents, config=config,
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
    ref_image = data.get("reference_image")

    if not prompt:
        return jsonify({"error": "Prompt cannot be empty"}), 400

    is_imagen = model in IMAGEN_MODELS

    try:
        start = time.time()

        if is_imagen:
            full_prompt = prompt
            if ref_image:
                full_prompt = (
                    "STYLE REFERENCE: Match the exact same stroke weight, line style, "
                    "level of detail, proportions, and visual language described below. "
                    "The new icons must look like they belong to the same family.\n\n"
                    + prompt
                )
            response = client.models.generate_images(
                model=model,
                prompt=full_prompt,
                config=types.GenerateImagesConfig(number_of_images=1),
            )
            elapsed = round(time.time() - start, 1)
            if not response.generated_images:
                return jsonify({"error": "Model did not return an image"}), 502
            img_obj = response.generated_images[0].image
            b64 = base64.b64encode(img_obj.image_bytes).decode("utf-8")
            mime = getattr(img_obj, "mime_type", None) or "image/png"
            result = {"elapsed": elapsed, "text": None, "image": f"data:{mime};base64,{b64}"}
        else:
            config = types.GenerateContentConfig(
                response_modalities=[Modality.TEXT, Modality.IMAGE],
                temperature=0,
            )
            contents = []
            if ref_image:
                try:
                    header, b64_ref = ref_image.split(",", 1)
                    mime_ref = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
                    img_bytes = base64.b64decode(b64_ref)
                    is_user_ref = data.get("user_ref", False)
                    print(f"[ref-image] user_ref={is_user_ref}, mime={mime_ref}, size={len(img_bytes)} bytes", flush=True)

                    if is_user_ref:
                        ref_instruction = (
                            "The following image is attached by the user."
                            "If user provide instructions how you should use the reference image, follow them strictly. If not, use it as a STYLE REFERENCE:"
                            "Study its visual style — stroke weight, line style, color palette, level of detail, "
                            "proportions, and overall aesthetic — then generate the icons below matching that style. "
                            "The generated icons must feel like they belong to the same design system as this reference."
                        )
                    else:
                        ref_instruction = (
                            "The following image is a previously generated 3x3 icon grid from the same icon set. "
                            "Use it as a STYLE REFERENCE — match the exact same stroke weight, line style, level of detail, "
                            "proportions, and visual language for the new icons below."
                        )

                    ref_part = types.Part.from_bytes(data=img_bytes, mime_type=mime_ref)
                    contents.append(ref_instruction)
                    contents.append(ref_part)
                    contents.append("Now, based on the reference image above, generate the following icons:\n\n")
                except Exception as e:
                    print(f"[ref-image] ERROR parsing reference image: {e}", flush=True)
                    traceback.print_exc()
            contents.append(prompt)
            print(f"[generate-image] contents has {len(contents)} parts: {[type(c).__name__ for c in contents]}", flush=True)

            response = client.models.generate_content(
                model=model, contents=contents, config=config,
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
                cropped.close()
        img.close()

        elapsed = round(time.time() - start, 3)
        return jsonify({"icons": icons, "elapsed": elapsed})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 502


@app.route("/api/pipeline/trace", methods=["POST"])
def pipeline_trace():
    """Trace individual icon images into SVGs using Potrace (mono) or VTracer (color)."""
    data = request.json
    icons = data.get("icons", [])
    names = data.get("names", [])
    tracer = data.get("tracer", "potrace")
    vtracer_params = data.get("vtracer_params", None)
    potrace_params = data.get("potrace_params", None)

    if not icons:
        return jsonify({"error": "No icons provided"}), 400

    try:
        start = time.time()
        svgs = []
        kept_names = []
        kept_indices = []
        for i, icon_data in enumerate(icons):
            _header, b64 = icon_data.split(",", 1)
            raw_bytes = base64.b64decode(b64)
            name = names[i] if i < len(names) else None
            if tracer == "vtracer":
                svg = trace_image_to_svg_color(raw_bytes, name=name, params=vtracer_params)
            else:
                svg = trace_image_to_svg(raw_bytes, name=name, params=potrace_params)
            if not is_svg_empty(svg):
                svgs.append(svg)
                kept_names.append(name or "")
                kept_indices.append(i)
        elapsed = round(time.time() - start, 2)
        return jsonify({"svgs": svgs, "names": kept_names, "indices": kept_indices, "elapsed": elapsed})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 502


if __name__ == "__main__":
    app.run(debug=True, port=5001, use_reloader=False, threaded=True)
