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
}

interface PromptEntry {
  id: string;
  text: string;
  createdAt: number;
  imageStatus: 'pending' | 'generating' | 'done' | 'error';
  imageUrl?: string;
  promptId?: string;
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

interface ComfyUIResponse {
  // TODO: Define based on actual ComfyUI response structure
  // Example: { images: [{ url: string }] }
}

const STORAGE_KEYS = {
  SETTINGS: 'comfyuiSettings',
  HISTORY: 'promptHistory',
} as const;

const ASPECT_RATIOS = [
  '1:1 ⬜',
  '4:3 ▭',
  '3:2 ▭',
  '16:9 ▭',
  '21:9 ▭',
  '2:1 ▭',
  '3:4 ▯',
  '2:3 ▯',
  '9:16 ▯',
  '9:21 ▯',
  '1:2 ▯',
] as const;

const DEFAULT_SETTINGS: ComfyUISettings = {
  serverAddress: 'http://192.168.50.143:8188',
  apiPath: '/prompt',
  workflowId: 'default_workflow',
  autoSend: false,
  negativePrompt: 'dust, dots, stain',
  seed: -1,
  steps: 20,
  cfg: 4,
  headers: {},
  enableSeparator: true,
  aspectRatio: '16:9 ▭',
  megapixel: 2.5,
  enableUpscale: false,
};

const MAX_HISTORY_ENTRIES = 50;

export type { ComfyUISettings, PromptEntry, ComfyUIPayload, ComfyUIResponse };
export { STORAGE_KEYS, DEFAULT_SETTINGS, MAX_HISTORY_ENTRIES, ASPECT_RATIOS };
