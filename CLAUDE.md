# Browser to ComfyUI Extension - AI Context

> Chrome extension for saving text prompts from websites and sending them to ComfyUI for AI image generation.

## Quick Reference

**Core Purpose**: Capture prompts from web pages → Send to ComfyUI → Track generation status

**Tech Stack**: TypeScript, Vite, Chrome Extension Manifest V3

**Default ComfyUI Server**: `http://192.168.50.143:8188`

## Architecture Overview

```
src/
├── background.ts      # Service worker: context menu, shortcuts, messaging
├── popup.ts           # Popup UI: 3-tab interface (History/Manual/Settings)
├── content.ts         # Content script: auto-detect prompts on pages
├── options.ts         # Options page (minimal, redirects to popup)
├── types.ts           # Interfaces, constants, defaults
├── utils.ts           # Storage helpers, API client, workflow builder
├── workflow-utils.ts  # Workflow import & mapping detection
└── workflows/
    ├── qwen-t2i-base.json      # Base text-to-image workflow
    └── qwen-t2i-upscale.json   # Upscale nodes (merged when enabled)
```

## Key Components

### Storage (Chrome APIs)

| Storage | Key | Content |
|---------|-----|---------|
| `sync` | `comfyuiSettings` | Settings (synced across devices) |
| `local` | `promptHistory` | Array of PromptEntry (max 50) |
| `local` | `autoDetectDomains` | Domains with auto-detect enabled |
| `local` | `importedWorkflows` | Custom workflow definitions |
| `local` | `activeWorkflowId` | Currently selected workflow |

### Message Types

| Message | Direction | Purpose |
|---------|-----------|---------|
| `INIT_AUTO_DETECT` | popup → content | Start detection with markers |
| `STOP_AUTO_DETECT` | popup → content | Stop detection |
| `AUTO_DETECTED_PROMPT` | content → background | Send detected prompt |

### ComfyUI Integration

**Endpoints Used:**
- `POST /prompt` - Submit workflow
- `GET /queue` - Check queue status
- `GET /history/{id}` - Get generation results
- `GET /view?filename=...` - Retrieve images
- `DELETE /queue` - Cancel pending
- `POST /interrupt` - Stop current

**Workflow Building** (`buildComfyUIWorkflow` in utils.ts):
1. Clone base workflow JSON
2. Apply dynamic parameters (seed, steps, cfg, prompt, etc.)
3. If upscale enabled: merge upscale nodes
4. Return formatted payload for `/prompt`

**Output Nodes**: 79 (regular), 81 (upscaled)

## Core Interfaces

```typescript
interface ComfyUISettings {
  serverAddress: string;      // Default: http://192.168.50.143:8188
  apiPath: string;            // Default: /prompt
  workflowId: string;
  autoSend: boolean;          // Generate on capture
  negativePrompt: string;
  seed: number;               // -1 for random
  steps: number;              // Default: 20
  cfg: number;                // Default: 4
  enableSeparator: boolean;   // Parse === delimiter
  aspectRatio: string;        // e.g., "16:9 ▭"
  megapixel: number;          // Default: 2.5
  enableUpscale: boolean;
  promptStartMarker: string;  // Default: [PROMPT START]
  promptEndMarker: string;    // Default: [PROMPT END]
}

interface PromptEntry {
  id: string;                 // UUID
  text: string;               // Prompt text
  createdAt: number;          // Timestamp
  imageStatus: 'pending' | 'generating' | 'done' | 'error';
  imageUrl?: string;          // Generated image URL
  promptId?: string;          // ComfyUI prompt_id
  generationCount?: number;   // Times regenerated
}

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

interface ImportedWorkflow {
  id: string;
  name: string;
  workflow: Record<string, WorkflowNode>;
  mappings: WorkflowMapping[];
  outputNodeId: string;
  createdAt: number;
}

type MappingType = 'prompt' | 'negativePrompt' | 'seed' | 'steps' | 'cfg' | 'aspectRatio' | 'megapixel' | 'outputImage';
```

## Prompt Detection System

### Auto-Detection Flow
1. User enables toggle for domain
2. `content.ts` injected via `chrome.scripting.executeScript()`
3. `PromptAutoDetector` receives `INIT_AUTO_DETECT` with marker settings
4. MutationObserver watches DOM (500ms debounce)
5. Prompts extracted between markers
6. Dedup check (case-insensitive Map)
7. Send to background via `AUTO_DETECTED_PROMPT`
8. Background checks against history, adds if new

### Extraction Logic
```typescript
// Find text between [PROMPT START] and [PROMPT END]
// Supports multiple prompts per page
// Deduplicated at content script and background levels
```

## Build Commands

```bash
npm run build   # Production build to dist/
npm run dev     # Watch mode for development
npm run clean   # Remove dist/ folder
```

## Workflow Updates

### Static Changes (node connections, models)
1. Export API workflow from ComfyUI
2. Replace `qwen-t2i-base.json` content
3. Keep placeholder values for dynamic params
4. Update `qwen-t2i-upscale.json` if upscale changed
5. Run `npm run build`

### Dynamic Parameter Changes
1. Add to `ComfyUIPayload` interface in `types.ts`
2. Add to `DEFAULT_SETTINGS` in `types.ts`
3. Apply in `buildComfyUIWorkflow()` in `utils.ts`
4. Add UI control in `popup.html` + `popup.ts`

### Node ID Reference

| Node | Parameter | Payload Field |
|------|-----------|---------------|
| 3 | seed, steps, cfg | `payload.seed/steps/cfg` |
| 105 | text | `payload.negativePrompt` |
| 118 | text | `payload.prompt` |
| 113 | ratio, Megapixel | `payload.aspectRatio/megapixel` |
| 83 | seed | Random (upscale sampler) |

## Feature Implementation Guide

### Adding a New Capture Method
1. Add trigger in `background.ts` (context menu, shortcut, etc.)
2. Call `addPromptEntry(text)` from `utils.ts`
3. If auto-send: call `sendToComfyUI(payload)`
4. History updates trigger popup refresh via storage listener

### Adding a New Settings Option
1. Add property to `ComfyUISettings` in `types.ts`
2. Set default in `DEFAULT_SETTINGS`
3. Add UI element in `popup.html` Settings tab
4. Wire up in `popup.ts` settings handling

### Extending Workflow Support
1. Create new JSON in `src/workflows/`
2. Add detection patterns in `workflow-utils.ts`
3. Extend `buildComfyUIWorkflow()` or create variant
4. Update UI for workflow selection

## Important Patterns

### Storage Locking
History updates use a lock mechanism to prevent race conditions:
```typescript
// Acquire lock → read history → modify → save → release lock
```

### Queue Synchronization
- Polls every 4 seconds when popup open
- Checks `/queue` for active generation
- Polls `/history/{id}` for completion
- 180 attempts max (~6 min timeout for upscale)

### Error Handling
- Graceful degradation if ComfyUI unavailable
- Network errors caught and logged
- Invalid workflows detected on import
- CSP violations handled for content script

## Aspect Ratio Constants

```typescript
const ASPECT_RATIOS = [
  '1:1 ◻', '5:4 ▭', '4:3 ▭', '3:2 ▭', '16:9 ▭', '2:1 ▭', '21:9 ▭', '32:9 ▭',
  '4:5 ▯', '3:4 ▯', '2:3 ▯', '9:16 ▯', '1:2 ▯', '9:21 ▯', '9:32 ▯'
];
```

## Testing Focus Areas

1. **Storage helpers**: getSettings, saveSettings, history CRUD
2. **API client**: sendToComfyUI, pollForImage, error handling
3. **Workflow builder**: parameter application, upscale merging
4. **Prompt extraction**: marker parsing, deduplication

## Common Modifications

### Change Default ComfyUI Server
Edit `DEFAULT_SETTINGS.serverAddress` in `types.ts`

### Add New Aspect Ratio
Add to `ASPECT_RATIOS` array in `types.ts`

### Modify Detection Markers
Change `promptStartMarker` / `promptEndMarker` in `DEFAULT_SETTINGS`

### Adjust Polling Behavior
- Queue sync interval: `popup.ts` (`setInterval` with 4000ms)
- Image poll interval: `utils.ts` (`pollForImage` with 2000ms)
- Max attempts: `utils.ts` (180 attempts)

## File Size Reference

| File | Lines | Purpose |
|------|-------|---------|
| popup.ts | ~826 | Main UI logic |
| popup.css | ~718 | Styling |
| utils.ts | ~373 | Core utilities |
| content.ts | ~308 | Auto-detection |
| workflow-utils.ts | ~216 | Workflow management |
| background.ts | ~138 | Service worker |
| types.ts | ~117 | Type definitions |
| popup.html | ~127 | UI structure |

## Documentation

- `DOCS.md` - Comprehensive documentation
- `docs/workflow-update-guide.md` - Workflow modification guide
- `docs/prompt-detection.md` - Detection system details
- `README.md` - Quick start guide
