import { ComfyUISettings, PromptEntry, STORAGE_KEYS, DEFAULT_SETTINGS, MAX_HISTORY_ENTRIES, ComfyUIPayload, WorkflowNode } from './types';
import baseWorkflowTemplate from './workflows/qwen-t2i-base.json';
import upscaleNodesTemplate from './workflows/qwen-t2i-upscale.json';
import liteGraphWorkflowTemplate from './workflows/qwen-t2i-litegraph.json';
import { getActiveWorkflow, applyMappingsToWorkflow } from './workflow-utils';

/// <reference types="chrome" />

const storage = chrome.storage;

let historyLock: Promise<void> = Promise.resolve();

async function withHistoryLock<T>(fn: () => Promise<T>): Promise<T> {
  const currentLock = historyLock;
  let resolve: () => void;
  historyLock = new Promise(r => { resolve = r; });
  await currentLock;
  try {
    return await fn();
  } finally {
    resolve!();
  }
}

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

async function getAutoDetectDomains(): Promise<string[]> {
  const result = await storage.local.get(STORAGE_KEYS.AUTO_DETECT_DOMAINS);
  return result[STORAGE_KEYS.AUTO_DETECT_DOMAINS] || [];
}

async function saveAutoDetectDomains(domains: string[]): Promise<void> {
  await storage.local.set({ [STORAGE_KEYS.AUTO_DETECT_DOMAINS]: domains });
}

async function isAutoDetectEnabled(domain: string): Promise<boolean> {
  const domains = await getAutoDetectDomains();
  return domains.includes(domain);
}

async function toggleAutoDetect(domain: string, enabled: boolean): Promise<void> {
  const domains = await getAutoDetectDomains();
  if (enabled && !domains.includes(domain)) {
    domains.push(domain);
  } else if (!enabled) {
    const index = domains.indexOf(domain);
    if (index > -1) domains.splice(index, 1);
  }
  await saveAutoDetectDomains(domains);
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

async function isPromptDuplicate(text: string): Promise<boolean> {
  const history = await getHistory();
  const normalizedText = text.trim().toLowerCase();
  console.log(`[Utils] Checking "${text.substring(0, 30)}..." against ${history.length} history entries`);
  const isDupe = history.some(entry => {
    const entryNormalized = entry.text.trim().toLowerCase();
    if (entryNormalized === normalizedText) {
      console.log(`[Utils] Found duplicate match with entry: "${entry.text.substring(0, 30)}..."`);
      return true;
    }
    return false;
  });
  console.log(`[Utils] Result: ${isDupe}`);
  return isDupe;
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
  } catch {
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
  return withHistoryLock(async () => {
    const entry: PromptEntry = {
      id: crypto.randomUUID(),
      text,
      createdAt: Date.now(),
      imageStatus: 'pending',
    };
    const history = await getHistory();
    console.log(`[Utils] addPromptEntry: history before=${history.length}`);
    history.push(entry);
    await saveHistory(history);
    console.log(`[Utils] addPromptEntry: saved, new length=${history.length}`);
    return entry;
  });
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

  const activeWorkflow = await getActiveWorkflow();
  let body: object;

  if (activeWorkflow) {
    const appliedWorkflow = applyMappingsToWorkflow(
      activeWorkflow.workflow,
      activeWorkflow.mappings,
      { ...payload, prompt: promptText }
    );
    // For imported workflows, use the template LiteGraph workflow
    const seed = payload.seed === -1 ? Math.floor(Math.random() * 1000000000000) : payload.seed;
    const liteGraphWorkflow = buildLiteGraphWorkflow({ ...payload, prompt: promptText }, seed);
    body = {
      prompt: appliedWorkflow,
      extra_data: {
        extra_pnginfo: {
          workflow: liteGraphWorkflow
        }
      }
    };
  } else {
    body = buildComfyUIWorkflow({ ...payload, prompt: promptText });
  }

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
        const activeWorkflow = await getActiveWorkflow();
        let saveImageNode = null;

        if (activeWorkflow?.outputNodeId) {
          saveImageNode = promptHistory.outputs[activeWorkflow.outputNodeId];
        }
        
        if (!saveImageNode?.images?.[0]) {
          const upscaledNode = promptHistory.outputs['81'];
          const regularNode = promptHistory.outputs['79'];
          saveImageNode = upscaledNode?.images?.[0] ? upscaledNode : regularNode;
        }

        if (!saveImageNode?.images?.[0]) {
          for (const nodeId of Object.keys(promptHistory.outputs)) {
            const node = promptHistory.outputs[nodeId];
            if (node?.images?.[0]) {
              saveImageNode = node;
              break;
            }
          }
        }

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

type WorkflowTemplate = Record<string, WorkflowNode>;

interface LiteGraphNode {
  id: number;
  type: string;
  pos: number[];
  size: number[];
  flags: Record<string, unknown>;
  order: number;
  mode: number;
  inputs?: Array<{ name: string; type: string; link: number | null; widget?: { name: string } }>;
  outputs?: Array<{ name: string; type: string; links: number[] | null; slot_index?: number }>;
  title?: string;
  properties: Record<string, unknown>;
  widgets_values?: unknown[];
}

interface LiteGraphWorkflow {
  id?: string;
  revision?: number;
  last_node_id: number;
  last_link_id: number;
  nodes: LiteGraphNode[];
  links: Array<[number, number, number, number, number, string]>;
  groups: unknown[];
  config: Record<string, unknown>;
  extra: Record<string, unknown>;
  version: number;
}

function buildLiteGraphWorkflow(payload: ComfyUIPayload, seed: number): LiteGraphWorkflow {
  // Clone the template workflow
  const lgWorkflow: LiteGraphWorkflow = structuredClone(liteGraphWorkflowTemplate) as LiteGraphWorkflow;

  // Update dynamic values in the LiteGraph workflow nodes
  for (const node of lgWorkflow.nodes) {
    switch (node.id) {
      case 3: // KSampler - main sampler
        if (node.widgets_values) {
          node.widgets_values[0] = seed;              // seed
          node.widgets_values[2] = payload.steps;     // steps
          node.widgets_values[3] = payload.cfg;       // cfg
        }
        break;
      case 83: // KSampler - upscale sampler
        if (node.widgets_values) {
          node.widgets_values[0] = Math.floor(Math.random() * 1000000000000); // seed
        }
        break;
      case 105: // CLIPTextEncode - negative prompt
        if (node.widgets_values) {
          node.widgets_values[0] = payload.negativePrompt || "dust, dots, stain";
        }
        break;
      case 118: // AGSoftTextSplit - prompt input
        if (node.widgets_values) {
          node.widgets_values[1] = payload.prompt;    // text field
        }
        break;
      case 113: // Ratio to Size
        if (node.widgets_values) {
          node.widgets_values[0] = payload.aspectRatio;  // ratio
          node.widgets_values[1] = payload.megapixel;    // Megapixel
        }
        break;
    }
  }

  return lgWorkflow;
}

function buildComfyUIWorkflow(payload: ComfyUIPayload): object {
  const seed = payload.seed === -1 ? Math.floor(Math.random() * 1000000000000) : payload.seed;

  const workflow: WorkflowTemplate = structuredClone(baseWorkflowTemplate) as WorkflowTemplate;

  workflow["3"].inputs.seed = seed;
  workflow["3"].inputs.steps = payload.steps;
  workflow["3"].inputs.cfg = payload.cfg;
  workflow["105"].inputs.text = payload.negativePrompt || "dust, dots, stain";
  workflow["118"].inputs.text = payload.prompt;
  workflow["113"].inputs.ratio = payload.aspectRatio;
  workflow["113"].inputs.Megapixel = payload.megapixel;

  if (payload.enableUpscale) {
    const upscaleNodes = structuredClone(upscaleNodesTemplate) as WorkflowTemplate;
    upscaleNodes["83"].inputs.seed = Math.floor(Math.random() * 1000000000000);
    Object.assign(workflow, upscaleNodes);
  }

  // Build LiteGraph workflow for PNG embedding using the exported template
  const liteGraphWorkflow = buildLiteGraphWorkflow(payload, seed);

  return {
    prompt: workflow,
    extra_data: {
      extra_pnginfo: {
        workflow: liteGraphWorkflow
      }
    }
  };
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
  getAutoDetectDomains,
  saveAutoDetectDomains,
  isAutoDetectEnabled,
  toggleAutoDetect,
  extractDomain,
  isPromptDuplicate,
  fetchComfyUIQueue,
  cancelPrompt,
  deletePromptEntry,
  addPromptEntry,
  updatePromptEntry,
  sendToComfyUI,
  pollForImage,
  getRelativeTime,
};
