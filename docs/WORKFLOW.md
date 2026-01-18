# Complete Asset Creation Workflow

This document describes the end-to-end workflow for creating AI-generated stock images, from ideation to Adobe Stock submission.

---

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     AI STOCK IMAGE CREATION PIPELINE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 1: IDEATION & PROMPT CREATION                                 │   │
│  │ Tool: Browser + AI Chat (Claude, ChatGPT, etc.)                     │   │
│  │                                                                     │   │
│  │ • Research trends, search for market insights                       │   │
│  │ • Develop seed ideas into detailed prompts                          │   │
│  │ • AI outputs formatted prompts with metadata                        │   │
│  │ • Format: [PROMPT START]...[PROMPT END] with Title/Keywords/AR      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 2: PROMPT CAPTURE                                             │   │
│  │ Tool: Browser to ComfyUI Extension                                  │   │
│  │                                                                     │   │
│  │ • Auto-detects prompts between markers on chat page                 │   │
│  │ • Parses Title, Keywords, Aspect Ratio from prompt                  │   │
│  │ • Applies generation settings (steps, CFG, seed, megapixels)        │   │
│  │ • Fires request to ComfyUI API                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 3: IMAGE GENERATION                                           │   │
│  │ Tool: ComfyUI (Local Server)                                        │   │
│  │                                                                     │   │
│  │ • Receives workflow JSON with embedded prompt                       │   │
│  │ • Generates image using loaded models (Qwen, Flux, SDXL, etc.)     │   │
│  │ • Saves PNG with embedded workflow metadata                         │   │
│  │ • Workflow stored in PNG for later extraction                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 4: UPSCALING (Manual Step)                                    │   │
│  │ Tool: Topaz Photo AI                                                │   │
│  │                                                                     │   │
│  │ • Open generated PNGs in Topaz                                      │   │
│  │ • Apply upscaling (2x-4x resolution)                                │   │
│  │ • Save with "-topaz-" suffix for auto-pairing                       │   │
│  │ • Example: image.png → image-topaz-enhance.png                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 5: METADATA & UPLOAD                                          │   │
│  │ Tool: ComfyUI to Adobe Stock CSV App                                │   │
│  │                                                                     │   │
│  │ • Scan folder → detects originals + upscaled versions              │   │
│  │ • Extract prompts & pre-existing metadata from PNG                  │   │
│  │ • Generate Adobe Stock metadata via LM Studio (vision model)        │   │
│  │ • Optimize keywords with Google Trends intelligence                 │   │
│  │ • Export CSV in Adobe Stock format                                  │   │
│  │ • Upload images via SFTP to Adobe Stock                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ STAGE 6: SUBMISSION                                                 │   │
│  │ Tool: Adobe Stock Contributor Portal                                │   │
│  │                                                                     │   │
│  │ • Navigate to Uploaded Files → New                                  │   │
│  │ • Upload CSV to match with SFTP-uploaded images                     │   │
│  │ • Review and submit for approval                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tools & Projects

| Stage | Tool | Project Location | Build System |
|-------|------|------------------|--------------|
| 1 | AI Chat | External (Claude, ChatGPT) | N/A |
| 2 | Browser Extension | `browser-to-comfyui-extension/` | npm + TypeScript |
| 3 | ComfyUI | External (local server) | Python |
| 4 | Topaz Photo AI | External (desktop app) | N/A |
| 5 | CSV App | `comfy-folder-adobe-csv/` | Python + PyWebView |
| 6 | Adobe Portal | External (web) | N/A |

---

## Data Flow

### What Gets Transferred Between Stages

```
Stage 1 → Stage 2:
├── Prompt text (full generation prompt)
├── Title (for stock metadata)
├── Keywords (for stock metadata)
└── Aspect Ratio (for image dimensions)

Stage 2 → Stage 3:
├── Prompt (injected into workflow node)
├── Negative prompt (from settings)
├── Aspect ratio → width/height calculation
├── Seed, Steps, CFG (from settings)
└── Megapixels (resolution setting)

Stage 3 → Stage 4:
└── PNG file with embedded workflow JSON
    ├── All prompt text preserved
    ├── Node configurations
    └── LiteGraph visual data

Stage 4 → Stage 5:
├── Original PNG (with metadata)
└── Upscaled PNG (linked by filename pattern)

Stage 5 → Stage 6:
├── Upscaled images (via SFTP)
└── CSV file (via web upload)
    ├── Filename
    ├── Title (40-70 chars)
    ├── Keywords (up to 49)
    ├── Category ID (1-21)
    └── File Type (Photo/Illustration)
```

---

## Prompt Format Specification

See [PROMPT_FORMAT.md](./PROMPT_FORMAT.md) for detailed prompt format specification.

### Quick Reference

```
[PROMPT START]
Title: Descriptive Title for Adobe Stock (40-70 chars)
Keywords: keyword1, keyword2, keyword3, keyword4, keyword5
Aspect Ratio: 16:9
===
The actual generation prompt goes here. This text is sent to ComfyUI
for image generation. Include style, quality, and technical details.
[PROMPT END]
```

---

## Stage-by-Stage Details

### Stage 1: Ideation & Prompt Creation

**Purpose:** Develop marketable image concepts with complete metadata.

**Process:**
1. Start a chat with an AI assistant (Claude, ChatGPT, etc.)
2. Provide the AI with prompt format rules (see [AI_CHAT_TEMPLATE.txt](./AI_CHAT_TEMPLATE.txt))
3. Discuss ideas, trends, market research
4. Ask AI to generate formatted prompts
5. Review and refine prompts

**Tips:**
- Research current stock photography trends
- Consider seasonal content (holidays, events)
- Think about commercial use cases
- Ask AI to suggest aspect ratios based on content

### Stage 2: Prompt Capture

**Purpose:** Transfer prompts from browser to ComfyUI for generation.

**Process:**
1. Enable auto-detect in extension for your AI chat domain
2. Extension monitors page for `[PROMPT START]...[PROMPT END]` markers
3. When detected, prompt is captured and optionally auto-sent
4. Extension parses metadata (Title, Keywords, Aspect Ratio)
5. Workflow request sent to ComfyUI API

**Configuration:**
- ComfyUI server address (default: `http://192.168.50.143:8188`)
- Generation settings (steps, CFG, seed, megapixels)
- Upscale toggle (enable 4x upscaling in ComfyUI)
- Markers (customizable start/end markers)

### Stage 3: Image Generation

**Purpose:** Generate images using AI models.

**Process:**
1. ComfyUI receives workflow JSON
2. Model processes prompt through configured nodes
3. Image generated at specified resolution
4. PNG saved with embedded workflow metadata

**Output Location:**
- ComfyUI output folder (configurable in ComfyUI settings)
- Default: `ComfyUI/output/`

### Stage 4: Upscaling

**Purpose:** Increase resolution for stock submission requirements.

**Process:**
1. Open generated PNGs in Topaz Photo AI
2. Apply enhancement and upscaling
3. Save with `-topaz-` suffix in filename

**Naming Convention:**
```
Original:  landscape_sunset_001.png
Upscaled:  landscape_sunset_001-topaz-enhance.png
```

**Supported Suffixes (auto-detected by CSV app):**
- `-topaz-*`, `_topaz_*`
- `-upscale*`, `_upscale*`
- `-2x*`, `_2x*`, `-4x*`, `_4x*`

### Stage 5: Metadata & Upload

**Purpose:** Generate stock metadata and submit to Adobe.

**Process:**
1. Open CSV app, select folder with images
2. Click Scan to detect originals + upscales
3. Generate metadata using LM Studio (batch or individual)
4. Review and edit metadata as needed
5. Optimize keywords with Google Trends
6. Export CSV
7. Upload images via SFTP

**Requirements:**
- LM Studio running with vision model (qwen3-vl-32b-instruct)
- Adobe Stock SFTP credentials configured

### Stage 6: Submission

**Purpose:** Complete Adobe Stock submission.

**Process:**
1. Log into Adobe Stock Contributor Portal
2. Navigate to: Uploaded Files → New
3. Upload the exported CSV file
4. Match CSV with SFTP-uploaded images
5. Review and submit for approval

---

## Troubleshooting

### Extension Not Detecting Prompts
- Check markers match exactly: `[PROMPT START]` and `[PROMPT END]`
- Ensure auto-detect is enabled for the domain
- Check that content script is loaded (refresh page)

### ComfyUI Connection Failed
- Verify ComfyUI server is running
- Check server address in extension settings
- Ensure firewall allows connection

### Upscales Not Paired
- Verify filename follows pattern: `original-topaz-*.png`
- Keep original and upscale in same folder
- Re-scan folder after adding upscales

### Metadata Generation Fails
- Ensure LM Studio is running
- Check model is loaded in LM Studio
- Verify LM Studio URL in settings

### SFTP Upload Fails
- Test connection in settings first
- Verify credentials (username + generated SFTP password)
- Note: Password is NOT your Adobe account password

---

## Related Documentation

- [PROMPT_FORMAT.md](./PROMPT_FORMAT.md) - Detailed prompt format specification
- [AI_CHAT_TEMPLATE.txt](./AI_CHAT_TEMPLATE.txt) - Template for AI assistant instructions
- [prompt-detection.md](./prompt-detection.md) - Technical details of prompt detection
- [workflow-update-guide.md](./workflow-update-guide.md) - How to update ComfyUI workflows

---

*Last updated: January 2025*
