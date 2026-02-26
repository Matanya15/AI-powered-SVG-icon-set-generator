# SVG Icon Generator

AI-powered SVG icon set generator built with Google Gemini and Flask. Generate cohesive icon sets through a multi-step pipeline: text brief, image generation, deterministic tracing, and AI cleanup.

## Features

- **Icon Studio** — Split-screen workspace for generating icon specifications and SVG icons via direct AI prompting
- **Icon Pipeline** — Multi-step pipeline that produces icon sets:
  1. **Brief Generation** — AI generates a structured JSON spec from a text description
  2. **Image Generation** — Gemini Flash Image renders a 3x3 grid of icons as a single PNG
  3. **Deterministic Crop** — Splits the grid into 9 individual icon images (Pillow)
  4. **Deterministic Trace** — Converts each PNG to SVG via bitmap tracing (Potrace)
- Dark/light mode toggle and resizable SVG previews
- Copy-to-clipboard for all generated SVG code

## Prerequisites

- Python 3.10+
- [Potrace](https://potrace.sourceforge.net/) — bitmap tracing tool
- A [Google Gemini API key](https://aistudio.google.com/apikey)

### Install Potrace

```bash
# macOS
brew install potrace

# Ubuntu / Debian
sudo apt-get install potrace
```

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
├── app.py                 # Flask backend — routes and API endpoints
├── system_prompt.py       # AI system prompts and generation configs
├── templates/
│   ├── index.html         # Icon Studio page
│   └── pipeline.html      # Pipeline playground page
├── static/
│   ├── css/
│   │   ├── studio.css     # Studio styles
│   │   └── pipeline.css   # Pipeline styles
│   └── js/
│       ├── studio.js      # Studio client logic
│       └── pipeline.js    # Pipeline client logic
├── requirements.txt
├── .env.example
└── .gitignore
```

## Tech Stack

- **Backend:** Flask, Python
- **AI:** Google Gemini API (`google-genai`)
- **Image Processing:** Pillow, Potrace
- **Frontend:** Vanilla HTML/CSS/JS
