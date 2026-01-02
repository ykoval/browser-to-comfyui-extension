# Browser to ComfyUI Extension

Chrome extension for saving prompts from websites and sending them to a local ComfyUI instance for image generation.

## Architecture

```
src/
├── background.ts    # Service worker: context menu, keyboard shortcuts, message handling
├── popup.ts         # Popup UI: history, settings, generation controls
├── content.ts       # Content script: auto-detect prompts on enabled domains
├── options.ts       # Options page (minimal, settings in popup)
├── types.ts         # TypeScript interfaces and constants
├── utils.ts         # Shared utilities: storage, API client, workflow builder
└── workflows/       # ComfyUI workflow JSON templates
    ├── qwen-t2i-base.json     # Base text-to-image workflow
    └── qwen-t2i-upscale.json  # Upscale nodes (merged when enabled)
```

## Key Components

### Storage (Chrome APIs)
- `chrome.storage.sync` - Settings (synced across devices)
- `chrome.storage.local` - Prompt history, auto-detect domains

### ComfyUI Integration
- Workflow templates in `src/workflows/` as JSON files
- `buildComfyUIWorkflow()` in `utils.ts` applies dynamic parameters
- Polls `/history/{promptId}` for generated images
- Output nodes: 79 (regular), 81 (upscaled)

### Prompt Detection
- Manual: Context menu, keyboard shortcut (Ctrl+Shift+P)
- Auto: Content script scans for markers on enabled domains
- Markers: `[PROMPT START]` ... `[PROMPT END]` (configurable)

## Build Commands

```bash
npm run build   # Production build to dist/
npm run dev     # Watch mode for development
```

## Workflow Updates

See `docs/workflow-update-guide.md` for instructions on updating ComfyUI workflows.

Key points:
- Edit JSON templates directly for static changes
- Update `buildComfyUIWorkflow()` for new dynamic parameters
- Add to `ComfyUIPayload` interface in `types.ts` for new UI controls

## Important Interfaces

```typescript
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

interface ComfyUISettings {
  serverAddress: string;      // Default: http://192.168.50.143:8188
  apiPath: string;            // Default: /prompt
  autoSend: boolean;
  negativePrompt: string;
  seed: number;               // -1 for random
  steps: number;
  cfg: number;
  aspectRatio: string;
  megapixel: number;
  enableUpscale: boolean;
  promptStartMarker: string;
  promptEndMarker: string;
}
```

## Testing Notes

- Mock Chrome APIs with jest-chrome
- Focus on: storage helpers, API client, workflow builder
- ComfyUI server must be running for integration tests
