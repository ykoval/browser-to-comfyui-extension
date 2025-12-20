# Browser to ComfyUI Extension

A Chrome extension that allows you to save prompts from any website and send them to a local ComfyUI instance for image generation.

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
