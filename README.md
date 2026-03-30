# SVG Icon Generator

AI-powered SVG icon set generator built with Google Gemini and Flask. Generate cohesive icon sets through a multi-step pipeline: text brief, image generation, deterministic tracing, and AI cleanup.

## Features

- **Icon Studio** — Split-screen workspace with an interactive dot field background, for generating icon specifications and SVG icons via direct AI prompting
- **Icon Pipeline** — Multi-step pipeline that produces icon sets:
  1. **Brief Generation** — AI generates a structured JSON spec from a text description
  2. **Image Generation** — Gemini renders a grid of icons as a single PNG (supports multiple models including Gemini 3.1 Flash, Imagen 4)
  3. **Deterministic Crop** — Splits the grid into individual icon images (Pillow)
  4. **Deterministic Trace** — Converts each PNG to SVG via bitmap tracing:
     - **Mono (Potrace)** — Black & white tracing with tunable threshold, speckle suppression, corner smoothing, optimize tolerance, pre-scale, and invert
     - **Color (VTracer)** — Full-color tracing with controls for speckle filter, color precision, layer difference, corner threshold, path length, splice threshold, iterations, and path precision
- **Live Re-trace** — Adjust tracing parameters and re-trace without re-running the full pipeline
- **Reference Images** — Upload a style reference image to guide icon generation
- **Style & Color Modes** — 20 icon styles (outline, solid, hand-drawn, isometric, etc.) and 9 color modes (B&W, pastel, vibrant, gradient, etc.)
- **Export** — Copy all SVGs, download as individual SVGs or PNGs, batch download as .zip
- **Mockup Preview** — Preview generated icons in a simulated app UI (dark/light mode)
- **Dark/Light Mode** — Toggle icon preview colors with a resizable SVG size slider

## Prerequisites

- Python 3.10+
- Python 3.12 (for VTracer color tracing — installed separately)
- [Potrace](https://potrace.sourceforge.net/) — bitmap tracing tool
- A [Google Gemini API key](https://aistudio.google.com/apikey)

### Install Potrace

```bash
# macOS
brew install potrace

# Ubuntu / Debian
sudo apt-get install potrace
```

### Set Up VTracer Environment

VTracer requires Python 3.12 due to Rust binding compatibility:

```bash
python3.12 -m venv /tmp/vtracer_env
/tmp/vtracer_env/bin/pip install vtracer
```

To use a custom path, set `VTRACER_PYTHON` in your `.env`.

## Setup

```bash
# Clone the repo
git clone https://github.com/Matanya15/AI-powered-SVG-icon-set-generator.git
cd AI-powered-SVG-icon-set-generator

# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure your API key
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

## Running

```bash
python app.py
```

Open [http://localhost:5001](http://localhost:5001) for the Icon Studio, or navigate to [http://localhost:5001/pipeline](http://localhost:5001/pipeline) for the full pipeline.

## Project Structure

```
├── app.py                 # Flask backend — routes, tracing, and API endpoints
├── system_prompt.py       # AI system prompts and generation configs
├── templates/
│   ├── index.html         # Landing / navigation page
│   ├── generate.html      # Icon Studio page
│   └── pipeline.html      # Pipeline playground page
├── static/
│   ├── css/
│   │   ├── studio.css     # Studio styles
│   │   ├── generate.css   # Generate page styles
│   │   └── pipeline.css   # Pipeline styles
│   └── js/
│       ├── studio.js      # Studio client logic
│       ├── generate.js    # Generate page client logic
│       ├── pipeline.js    # Pipeline client logic
│       └── dot-field.js   # Interactive dot field canvas effect
├── requirements.txt
├── .env.example
└── .gitignore
```

## Tech Stack

- **Backend:** Flask, Python
- **AI:** Google Gemini API (`google-genai`)
- **Image Processing:** Pillow, Potrace, VTracer
- **Frontend:** Vanilla HTML/CSS/JS, Canvas 2D
