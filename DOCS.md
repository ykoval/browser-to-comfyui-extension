# Browser to ComfyUI Extension - Documentation

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Features](#features)
4. [Architecture](#architecture)
5. [User Interface](#user-interface)
6. [Configuration](#configuration)
7. [ComfyUI Integration](#comfyui-integration)
8. [Prompt Detection System](#prompt-detection-system)
9. [Workflow Management](#workflow-management)
10. [API Reference](#api-reference)
11. [Development Guide](#development-guide)
12. [Troubleshooting](#troubleshooting)

---

## Overview

**Browser to ComfyUI Extension** is a Chrome extension that enables users to capture text prompts from any website and send them to a local ComfyUI instance for AI image generation.

### Key Capabilities

- **Multiple Capture Methods**: Context menu, keyboard shortcuts, auto-detection, manual input
- **Real-time Generation Tracking**: Live status updates with image thumbnails
- **Workflow Flexibility**: Support for custom ComfyUI workflows with parameter mapping
- **Domain-specific Settings**: Enable/disable auto-detection per website
- **History Management**: Track up to 50 prompts with generation status

---

## Installation

### Prerequisites

- Google Chrome browser (or Chromium-based browser)
- Node.js and npm installed
- ComfyUI server running locally or on network

### Steps

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd browser-to-comfyui-extension
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run build
   ```

4. **Load in Chrome**
   - Open `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the project root folder (contains `manifest.json`)

5. **Configure ComfyUI server**
   - Click extension icon
   - Go to Settings tab
   - Set your ComfyUI server address (default: `http://127.0.0.1:8188`)

---

## Features

### 1. Prompt Capture Methods

#### Context Menu
- Select text on any webpage
- Right-click → "Save as Prompt"
- Prompt saved to history immediately

#### Keyboard Shortcut
- **Windows/Linux**: `Ctrl+Shift+P`
- **macOS**: `Cmd+Shift+P`
- Captures currently selected text

#### Manual Input
- Open popup → Manual tab
- Type or paste prompt in textarea
- Click "Generate" to send to ComfyUI

#### Auto-Detection
- Enable per-domain via popup toggle
- Scans page for text between configurable markers
- Default markers: `[PROMPT START]` / `[PROMPT END]`
- Continuously monitors DOM changes

#### Page Scan
- One-time scan of current page
- Extracts all prompts between markers
- Click "Scan Page" in History tab

#### Paste & Scan
- Paste text containing multiple prompts
- Extension extracts all prompts automatically
- Useful for batch import

### 2. Image Generation

| Feature | Description |
|---------|-------------|
| **Direct Send** | Click "Send" on any prompt to generate |
| **Auto-Send** | Enable to generate immediately on capture |
| **Regenerate** | Generate same prompt multiple times |
| **Cancel** | Stop ongoing generation in queue |
| **Queue Sync** | Real-time status from ComfyUI (4-second polling) |

### 3. Generation Parameters

| Parameter | Range/Options | Default |
|-----------|---------------|---------|
| Seed | -1 (random) or any integer | -1 |
| Steps | 1-100 | 20 |
| CFG Scale | 1-30 | 4 |
| Aspect Ratio | 15 presets (see below) | 16:9 |
| Megapixels | 0.5-4.0 | 2.5 |
| Upscale | Enable/Disable | Disabled |

**Aspect Ratio Presets:**

Landscape: `1:1`, `5:4`, `4:3`, `3:2`, `16:9`, `2:1`, `21:9`, `32:9`
Portrait: `4:5`, `3:4`, `2:3`, `9:16`, `1:2`, `9:21`, `9:32`

### 4. History Features

- **50 Entry Limit**: Oldest entries removed automatically
- **Thumbnails**: 48x48 clickable image previews
- **Status Badges**: pending/generating/done/error
- **Timestamps**: Relative time display ("5 min ago")
- **Actions**: Send, Regenerate (with count), Delete

---

## Architecture

### File Structure

```
browser-to-comfyui-extension/
├── manifest.json            # Chrome extension manifest (v3)
├── popup.html               # Main popup UI (420x580px)
├── popup.css                # Dark theme styling
├── options.html             # Options page
├── package.json             # Dependencies & scripts
├── vite.config.ts           # Build configuration
├── tsconfig.json            # TypeScript config
├── icons/                   # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── src/
│   ├── background.ts        # Service worker
│   ├── popup.ts             # Popup UI logic
│   ├── content.ts           # Content script (auto-detect)
│   ├── options.ts           # Options page logic
│   ├── types.ts             # TypeScript interfaces
│   ├── utils.ts             # Shared utilities
│   ├── workflow-utils.ts    # Workflow management
│   └── workflows/
│       ├── qwen-t2i-base.json      # Base workflow
│       └── qwen-t2i-upscale.json   # Upscale nodes
├── docs/
│   ├── workflow-update-guide.md
│   └── prompt-detection.md
└── dist/                    # Built files (generated)
```

### Component Responsibilities

| Component | File | Purpose |
|-----------|------|---------|
| **Service Worker** | `background.ts` | Context menu, shortcuts, message handling |
| **Popup** | `popup.ts` | UI logic, history, settings, generation |
| **Content Script** | `content.ts` | Auto-detection on web pages |
| **Options** | `options.ts` | Minimal options page |
| **Types** | `types.ts` | TypeScript interfaces & constants |
| **Utilities** | `utils.ts` | Storage, API client, workflow builder |
| **Workflow Utils** | `workflow-utils.ts` | Workflow import & mapping |

### Message Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Message Passing                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Popup ──(toggle auto-detect)──> inject content.js              │
│                                                                 │
│  Content Script ──(AUTO_DETECTED_PROMPT)──> Background          │
│                                                                 │
│  Background ──(storage update)──> Popup (storage listener)      │
│                                                                 │
│  Popup ──(fetch)──> ComfyUI Server ──(response)──> Popup        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Storage Architecture

| Storage Type | Key | Purpose |
|--------------|-----|---------|
| `chrome.storage.sync` | `comfyuiSettings` | Settings (synced across devices) |
| `chrome.storage.local` | `promptHistory` | Prompt history (device-specific) |
| `chrome.storage.local` | `activeTab` | Current popup tab |
| `chrome.storage.local` | `autoDetectDomains` | Enabled domains list |
| `chrome.storage.local` | `importedWorkflows` | Custom workflows |
| `chrome.storage.local` | `activeWorkflowId` | Selected workflow |

---

## User Interface

### Popup Layout (420x580px)

```
┌────────────────────────────────────────┐
│  [History] [Manual] [Settings]         │  ← Tab navigation
├────────────────────────────────────────┤
│                                        │
│  Tab Content Area                      │
│                                        │
│  - History: Prompt list with actions   │
│  - Manual: Textarea + generate button  │
│  - Settings: Configuration options     │
│                                        │
└────────────────────────────────────────┘
```

### Visual Theme

- **Background**: `#1a1a2e` (dark blue-black)
- **Primary**: `#ff2e97` (neon pink)
- **Secondary**: `#00ff88` (neon green)
- **Accent**: `#00f5d4` (cyan)
- **Effects**: Glowing borders, smooth transitions

### History Item Structure

```
┌─────────────────────────────────────────────────────────────┐
│ [Thumbnail]  Prompt text (truncated to 2 lines)...         │
│   48x48      ○ Status Badge    ⏱ 5 min ago                 │
│              [Cancel] [Regenerate (3)] [Delete]            │
└─────────────────────────────────────────────────────────────┘
```

---

## Configuration

### Settings Reference

| Setting | Description | Default |
|---------|-------------|---------|
| `serverAddress` | ComfyUI server URL | `http://127.0.0.1:8188` |
| `apiPath` | API endpoint path | `/prompt` |
| `autoSend` | Generate on capture | `false` |
| `negativePrompt` | Default negative prompt | `"dust, dots, stain"` |
| `seed` | Random seed (-1 = random) | `-1` |
| `steps` | Sampling steps | `20` |
| `cfg` | CFG scale | `4` |
| `enableSeparator` | Parse title/keywords with `===` | `true` |
| `aspectRatio` | Image aspect ratio | `"16:9 ▭"` |
| `megapixel` | Image resolution | `2.5` |
| `enableUpscale` | Enable upscale nodes | `false` |
| `promptStartMarker` | Auto-detect start marker | `"[PROMPT START]"` |
| `promptEndMarker` | Auto-detect end marker | `"[PROMPT END]"` |

### Accessing Settings

**Via Popup:**
1. Click extension icon
2. Select "Settings" tab
3. Modify values
4. Changes save automatically

**Via Options Page:**
1. Right-click extension icon
2. Select "Options"
3. Minimal interface redirects to popup

---

## ComfyUI Integration

### Connection

The extension communicates with ComfyUI via HTTP REST API:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/prompt` | POST | Submit workflow for generation |
| `/queue` | GET | Check queue status |
| `/history/{id}` | GET | Get generation results |
| `/view` | GET | Retrieve generated images |
| `/queue` | DELETE | Cancel pending items |
| `/interrupt` | POST | Stop current generation |

### Workflow Structure

**Base Workflow Nodes** (`qwen-t2i-base.json`):

| Node ID | Class Type | Purpose |
|---------|------------|---------|
| 3 | KSampler | Main sampling (seed, steps, cfg) |
| 6 | CLIPTextEncode | Positive prompt encoding |
| 105 | CLIPTextEncode | Negative prompt encoding |
| 118 | AGSoftTextSplit | Text splitting by `===` |
| 103 | CLIPLoaderMultiGPU | CLIP model (cuda:0) |
| 104 | UNETLoaderMultiGPU | UNet model (cuda:1) |
| 113 | Ratio to Size | Aspect ratio → dimensions |
| 114 | EmptyLatentImage | Initial latent |
| 8 | VAEDecode | Decode to image |
| 79 | SaveImage | Output node |

**Upscale Nodes** (`qwen-t2i-upscale.json`):

| Node ID | Class Type | Purpose |
|---------|------------|---------|
| 81 | SaveImage | Upscaled output |
| 83 | KSampler | Refinement sampling |
| 85 | UpscaleModelLoader | 4x upscale model |
| 86 | ImageUpscaleWithModel | Apply upscale |
| 87 | ImageScaleBy | Scale back (0.25x) |
| 88 | VAEDecode | Decode refined latent |
| 90 | VAEEncode | Encode upscaled to latent |

### Dynamic Parameters

Parameters applied by `buildComfyUIWorkflow()`:

```typescript
workflow["3"].inputs.seed = payload.seed;      // Random if -1
workflow["3"].inputs.steps = payload.steps;
workflow["3"].inputs.cfg = payload.cfg;
workflow["105"].inputs.text = payload.negativePrompt;
workflow["118"].inputs.text = payload.prompt;
workflow["113"].inputs.ratio = payload.aspectRatio;
workflow["113"].inputs.Megapixel = payload.megapixel;
```

### Image Retrieval

After generation completes:

```typescript
// Construct image URL from history response
const imageUrl = `${serverAddress}/view?filename=${filename}&subfolder=${subfolder}&type=${type}`;
```

---

## Prompt Detection System

### Detection Modes

#### Manual Scan
- Triggered by "Scan Page" button
- Executes script on active tab
- Extracts text between markers from `document.body.innerText`
- One-time operation

#### Auto-Detect (Continuous)
- Enabled per-domain via toggle
- Injects `content.ts` into page
- MutationObserver watches DOM changes
- 500ms debounce prevents excessive scanning
- Floating indicator shows detection count

### Extraction Algorithm

```typescript
function extractPrompts(text: string): string[] {
  const prompts: string[] = [];
  let searchStart = 0;

  while (searchStart < text.length) {
    const startIndex = text.indexOf(startMarker, searchStart);
    if (startIndex === -1) break;

    const contentStart = startIndex + startMarker.length;
    const endIndex = text.indexOf(endMarker, contentStart);
    if (endIndex === -1) break;

    const promptText = text.substring(contentStart, endIndex).trim();
    prompts.push(promptText);
    searchStart = endIndex + endMarker.length;
  }

  return prompts;
}
```

### Deduplication

Two-level duplicate prevention:

1. **Content Script Level**: Map with normalized (lowercase) keys
2. **Background Level**: Check against stored history

### Visual Indicator

When auto-detect is active:

- Floating draggable badge appears on page
- Shows count of detected prompts
- Pulsing animation on new detection
- Click to trigger manual re-scan
- CSS injected by content script

### Restricted Domains

Auto-detect disabled on:
- `chrome://`
- `chrome-extension://`
- `about:`
- `edge://`
- `brave://`
- `file://`

---

## Workflow Management

### Importing Custom Workflows

1. Export workflow from ComfyUI (API format JSON)
2. Open extension Settings tab
3. Click "Import Workflow"
4. Select JSON file
5. Review auto-detected mappings
6. Edit mappings if needed
7. Save and activate

### Auto-Detection

The system identifies common node types:

| Class Type | Detected As |
|------------|-------------|
| CLIPTextEncode | Prompt or Negative Prompt |
| KSampler | Seed, Steps, CFG |
| SaveImage | Output Node |
| PreviewImage | Output Node |
| Ratio to Size | Aspect Ratio |
| AGSoftTextSplit | Prompt Input |

### Mapping Editor

For each parameter type, specify:
- **Node ID**: Which node to apply to
- **Input Key**: Property name (e.g., "text", "seed")
- **Confidence**: Auto-detection confidence level

### Workflow Data Structure

```typescript
interface ImportedWorkflow {
  id: string;                              // UUID
  name: string;                            // Display name
  workflow: Record<string, WorkflowNode>;  // Node definitions
  mappings: WorkflowMapping[];             // Parameter mappings
  outputNodeId: string;                    // Image output node
  createdAt: number;                       // Timestamp
}

interface WorkflowMapping {
  type: MappingType;    // 'prompt' | 'seed' | 'steps' | etc.
  nodeId: string;       // Target node ID
  inputKey: string;     // Input property name
}
```

---

## API Reference

### TypeScript Interfaces

```typescript
// Settings stored in chrome.storage.sync
interface ComfyUISettings {
  serverAddress: string;
  apiPath: string;
  workflowId: string;
  autoSend: boolean;
  negativePrompt: string;
  seed: number;
  steps: number;
  cfg: number;
  headers: Record<string, string>;
  enableSeparator: boolean;
  aspectRatio: string;
  megapixel: number;
  enableUpscale: boolean;
  promptStartMarker: string;
  promptEndMarker: string;
}

// Individual prompt entry
interface PromptEntry {
  id: string;
  text: string;
  createdAt: number;
  imageStatus: 'pending' | 'generating' | 'done' | 'error';
  imageUrl?: string;
  promptId?: string;
  generationCount?: number;
}

// Payload sent to ComfyUI
interface ComfyUIPayload {
  prompt: string;
  negativePrompt: string;
  seed: number;
  steps: number;
  cfg: number;
  aspectRatio: string;
  megapixel: number;
  enableUpscale: boolean;
}

// Response from ComfyUI /prompt endpoint
interface ComfyUIResponse {
  prompt_id: string;
  number: number;
  node_errors: Record<string, unknown>;
}
```

### Utility Functions

```typescript
// Storage
getSettings(): Promise<ComfyUISettings>
saveSettings(settings: Partial<ComfyUISettings>): Promise<void>
getHistory(): Promise<PromptEntry[]>
addPromptEntry(text: string): Promise<PromptEntry>
updatePromptEntry(id: string, updates: Partial<PromptEntry>): Promise<void>
deletePromptEntry(id: string): Promise<void>

// Auto-detect
getAutoDetectDomains(): Promise<string[]>
toggleAutoDetect(domain: string, enabled: boolean): Promise<void>

// ComfyUI
buildComfyUIWorkflow(payload: ComfyUIPayload): Record<string, unknown>
sendToComfyUI(payload: ComfyUIPayload): Promise<ComfyUIResponse>
pollForImage(promptId: string): Promise<string | null>
```

### Message Types

| Type | Direction | Data |
|------|-----------|------|
| `INIT_AUTO_DETECT` | popup → content | `{ settings: MarkerSettings }` |
| `STOP_AUTO_DETECT` | popup → content | none |
| `AUTO_DETECTED_PROMPT` | content → background | `{ text: string }` |

---

## Development Guide

### Build Commands

```bash
npm run build   # Production build to dist/
npm run dev     # Watch mode for development
npm run clean   # Remove dist/ folder
```

### Development Workflow

1. Run `npm run dev` for watch mode
2. Make changes to source files
3. Vite rebuilds automatically
4. Reload extension in Chrome (`chrome://extensions/` → Reload)

### Build Configuration

**Vite Config** (`vite.config.ts`):
- Multi-entry build: background, popup, options, content
- ES module output
- Build timestamp injection via `define`

**TypeScript Config** (`tsconfig.json`):
- Target: ES2020
- Strict mode enabled
- DOM and Chrome types included

### Adding New Features

#### New Dynamic Parameter

1. Add to `ComfyUIPayload` interface in `types.ts`
2. Add to `DEFAULT_SETTINGS` in `types.ts`
3. Update `buildComfyUIWorkflow()` in `utils.ts`
4. Add UI control in `popup.html` and `popup.ts`

#### New Workflow Type

1. Create JSON template in `src/workflows/`
2. Add selection UI in popup
3. Extend `buildComfyUIWorkflow()` or create new builder
4. Update mapping detection in `workflow-utils.ts`

### Testing Recommendations

Focus areas:
- Storage helpers (getSettings, saveSettings, etc.)
- ComfyUI API client (error handling, response parsing)
- Workflow builder (parameter application)
- Prompt extraction algorithm

---

## Troubleshooting

### Common Issues

#### Extension Not Loading
- Check `manifest.json` syntax
- Ensure `dist/` folder has built files
- Verify all icon files exist in `icons/`

#### ComfyUI Connection Failed
- Verify server is running
- Check server address in settings
- Ensure host permissions in manifest match server URL
- Check browser console for CORS errors

#### Auto-Detect Not Working
- Verify domain is not restricted
- Check marker configuration matches page content
- Look for content script errors in page console
- Ensure domain toggle is enabled

#### Images Not Loading
- Check CSP settings in manifest
- Verify ComfyUI server address in img-src
- Check network tab for blocked requests

#### Queue Status Not Updating
- Confirm ComfyUI server accessible
- Check for network errors in console
- Verify polling interval (4 seconds)

### Debug Logging

Enable verbose logging:
1. Open Chrome DevTools on popup
2. Check Console tab for errors
3. For content script: Open DevTools on target page

### Reset Extension

1. Go to `chrome://extensions/`
2. Remove extension
3. Clear storage: `chrome.storage.local.clear()`
4. Reload unpacked extension

---

*Documentation generated for Browser to ComfyUI Extension v1.0.0*
