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

async function clearHistory(): Promise<void> {
  await storage.local.set({ [STORAGE_KEYS.HISTORY]: [] });
}

async function getActiveTab(): Promise<string> {
  const result = await storage.local.get(STORAGE_KEYS.ACTIVE_TAB);
  return result[STORAGE_KEYS.ACTIVE_TAB] || 'history';
}

async function setActiveTab(tab: string): Promise<void> {
  await storage.local.set({ [STORAGE_KEYS.ACTIVE_TAB]: tab });
}

interface ComfyUIQueueItem {
  promptId: string;
  number: number;
}

interface ComfyUIQueueResponse {
  queue_running: Array<[number, string, unknown, unknown, unknown]>;
  queue_pending: Array<[number, string, unknown, unknown, unknown]>;
}

async function fetchComfyUIQueue(settings: ComfyUISettings): Promise<{ running: ComfyUIQueueItem[]; pending: ComfyUIQueueItem[] }> {
  const url = `${settings.serverAddress}/queue`;
  try {
    const response = await fetch(url);
    if (!response.ok) return { running: [], pending: [] };
    
    const data: ComfyUIQueueResponse = await response.json();
    
    const running = (data.queue_running || []).map(item => ({
      promptId: item[1],
      number: item[0],
    }));
    
    const pending = (data.queue_pending || []).map(item => ({
      promptId: item[1],
      number: item[0],
    }));
    
    return { running, pending };
  } catch (error) {
    console.error('Failed to fetch queue:', error);
    return { running: [], pending: [] };
  }
}

async function cancelPrompt(promptId: string, settings: ComfyUISettings): Promise<boolean> {
  try {
    const response = await fetch(`${settings.serverAddress}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: [promptId] }),
    });
    if (response.ok) return true;
    
    const interruptResponse = await fetch(`${settings.serverAddress}/interrupt`, {
      method: 'POST',
    });
    return interruptResponse.ok;
  } catch (error) {
    console.error('Failed to cancel prompt:', error);
    return false;
  }
}

async function deletePromptEntry(id: string): Promise<void> {
  const history = await getHistory();
  const filtered = history.filter(entry => entry.id !== id);
  await saveHistory(filtered);
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

async function pollForImage(promptId: string, settings: ComfyUISettings, maxAttempts = 180): Promise<string | null> {
  const historyUrl = `${settings.serverAddress}/history/${promptId}`;
  console.log('Polling for image:', historyUrl);
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const response = await fetch(historyUrl);
      if (!response.ok) {
        console.log(`Poll attempt ${attempt}: HTTP ${response.status}`);
        continue;
      }
      
      const historyData = await response.json();
      console.log(`Poll attempt ${attempt}:`, historyData);
      
      const promptHistory = historyData[promptId];
      if (!promptHistory) {
        console.log('No history for promptId yet');
        continue;
      }
      
      const hasOutputs = promptHistory.outputs && Object.keys(promptHistory.outputs).length > 0;
      console.log('Has outputs:', hasOutputs, 'Status:', promptHistory.status);
      
      if (hasOutputs) {
        const upscaledNode = promptHistory.outputs['81'];
        const regularNode = promptHistory.outputs['79'];
        console.log('Node 81:', upscaledNode, 'Node 79:', regularNode);
        
        const saveImageNode = upscaledNode?.images?.[0] ? upscaledNode : regularNode;
        
        if (saveImageNode?.images?.[0]) {
          const img = saveImageNode.images[0];
          const imageUrl = `${settings.serverAddress}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`;
          console.log('Image URL:', imageUrl);
          return imageUrl;
        }
      }
    } catch (error) {
      console.error('Poll error:', error);
    }
  }
  console.log('Polling timed out');
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
        "clip": ["74", 1]
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
        "model": ["74", 0]
      },
      "class_type": "ModelSamplingAuraFlow"
    },
    "74": {
      "inputs": {
        "model": ["104", 0],
        "clip": ["103", 0]
      },
      "class_type": "Power Lora Loader (rgthree)"
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
        "clip": ["74", 1]
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
    const upscaleSeed = Math.floor(Math.random() * 1000000000000);
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
          "seed": upscaleSeed,
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
      "89": {
        "inputs": {
          "anything": ["88", 0]
        },
        "class_type": "easy cleanGpuUsed"
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
  clearHistory,
  getActiveTab,
  setActiveTab,
  fetchComfyUIQueue,
  cancelPrompt,
  deletePromptEntry,
  addPromptEntry,
  updatePromptEntry,
  sendToComfyUI,
  pollForImage,
  getRelativeTime,
};
