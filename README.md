# Browser to ComfyUI Extension

A Chrome extension that allows you to save prompts from any website and send them to a local ComfyUI instance for image generation.

---

## Complete Asset Creation Workflow

This extension is part of a two-tool workflow for AI-generated stock content. Here's how the pieces fit together:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        COMPLETE WORKFLOW OVERVIEW                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. IDEATION & PROMPT CREATION (Browser)                                    │
│     ├── Chat with AI (Claude, ChatGPT, etc.) to develop ideas              │
│     ├── Research trends, search for details                                 │
│     └── AI outputs formatted prompts with [PROMPT START]...[PROMPT END]    │
│                                                                             │
│  2. PROMPT CAPTURE (This Extension)  ◄── YOU ARE HERE                      │
│     ├── Extension auto-detects prompts between markers                      │
│     ├── Prompts include title/keywords section (separated by ===)          │
│     └── Extension fires requests to ComfyUI API                            │
│                                                                             │
│  3. IMAGE GENERATION (ComfyUI)                                              │
│     ├── Receives workflow with prompt from extension                        │
│     ├── Generates images using loaded models                                │
│     └── Saves PNG files with embedded workflow metadata                     │
│                                                                             │
│  4. UPSCALING (Topaz Photo AI) [Manual Step]                               │
│     ├── Open generated PNGs in Topaz                                        │
│     ├── Upscale to higher resolution                                        │
│     └── Save with "-topaz-" suffix (enables auto-pairing)                  │
│                                                                             │
│  5. METADATA & UPLOAD (ComfyUI to Adobe Stock CSV App)                     │
│     ├── Scan folder → detects originals + upscales                         │
│     ├── Extract prompts from PNG metadata                                   │
│     ├── Generate Adobe Stock metadata via LM Studio                         │
│     ├── Optimize keywords with Google Trends                                │
│     ├── Export CSV + Upload via SFTP                                        │
│     └── Submit to Adobe Stock Contributor Portal                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Related Projects

| Project | Purpose | Location |
|---------|---------|----------|
| **Browser to ComfyUI Extension** | Captures prompts from browser, sends to ComfyUI | This project |
| **ComfyUI to Adobe Stock CSV** | Processes outputs, generates metadata, uploads | `comfy-folder-adobe-csv/` |

### Prompt Format Convention

When chatting with AI to create prompts, use this format:

```
[PROMPT START]
Title: Serene Mountain Lake at Golden Hour
Keywords: mountain, lake, sunset, nature, landscape, peaceful, reflection
===
A breathtaking view of a crystal clear mountain lake during golden hour,
with snow-capped peaks reflecting in the still water, warm orange and
pink clouds in the sky, photorealistic, 8k quality
[PROMPT END]
```

- **Markers**: `[PROMPT START]` and `[PROMPT END]` - detected by this extension
- **Title/Keywords**: Pre-fills metadata fields in the CSV app
- **Separator**: `===` divides metadata from generation prompt
- **Prompt**: The actual text sent to ComfyUI for image generation

### AI Chat Rules for Prompt Generation

When working with AI assistants, instruct them to:

1. **Use markers** - Wrap prompts with `[PROMPT START]` and `[PROMPT END]`
2. **Include metadata** - Add `Title:` and `Keywords:` lines at the top
3. **Use separator** - Place `===` between metadata and the actual prompt
4. **Be descriptive** - Include style, quality, and technical details in the prompt

---

## Features

- Context menu "Save as Prompt" for selected text
- Keyboard shortcut (Ctrl+Shift+P) to save selected text
- Auto-send option to immediately generate images
- Prompt history with image thumbnails
- Manual prompt input and generation
- Configurable ComfyUI settings

## Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the extension
4. Open Chrome and go to `chrome://extensions/`
5. Enable "Developer mode"
6. Click "Load unpacked" and select the `dist` folder

## Configuration

1. Click the extension icon and select "Options"
2. Set your ComfyUI server address (default: http://127.0.0.1:8188)
3. Configure the API path and workflow ID
4. Set default negative prompt and seed
5. Enable auto-send if desired

## Usage

### Saving Prompts
- Select text on any webpage
- Right-click and choose "Save as Prompt"
- Or use keyboard shortcut Ctrl+Shift+P (Cmd+Shift+P on Mac)

### Generating Images
- Click the extension icon to open the popup
- Use the textarea to edit or paste a prompt
- Click "Generate" to send to ComfyUI
- Or click "Send to ComfyUI" on any history entry

## ComfyUI Integration

This extension sends JSON payloads to your ComfyUI endpoint. You need to adapt the `buildComfyUIWorkflow` function in `src/utils.ts` to match your specific ComfyUI workflow structure.

The current placeholder structure is:
```json
{
  "workflow_id": "your_workflow_id",
  "prompt": "user_prompt",
  "negative_prompt": "negative_prompt",
  "seed": 12345
}
```

Update this to match your ComfyUI workflow JSON.

## Icons

You need to add icon files to the `icons/` directory:
- icon16.png (16x16)
- icon48.png (48x48)
- icon128.png (128x128)

## Development

- `npm run dev` - Build in watch mode
- `npm run build` - Production build
- `npm run clean` - Clean dist folder

## Testing

Add tests using Jest or Vitest. Focus on storage helpers, ComfyUI API client, and popup logic.

## License

MIT
