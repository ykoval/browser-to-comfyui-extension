# ComfyUI Workflow Update Guide

## Workflow Template Files

The extension uses JSON template files for ComfyUI workflows:

- `src/workflows/qwen-t2i-base.json` - Base text-to-image workflow
- `src/workflows/qwen-t2i-upscale.json` - Upscale nodes (merged when upscale enabled)

## How to Update Workflows

### For Static Changes (node connections, model names, devices, etc.)

1. Export new API workflow from ComfyUI (Save API format)
2. Replace content in `qwen-t2i-base.json`
3. Keep placeholder values for dynamic parameters (seed: 0, text: "", etc.)
4. If upscale nodes changed, update `qwen-t2i-upscale.json`
5. Run `npm run build` to verify

### For Dynamic Parameter Changes

If you need to add/remove parameters from the UI:

1. **`src/types.ts`** - Add property to `ComfyUIPayload` interface
2. **`src/utils.ts`** - Add assignment in `buildComfyUIWorkflow()`:
   ```typescript
   workflow["NODE_ID"].inputs.paramName = payload.newParam;
   ```
3. **`src/popup.ts`** - Add UI control
4. **`popup.html`** - Add HTML element for the control

## Dynamic Parameters Reference

Current dynamic parameters applied in `buildComfyUIWorkflow()`:

| Node | Parameter | Payload Field |
|------|-----------|---------------|
| 3 | seed | `payload.seed` |
| 3 | steps | `payload.steps` |
| 3 | cfg | `payload.cfg` |
| 105 | text | `payload.negativePrompt` |
| 110 | text | `payload.prompt` |
| 113 | ratio | `payload.aspectRatio` |
| 113 | Megapixel | `payload.megapixel` |
| 83 | seed | Random (upscale sampler) |

## Adding New Workflow Types

To add a new workflow (e.g., image-to-image):

1. Create `src/workflows/qwen-i2i-base.json`
2. Add workflow selection to UI
3. Create new build function or extend existing one
4. Update `ComfyUIPayload` interface if needed
