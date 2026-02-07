# Browser to ComfyUI Extension - AI Context

> Chrome extension for saving text prompts from websites and sending them to ComfyUI for AI image generation.

## Quick Reference

**Core Purpose**: Capture prompts from web pages → Send to ComfyUI → Track generation status

**Tech Stack**: TypeScript, Vite, Chrome Extension Manifest V3

**Default ComfyUI Server**: `http://192.168.50.143:8188`

## Architecture Overview

```
src/
├── background.ts      # Service worker: alarm-based generation orchestrator
├── popup.ts           # Popup UI: 3-tab interface (read-only view, sends messages to background)
├── content.ts         # Content script: auto-detect prompts on pages
├── options.ts         # Options page (minimal, redirects to popup)
├── types.ts           # Interfaces, constants, defaults
├── utils.ts           # Storage helpers, API client, workflow builder
├── workflow-utils.ts  # Workflow import & mapping detection
└── workflows/
    ├── qwen-t2i-base.json           # Base T2I workflow (KSampler upscale)
    ├── qwen-t2i-upscale.json        # KSampler upscale nodes
    ├── qwen-t2i-litegraph.json      # LiteGraph format for PNG embedding
    ├── qwen-t2i-seedvr-base.json    # Base T2I workflow (SeedVR)
    ├── qwen-t2i-seedvr-upscale.json # SeedVR2 upscale nodes (for merge into base)
    ├── seedvr-upscale-standalone.json # SeedVR2 standalone upscale (two-stage, LoadImage entry)
    └── qwen-t2i-seedvr-litegraph.json # SeedVR LiteGraph format
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
| `START_GENERATION` | popup → background | Request generation (entryId, text, isRegenerate?) |
| `CANCEL_GENERATION` | popup → background | Cancel generation (entryId, promptId) |
| `OPEN_POPUP` | popup → background | Open extension popup |

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
2. Apply dynamic parameters (seed, steps, cfg, prompt, aspect ratio, megapixels)
3. Compute div-112 fallback dimensions via `computeDimensionsForRatio()`
4. For qwen-t2i: merge KSampler upscale nodes (single-stage)
5. For qwen-t2i-seedvr: base-only (NO upscale merge — two-stage to avoid OOM)
6. Return formatted payload for `/prompt`

**SeedVR Two-Stage Execution** (avoids OOM on cuda:1):
1. Stage 1: Submit base workflow → poll node 79 for smoothed base image
2. Fetch base image from ComfyUI, upload to `/upload/image` (input folder)
3. Stage 2: Submit standalone SeedVR upscale workflow with LoadImage node → poll node 81
4. Reason: QwenImage UNET (~19GB on cuda:1) must unload before SeedVR models can load

**Smoothing Pipeline** (both workflows):
- Node 203: Median Blur (size=2) — reduces Qwen's hard contrast edges
- Node 204: SkinBeauty (smooth=8, opacity=50%) — softens faces before SeedVR2 upscale
- Pipeline: VAEDecode (8) → Median Blur (203) → SkinBeauty (204) → SaveImage (79)

**Output Nodes**: 79 (regular), 81 (upscaled)

## Core Interfaces

```typescript
interface ComfyUISettings {
  serverAddress: string;      // Default: http://192.168.50.143:8188
  apiPath: string;            // Default: /prompt
  workflowId: string;
  builtInWorkflow: BuiltInWorkflowType; // 'qwen-t2i' | 'qwen-t2i-seedvr'
  autoSend: boolean;          // Generate on capture
  negativePrompt: string;
  seed: number;               // -1 for random
  steps: number;              // Default: 20
  cfg: number;                // Default: 4
  enableSeparator: boolean;   // Parse === delimiter
  aspectRatio: string;        // e.g., "16:9 ▭"
  megapixel: number;          // Default: 2.5
  promptStartMarker: string;  // Default: [PROMPT START]
  promptEndMarker: string;    // Default: [PROMPT END]
}

type GenerationStage = 'polling-base' | 'uploading-upscale' | 'polling-upscale';

interface PromptEntry {
  id: string;                 // UUID
  text: string;               // Prompt text
  createdAt: number;          // Timestamp
  imageStatus: 'pending' | 'generating' | 'done' | 'error';
  imageUrl?: string;          // Generated image URL
  promptId?: string;          // ComfyUI prompt_id (updates: base → upscale for SeedVR)
  generationCount?: number;   // Times regenerated
  // Alarm-based orchestration fields (set by background service worker)
  generationStage?: GenerationStage;    // Current stage in pipeline
  basePromptId?: string;                // Original prompt_id (preserved during SeedVR upscale)
  pollAttempts?: number;                // Alarm ticks spent polling
  workflowType?: BuiltInWorkflowType;  // Workflow used (needed after SW restart)
}

interface ComfyUIPayload {
  prompt: string;
  negativePrompt: string;
  seed: number;
  steps: number;
  cfg: number;
  aspectRatio: string;
  megapixel: number;
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

### Node ID Reference (Both Workflows)

| Node | Parameter | Payload Field |
|------|-----------|---------------|
| 3 | seed, steps, cfg | `payload.seed/steps/cfg` |
| 105 | text | `payload.negativePrompt` |
| 118 | text | `payload.prompt` |
| 114 | aspect_ratio, megapixels, width, height, preset | `payload.aspectRatio/megapixel` |
| 203 | Median Blur (size=2) | Static — smoothing pipeline |
| 204 | SkinBeauty (smooth=8, opacity=50%) | Static — smoothing pipeline |
| 79 | SaveImage (from node 204) | Regular output (smoothed) |
| 81 | SaveImage | Upscaled output |

### KSampler Upscale Nodes (qwen-t2i)
| Node | Purpose |
|------|---------|
| 83 | KSampler for upscale (random seed) |

### SeedVR Upscale Nodes (qwen-t2i-seedvr, two-stage standalone)
| Node | Purpose | Constraints |
|------|---------|-------------|
| 200 | LoadImage (base output) | Standalone entry point |
| 120 | cleanGpuUsed (from node 200) | Input: uploaded base image |
| 121 | ImageScaleBy (0.5x) | |
| 122 | SeedVR2LoadDiTModel | cuda:1 |
| 123 | SeedVR2LoadVAEModel | cuda:1 |
| 124 | SeedVR2VideoUpscaler | seed max: 4294967295, color_correction: "lab" |
| 125 | VRAMCleanup | |
| 126 | RAMCleanup | |
| 127 | LayerColor: AutoAdjustV2 | |

## Feature Implementation Guide

### Adding a New Capture Method
1. Add trigger in `background.ts` (context menu, shortcut, etc.)
2. Call `addPromptEntry(text)` from `utils.ts`
3. If auto-send: call `startGeneration(entryId, text)` in background.ts
4. History updates trigger popup refresh via `chrome.storage.local.onChanged`

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

### Generation Orchestration (Alarm-Based)

**Architecture**: `background.ts` is the sole generation orchestrator. Popup sends messages, background handles everything.

```
popup.ts ──message──→ background.ts ──fetch──→ ComfyUI
   ↑                      │
   └──storage.onChanged───┘  (chrome.storage.local)
```

**Alarm-based polling** (survives popup closure + service worker suspension):
- Uses `chrome.alarms` with 30-second intervals (Chrome minimum)
- Alarm name: `poll-generations`
- Alarm auto-created when generation starts, auto-cleared when no in-flight entries
- Service worker startup recovery: re-establishes alarm if `generating` entries exist

**State machine** (per PromptEntry):
- `polling-base` → check node 79 for base image (SeedVR only)
- `uploading-upscale` → upload base image + submit SeedVR upscale workflow
- `polling-upscale` → check node 81 for upscaled output (both workflows)

**Timeout limits**:
- Standard qwen-t2i: 12 ticks × 30s = 6 minutes
- SeedVR base polling: 6 ticks × 30s = 3 minutes
- SeedVR upscale polling: 12 ticks × 30s = 6 minutes

**Quick first check**: `setTimeout(() => handleAlarmTick(), 5000)` after submission for fast-completing workflows.

### Image Check Functions (Non-Blocking)
- `checkHistoryForUpscaledImage(promptId, settings)` — single fetch, checks node 81, fallback to 79
- `checkHistoryForBaseImage(promptId, settings)` — single fetch, checks node 79
- `sendSeedVRUpscale(baseImageInfo, settings)` — uploads base image + submits standalone upscale
- Returns `HistoryCheckResult { status: 'ready' | 'waiting' | 'error', imageUrl?, imageInfo? }`

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

## Built-in Workflows

| ID | Name | Upscaler | Description |
|----|------|----------|-------------|
| `qwen-t2i` | Qwen T2I | KSampler | Standard upscale, faster |
| `qwen-t2i-seedvr` | Qwen T2I + SeedVR | SeedVR2VideoUpscaler | Higher quality, slower |

Selection via `builtInWorkflow` setting in UI dropdown.
Upscale is always enabled — qwen-t2i merges upscale in single prompt, qwen-t2i-seedvr uses two-stage execution (separate prompts) to avoid OOM.

## Common Modifications

### Change Default ComfyUI Server
Edit `DEFAULT_SETTINGS.serverAddress` in `types.ts`

### Add New Aspect Ratio
Add to `ASPECT_RATIOS` array in `types.ts`

### Modify Detection Markers
Change `promptStartMarker` / `promptEndMarker` in `DEFAULT_SETTINGS`

### Adjust Polling Behavior
- Alarm interval: `background.ts` (`POLL_INTERVAL_MINUTES = 0.5`, 30s minimum)
- Standard timeout: `MAX_POLL_TICKS_STANDARD = 12` (6 minutes)
- SeedVR base timeout: `MAX_POLL_TICKS_SEEDVR_BASE = 6` (3 minutes)
- SeedVR upscale timeout: `MAX_POLL_TICKS_SEEDVR_UPSCALE = 12` (6 minutes)
- Popup is read-only — no polling, reacts to `chrome.storage.local.onChanged`

## File Size Reference

| File | Lines | Purpose |
|------|-------|---------|
| popup.ts | ~780 | UI logic (read-only, message-sender) |
| popup.css | ~718 | Styling |
| utils.ts | ~480 | Core utilities, API client, workflow builder |
| content.ts | ~308 | Auto-detection |
| background.ts | ~322 | Alarm-based generation orchestrator |
| workflow-utils.ts | ~216 | Workflow management |
| types.ts | ~130 | Type definitions |
| popup.html | ~127 | UI structure |

## Documentation

- `DOCS.md` - Comprehensive documentation
- `docs/workflow-update-guide.md` - Workflow modification guide
- `docs/prompt-detection.md` - Detection system details
- `README.md` - Quick start guide
