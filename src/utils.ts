import { ComfyUISettings, PromptEntry, STORAGE_KEYS, DEFAULT_SETTINGS, MAX_HISTORY_ENTRIES, ComfyUIPayload } from './types';

/// <reference types="chrome" />

const storage = chrome.storage;

async function getSettings(): Promise<ComfyUISettings> {
  const result = await storage.sync.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
}

async function saveSettings(settings: ComfyUISettings): Promise<void> {
  await storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

async function getHistory(): Promise<PromptEntry[]> {
  const result = await storage.local.get(STORAGE_KEYS.HISTORY);
  return result[STORAGE_KEYS.HISTORY] || [];
}

async function saveHistory(history: PromptEntry[]): Promise<void> {
  const trimmedHistory = history.slice(-MAX_HISTORY_ENTRIES);
  await storage.local.set({ [STORAGE_KEYS.HISTORY]: trimmedHistory });
}

async function addPromptEntry(text: string): Promise<PromptEntry> {
  const entry: PromptEntry = {
    id: crypto.randomUUID(),
    text,
    createdAt: Date.now(),
    imageStatus: 'pending',
  };
  const history = await getHistory();
  history.push(entry);
  await saveHistory(history);
  return entry;
}

async function updatePromptEntry(id: string, updates: Partial<PromptEntry>): Promise<void> {
  const history = await getHistory();
  const index = history.findIndex(entry => entry.id === id);
  if (index !== -1) {
    history[index] = { ...history[index], ...updates };
    await saveHistory(history);
  }
}

function preparePromptText(text: string, enableSeparator: boolean): string {
  if (!enableSeparator) return text;
  if (text.includes('===')) return text;
  return `===\n${text}`;
}

interface ComfyUIPromptResponse {
  prompt_id: string;
  number: number;
  node_errors: Record<string, unknown>;
}

interface ComfyUIHistoryResponse {
  [promptId: string]: {
    outputs: {
      [nodeId: string]: {
        images?: Array<{ filename: string; subfolder: string; type: string }>;
      };
    };
    status: { completed: boolean };
  };
}

async function sendToComfyUI(payload: ComfyUIPayload, settings: ComfyUISettings): Promise<string> {
  const url = `${settings.serverAddress}${settings.apiPath}`;
  const promptText = preparePromptText(payload.prompt, settings.enableSeparator);
  const body = buildComfyUIWorkflow({ ...payload, prompt: promptText });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...settings.headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result: ComfyUIPromptResponse = await response.json();
  console.log('ComfyUI response:', result);
  return result.prompt_id;
}

async function pollForImage(promptId: string, settings: ComfyUISettings, maxAttempts = 120): Promise<string | null> {
  const historyUrl = `${settings.serverAddress}/history/${promptId}`;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const response = await fetch(historyUrl);
      if (!response.ok) continue;
      
      const history: ComfyUIHistoryResponse = await response.json();
      const promptHistory = history[promptId];
      
      if (promptHistory?.status?.completed) {
        const upscaledNode = promptHistory.outputs['81'];
        const regularNode = promptHistory.outputs['79'];
        const saveImageNode = upscaledNode?.images?.[0] ? upscaledNode : regularNode;
        
        if (saveImageNode?.images?.[0]) {
          const img = saveImageNode.images[0];
          return `${settings.serverAddress}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`;
        }
      }
    } catch (error) {
      console.error('Poll error:', error);
    }
  }
  return null;
}

function buildComfyUIWorkflow(payload: ComfyUIPayload): object {
  const seed = payload.seed === -1 ? Math.floor(Math.random() * 1000000000000) : payload.seed;
  
  const baseWorkflow: Record<string, object> = {
    "3": {
      "inputs": {
        "seed": seed,
        "steps": payload.steps,
        "cfg": payload.cfg,
        "sampler_name": "er_sde",
        "scheduler": "beta",
        "denoise": 1,
        "model": ["66", 0],
        "positive": ["6", 0],
        "negative": ["105", 0],
        "latent_image": ["114", 0]
      },
      "class_type": "KSampler"
    },
    "6": {
      "inputs": {
        "text": ["109", 1],
        "clip": ["103", 0]
      },
      "class_type": "CLIPTextEncode"
    },
    "8": {
      "inputs": {
        "samples": ["3", 0],
        "vae": ["112", 0]
      },
      "class_type": "VAEDecode"
    },
    "66": {
      "inputs": {
        "shift": 3,
        "model": ["104", 0]
      },
      "class_type": "ModelSamplingAuraFlow"
    },
    "79": {
      "inputs": {
        "filename_prefix": "Qwen image/QwenImageT2I",
        "images": ["8", 0]
      },
      "class_type": "SaveImage"
    },
    "103": {
      "inputs": {
        "clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
        "type": "qwen_image",
        "device": "cpu"
      },
      "class_type": "CLIPLoaderMultiGPU"
    },
    "104": {
      "inputs": {
        "unet_name": "jibMixQwen_v50.safetensors",
        "weight_dtype": "fp8_e4m3fn",
        "device": "cuda:1"
      },
      "class_type": "UNETLoaderMultiGPU"
    },
    "105": {
      "inputs": {
        "text": payload.negativePrompt || "dust, dots, stain",
        "clip": ["103", 0]
      },
      "class_type": "CLIPTextEncode"
    },
    "109": {
      "inputs": {
        "source": ["110", 0],
        "split_by": "===",
        "from_right": "true"
      },
      "class_type": "JWStringSplit"
    },
    "110": {
      "inputs": {
        "text": payload.prompt
      },
      "class_type": "JWStringMultiline"
    },
    "112": {
      "inputs": {
        "vae_name": "qwen_image_vae.safetensors",
        "device": "cuda:1"
      },
      "class_type": "VAELoaderMultiGPU"
    },
    "113": {
      "inputs": {
        "ratio": payload.aspectRatio,
        "Megapixel": payload.megapixel,
        "Precision": 0.2
      },
      "class_type": "Ratio to Size"
    },
    "114": {
      "inputs": {
        "width": ["113", 0],
        "height": ["113", 1],
        "batch_size": 1
      },
      "class_type": "EmptyLatentImage"
    }
  };

  if (payload.enableUpscale) {
    Object.assign(baseWorkflow, {
      "81": {
        "inputs": {
          "filename_prefix": "Qwen image/QwenImageT2I_UP",
          "images": ["88", 0]
        },
        "class_type": "SaveImage"
      },
      "83": {
        "inputs": {
          "seed": seed + 1,
          "steps": 8,
          "cfg": 1,
          "sampler_name": "res_multistep",
          "scheduler": "simple",
          "denoise": 0.2,
          "model": ["66", 0],
          "positive": ["6", 0],
          "negative": ["105", 0],
          "latent_image": ["90", 0]
        },
        "class_type": "KSampler"
      },
      "85": {
        "inputs": {
          "model_name": "4x_NMKD-Siax_200k.pth"
        },
        "class_type": "UpscaleModelLoader"
      },
      "86": {
        "inputs": {
          "upscale_model": ["85", 0],
          "image": ["8", 0]
        },
        "class_type": "ImageUpscaleWithModel"
      },
      "87": {
        "inputs": {
          "upscale_method": "lanczos",
          "scale_by": 0.5,
          "image": ["86", 0]
        },
        "class_type": "ImageScaleBy"
      },
      "88": {
        "inputs": {
          "samples": ["83", 0],
          "vae": ["112", 0]
        },
        "class_type": "VAEDecode"
      },
      "90": {
        "inputs": {
          "pixels": ["87", 0],
          "vae": ["112", 0]
        },
        "class_type": "VAEEncode"
      }
    });
  }

  return { prompt: baseWorkflow };
}

function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export {
  getSettings,
  saveSettings,
  getHistory,
  saveHistory,
  addPromptEntry,
  updatePromptEntry,
  sendToComfyUI,
  pollForImage,
  getRelativeTime,
};
