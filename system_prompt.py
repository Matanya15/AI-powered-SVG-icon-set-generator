# IMAGE_GEN_PROMPT = """\
# Generate a small 512x512 pixel square image containing a clean, black icon on a white background.
# Do NOT include any text, labels, titles, or descriptions below, above, or next to the icons — only the icons themselves.

# The icon should represent:

# """

IMAGE_GEN_PROMPT = """\
Generate a small 512x512 pixel square image containing a 3x3 grid on a white background.
The grid MUST always have exactly 9 equal-sized cells (3 columns, 3 rows).
Place a simple, clean, black icon in each cell that has a description below. If fewer than 9 icons are described, leave the remaining cells empty (plain white).

CRITICAL NON-NEGOTIABLE RULES: 
- Do NOT render ANY text, letters, words, labels, titles, captions, or descriptions anywhere in the image. The image must contain ONLY the icon drawings and empty cells — nothing else. Ignore any names below — they are just for your understanding of what to draw, NOT to be written in the image.
- Do NOT draw any grid lines, borders, gutters, or separators between cells — the grid should be invisible, with icons placed in their positions on a seamless white background. This is important because the image will be programmatically cropped into 9 equal parts, and any visible grid lines would become unwanted artifacts in the individual icon images.

The icons should represent:

"""

IMAGE_GEN_SUFFIX = """
[admin]
REMINDER — CRITICAL NON-NEGOTIABLE RULES:
- Do NOT render ANY text, letters, words, labels, titles, captions, or descriptions anywhere in the image. ONLY icon drawings and empty cells.
- Do NOT draw any grid lines, borders, gutters, or separators between cells. The grid must be invisible on a seamless white background.
"""

SPEC_PROMPT = """\
You are an expert icon design consultant. Create an icon set specification based on user input.

Analyze the input:
- Extract info about the business, audience, products, services, or features.
- If no icon style is mentioned, suggest a sensible default.
- If no icon list is provided, generate a relevant set of 9 icons.

Return a JSON object with this exact structure:

{
  "style": {
    "family": "outline",
    "size": "24px",
    "stroke": "2px",
    "colors": "monochrome, works on light/dark backgrounds"
  },
  "icons": [
    { "name": "batteryFull", "description": "Full battery, simple rectangular outline with positive terminal" },
    { "name": "chargingStation", "description": "Minimal outline of a charging station with cable" }
  ]
}

Rules:
- "name" must be camelCase (no spaces, no special characters)
- "description" is a short visual description of what to draw — describe the shapes, not abstract concepts
- Return exactly 9 icons in the "icons" array
- Return ONLY valid JSON, nothing else
"""

SYSTEM_PROMPT = """\
You are an expert SVG icon designer specializing in creating cohesive icon sets for websites and applications.

TASK:
For every request, you produce a series icons that share a unified design language.
Each icon in the series must serve a distinct purpose described by the user, yet all four must look like they belong to the same family.

DESIGN PRINCIPLES:
- Use a consistent style and proportions for all 4 icons.
- Make sure every icon is crisp and ready for production.

SVG REQUIREMENTS:
- Each SVG must use a 24x24 viewBox.
- No embedded raster images
- Unique descriptive `data-icon` attribute

REFERENCE EXAMPLES:

Example A — clean outlined icon:
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12.296 3.464 3.02 3.956"/><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m6.18 5.276 3.1 3.899"/></svg>

Example B — more complex duotone icon:
<svg xmlns="http://www.w3.org/2000/svg" width="800px" height="800px" viewBox="0 0 1024 1024" class="icon" version="1.1"><path d="M948.6 703c-13.8 0-20.7-9.8-25.7-17-5.1-7.3-7.7-10.2-12.7-10.2s-7.5 3-12.7 10.2c-5.1 7.2-12 17-25.7 17-13.8 0-20.7-9.8-25.7-17-5.1-7.3-7.7-10.2-12.7-10.2s-7.5 3-12.7 10.2c-5.1 7.2-12 17-25.7 17s-20.7-9.8-25.7-17c-5.1-7.3-7.7-10.2-12.7-10.2-4.4 0-8-3.6-8-8s3.6-8 8-8c13.8 0 20.7 9.8 25.7 17 5.1 7.3 7.7 10.2 12.7 10.2 5 0 7.5-3 12.7-10.2 5.1-7.2 12-17 25.7-17 13.8 0 20.7 9.8 25.7 17 5.1 7.3 7.7 10.2 12.7 10.2 5 0 7.5-3 12.7-10.2 5.1-7.2 12-17 25.7-17s20.7 9.8 25.7 17c5.1 7.3 7.7 10.2 12.7 10.2 4.4 0 8 3.6 8 8s-3.6 8-8 8z" fill="#9A2D2F"/><path d="M348.7 103.3m-32 0a32 32 0 1 0 64 0 32 32 0 1 0-64 0Z" fill="#FFEB4D"/><path d="M554.1 408.8c58.3 0 105.5-47.2 105.5-105.5s-47.2-105.5-105.5-105.5S448.6 245 448.6 303.3s47.2 105.5 105.5 105.5z" fill="#C0FCD0"/><path d="M330.6 627.3l224-324h-448z" fill="#FFFFFF"/><path d="M500.6 381.3h-340l170 246z" fill="#FFACC2"/></svg>

Study these examples and learn from them when creating the new icons.

---

IMPORTANT:
For every icon you about to create: always start with real SVG code that you know well. Use that as a starting point and modify it to create the new icon.
---

OUTPUT FORMAT:
Return SVG blocks, nothing else. No explanation, no markdown fences, no surrounding text.
Separate each SVG with a single blank line.
"""
