# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

This is a Chrome Manifest V3 extension named `ComfyUI Prompt Manager`. It captures prompts from web pages, stores them in Chrome storage, sends generation and upscale workflows to ComfyUI, and shows progress/results in the popup and injected page UI.

Tech stack:

- TypeScript with `strict` enabled
- Vite build, output to ignored `dist/`
- Chrome extension APIs, Manifest V3 service worker
- No configured test runner yet; `npm run build` is the primary verification command

## Commands

- `npm run build` - production build into `dist/`
- `npm run dev` - Vite watch build
- `npm run clean` - remove `dist/`

Run `npm run build` before finishing meaningful code changes. Do not manually edit `dist/`; it is generated and ignored.

## Important Files

- `manifest.json` - extension manifest, permissions, CSP, popup/options entry points
- `vite.config.ts` - bundles `background`, `popup`, `options`, and `content` entry points
- `popup.html`, `popup.css`, `src/popup.ts` - main popup UI and settings/history workflow
- `src/background.ts` - service worker, message handlers, generation/upscale orchestration
- `src/content.ts` - injected auto-detection UI and prompt scanner
- `src/types.ts` - shared interfaces, storage keys, defaults, workflow constants
- `src/utils.ts` - Chrome storage helpers, ComfyUI API client, workflow building, metadata parsing
- `src/workflow-utils.ts` - imported workflow storage, mapping detection, and mapping application
- `src/png-metadata.ts` - PNG tEXt chunk parser for prompt recovery
- `src/workflows/*.json` - ComfyUI API and LiteGraph workflow templates
- `docs/` and `DOCS.md` - user/developer reference material

`CLAUDE.md` and `.windsurfrules.md` contain useful historical context, but verify details against source before relying on them. Some state-machine details have evolved.

## Architecture Notes

`background.ts` is the only generation orchestrator. Popup and content scripts send messages to the background service worker and then react to `chrome.storage.local` changes.

Generation flow:

1. A prompt entry is created in `promptHistory`.
2. Popup/content sends `START_GENERATION` or `AUTO_DETECTED_PROMPT`.
3. Background builds a payload with `parsePromptMetadata()` and `buildPayload()`.
4. `sendToComfyUI()` submits a ComfyUI prompt.
5. `chrome.alarms` drives polling every 30 seconds.
6. Base output is read from node `79`; upscaled output is read from node `81`.

Current `GenerationStage` values are `queued` and `polling`. A queued upscale is represented by `upscaleStatus: 'upscaling'` with no `upscalePromptId`; an active upscale has `upscalePromptId`.

SeedVR work is intentionally serialized to avoid GPU memory pressure. Upscale submission waits until all base generations are done, so do not move polling or queue promotion into popup code.

## Storage Model

Use `STORAGE_KEYS` from `src/types.ts`.

- `chrome.storage.sync`
  - `comfyuiSettings`
- `chrome.storage.local`
  - `promptHistory`
  - `activeTab`
  - `autoDetectDomains`
  - `importedWorkflows`
  - `activeWorkflowId`
  - `timingStats`

History mutations should go through the helpers in `src/utils.ts`, especially `addPromptEntry()`, `updatePromptEntry()`, and `deletePromptEntry()`. These use an in-memory lock to reduce race conditions.

## Workflow Rules

Built-in workflows:

- `qwen-t2i` - base Qwen T2I generation, with separate KSampler upscale when requested
- `qwen-t2i-seedvr` - base Qwen T2I generation, with separate SeedVR upscale workflow when requested

Important node IDs:

- `3` - sampler seed, steps, cfg
- `105` - negative prompt
- `118` - positive prompt text
- `114` - aspect ratio, megapixels, width, height, preset
- `205` - unconnected Note node for prompt visibility in ComfyUI metadata
- `79` - base SaveImage output
- `81` - upscale SaveImage output

When adding a new generation setting:

1. Add it to `ComfyUISettings` and `DEFAULT_SETTINGS` in `src/types.ts`.
2. Add UI in `popup.html`.
3. Bind, save, and render it in `src/popup.ts`.
4. Apply it in `src/utils.ts` workflow builders if it affects ComfyUI.

When adding a workflow parameter:

1. Add it to `ComfyUIPayload` in `src/types.ts`.
2. Update `buildPayload()` in `src/background.ts`.
3. Apply it in `buildComfyUIWorkflow()`, `buildAndSendUpscale()`, and/or `buildLiteGraphWorkflow()` in `src/utils.ts`.
4. Add mapping support in `src/workflow-utils.ts` if imported workflows should support it.

## Prompt Format

The extension detects prompts between configurable markers, defaulting to:

```text
[PROMPT START]
...
[PROMPT END]
```

`parsePromptMetadata()` currently recognizes:

- `Aspect Ratio: W:H`
- `Negative: ...`

If `enableSeparator` is true and the prompt does not already contain `===`, `preparePromptText()` prepends the separator before submitting.

## Extension Gotchas

- Source files run in browser/extension contexts. Do not use Node-only APIs in `src/`.
- MV3 service workers can be suspended. Use `chrome.alarms` and persisted storage for long-running work.
- Keep popup behavior read-oriented for generation state; background owns orchestration.
- Content script UI is injected into arbitrary pages. Keep styles scoped to extension-specific IDs/classes.
- Restricted pages such as `chrome://`, `chrome-extension://`, `about:`, `edge://`, `brave://`, and `file://` should not receive content script injection.
- ComfyUI requests use `settings.serverAddress`, `settings.apiPath`, and optional `settings.headers`.

## Code Style

- Prefer existing helper functions over adding parallel storage/API logic.
- Keep types explicit and avoid `any`.
- Use `structuredClone()` for workflow templates before mutation.
- Keep changes scoped. Workflow JSON files can be large, so avoid formatting churn unless the workflow itself changes.
- Leave user-facing docs consistent with current code when behavior changes.

## Verification Checklist

Before handing off code changes:

- Run `npm run build`.
- Check `git status --short` and mention any files changed.
- For UI changes, inspect popup/content behavior in Chrome when practical.
- For workflow changes, verify node IDs and payload shape against the relevant JSON templates.
