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
├── options.ts         # Legacy/simple options page
├── types.ts           # Interfaces, constants, defaults
├── utils.ts           # Storage helpers, API client, workflow builder
├── workflow-utils.ts  # Workflow import & mapping detection
└── workflows/
    ├── qwen-t2i-base.json           # Base T2I workflow
    ├── qwen-t2i-upscale.json        # KSampler upscale nodes (submitted separately)
    ├── qwen-t2i-litegraph.json      # LiteGraph format for PNG embedding
    ├── qwen-t2i-seedvr-base.json    # Base T2I workflow (SeedVR)
    ├── qwen-t2i-seedvr-upscale.json # Legacy SeedVR2 upscale nodes
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
| `local` | `timingStats` | TimingStats: last 20 generation/upscale durations for ETA |

### Message Types

| Message | Direction | Purpose |
|---------|-----------|---------|
| `INIT_AUTO_DETECT` | popup → content | Start detection with markers |
| `STOP_AUTO_DETECT` | popup → content | Stop detection |
| `AUTO_DETECTED_PROMPT` | content → background | Send detected prompt |
| `START_GENERATION` | popup → background | Request generation (entryId, text, isRegenerate?) |
| `CANCEL_GENERATION` | popup → background | Cancel generation (entryId, promptId) |
| `START_UPSCALE` | popup/content → background | Queue upscale for a completed base image |
| `CANCEL_UPSCALE` | popup/content → background | Cancel active or queued upscale |
| `CANCEL_ALL` | popup → background | Cancel all active/queued generation and upscale work |
| `DELETE_ENTRY` | popup/content → background | Delete prompt entry, cancelling active work first |
| `GET_IMAGE_PREVIEW` | content → background | Fetch image and return data URL for injected UI preview |
| `TRIGGER_AUTO_UPSCALE_SCAN` | popup → background | Queue eligible completed entries when auto-upscale is enabled |
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
4. Set date/run-token based output prefix on node 79
5. Build matching LiteGraph metadata for PNG drag-and-drop recovery
6. Return a base-only payload for `/prompt`

**Upscale Building** (`buildAndSendUpscale` in utils.ts):
1. Upscale is queued separately via `upscaleStatus`
2. For qwen-t2i: rebuild base workflow, merge `qwen-t2i-upscale.json`, submit as separate prompt, poll node 81
3. For qwen-t2i-seedvr: fetch base image, upload to `/upload/image`, submit `seedvr-upscale-standalone.json`, poll node 81
4. Upscale submission waits until all base generations are done to avoid model thrashing

**SeedVR Two-Prompt Execution** (avoids OOM on cuda:1):
1. Stage 1: Submit base workflow → poll node 79 for smoothed base image
2. When upscale is queued, fetch base image from ComfyUI and upload to `/upload/image` (input folder)
3. Submit standalone SeedVR upscale workflow with LoadImage node → poll node 81
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
  autoUpscaleWhenIdle: boolean; // Queue upscales when no base generations are running
  negativePrompt: string;
  seed: number;               // -1 for random
  steps: number;              // Default: 20
  cfg: number;                // Default: 4
  headers: Record<string, string>;
  enableSeparator: boolean;   // Parse === delimiter
  aspectRatio: string;        // e.g., "16:9 ▭"
  megapixel: number;          // Default: 2.5
  promptStartMarker: string;  // Default: [PROMPT START]
  promptEndMarker: string;    // Default: [PROMPT END]
}

type GenerationStage = 'queued' | 'polling';

interface ImageInfo {
  filename: string;
  subfolder: string;
  type: string;
}

interface PromptEntry {
  id: string;                 // UUID
  text: string;               // Prompt text
  createdAt: number;          // Timestamp
  imageStatus: 'pending' | 'generating' | 'done' | 'error';
  imageUrl?: string;          // Best available image URL (base or upscaled)
  baseImageUrl?: string;      // Node 79 output URL
  baseImageInfo?: ImageInfo;  // Node 79 file info for upscale submission
  promptId?: string;          // Base ComfyUI prompt_id
  generationCount?: number;   // Times regenerated
  // Alarm-based orchestration fields (set by background service worker)
  generationStage?: GenerationStage;  // queued = waiting for SeedVR slot; polling = active base prompt
  basePromptId?: string;              // Original base prompt_id
  pollAttempts?: number;              // Base alarm ticks spent polling
  workflowType?: BuiltInWorkflowType; // Workflow used (needed after SW restart)
  // Upscale state (separate from base generation)
  upscaleStatus?: 'upscaling' | 'done' | 'error';
  upscalePromptId?: string;           // Present only after queued upscale is submitted
  upscalePollAttempts?: number;
  // Timing samples
  generationStartedAt?: number;
  generationDoneAt?: number;
  upscaleStartedAt?: number;
  upscaleDoneAt?: number;
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
| 205 | Note (unconnected) | `payload.prompt` — visible prompt when image dragged into ComfyUI |
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
- Alarm auto-created when generation/upscale work starts, auto-cleared when no in-flight entries remain
- Service worker startup recovery: re-establishes alarm if `generating` or `upscaling` entries exist

**Base generation state** (per PromptEntry):
- `imageStatus: 'generating'`, `generationStage: 'queued'`, no `promptId` → waiting for a SeedVR submission slot
- `imageStatus: 'generating'`, `generationStage: 'polling'`, with `promptId` → active base prompt, check node 79
- `imageStatus: 'done'` → base image is ready, with `baseImageUrl` and usually `baseImageInfo`

**Upscale state** (separate from base generation):
- `upscaleStatus: 'upscaling'`, no `upscalePromptId` → queued until all base generations finish
- `upscaleStatus: 'upscaling'`, with `upscalePromptId` → active upscale prompt, check node 81
- `upscaleStatus: 'done'` → `imageUrl` points at the upscaled image

**Timeout limits**:
- Base generation polling: `MAX_POLL_TICKS_BASE = 12` → 6 minutes
- Upscale polling: `MAX_POLL_TICKS_UPSCALE = 12` → 6 minutes

**Quick first check**: `setTimeout(() => handleAlarmTick(), 5000)` after submission for fast-completing workflows.

### Image Check Functions (Non-Blocking)
- `checkHistoryForUpscaledImage(promptId, settings)` — single fetch, checks node 81, falls back to node 79 only if the workflow errored
- `checkHistoryForBaseImage(promptId, settings)` — single fetch, checks node 79
- `buildAndSendUpscale(entry, payload, settings)` — submits the correct separate upscale workflow for the entry's workflow type
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
3. **Workflow builder**: parameter application, base workflow submission, separate upscale submission
4. **Prompt extraction**: marker parsing, deduplication

## Built-in Workflows

| ID | Name | Upscaler | Description |
|----|------|----------|-------------|
| `qwen-t2i` | Qwen T2I | KSampler | Standard upscale, faster |
| `qwen-t2i-seedvr` | Qwen T2I + SeedVR | SeedVR2VideoUpscaler | Higher quality, slower |

Selection via `builtInWorkflow` setting in UI dropdown.
Base generation is submitted first for both built-ins. Upscale is queued separately by the user or by `autoUpscaleWhenIdle`; qwen-t2i merges KSampler upscale nodes into the separate upscale prompt, while qwen-t2i-seedvr uses a standalone SeedVR prompt to avoid OOM.

## Common Modifications

### Change Default ComfyUI Server
Edit `DEFAULT_SETTINGS.serverAddress` in `types.ts`

### Add New Aspect Ratio
Add to `ASPECT_RATIOS` array in `types.ts`

### Modify Detection Markers
Change `promptStartMarker` / `promptEndMarker` in `DEFAULT_SETTINGS`

### Adjust Polling Behavior
- Alarm interval: `background.ts` (`POLL_INTERVAL_MINUTES = 0.5`, 30s minimum)
- Base timeout: `MAX_POLL_TICKS_BASE = 12` (6 minutes)
- Upscale timeout: `MAX_POLL_TICKS_UPSCALE = 12` (6 minutes)
- Popup is read-only — no polling, reacts to `chrome.storage.local.onChanged`

## File Size Reference

| File | Lines | Purpose |
|------|-------|---------|
| popup.ts | ~1229 | UI logic (read-only, message-sender) |
| popup.css | ~857 | Styling |
| utils.ts | ~1093 | Core utilities, API client, workflow builder |
| content.ts | ~1205 | Auto-detection and injected session UI |
| background.ts | ~582 | Alarm-based generation/upscale orchestrator |
| workflow-utils.ts | ~216 | Workflow management |
| types.ts | ~156 | Type definitions |
| popup.html | ~143 | UI structure |

## Documentation

- `DOCS.md` - Comprehensive documentation
- `docs/workflow-update-guide.md` - Workflow modification guide
- `docs/prompt-detection.md` - Detection system details
- `README.md` - Quick start guide
