import { ComfyUISettings, PromptEntry, STORAGE_KEYS, DEFAULT_SETTINGS, MAX_HISTORY_ENTRIES, MAX_TIMING_SAMPLES, ComfyUIPayload, WorkflowNode, BuiltInWorkflowType, ImageInfo, TimingStats } from './types';
import baseWorkflowTemplate from './workflows/qwen-t2i-base.json';
import upscaleNodesTemplate from './workflows/qwen-t2i-upscale.json';
import liteGraphWorkflowTemplate from './workflows/qwen-t2i-litegraph.json';
import seedvrBaseWorkflowTemplate from './workflows/qwen-t2i-seedvr-base.json';
import seedvrUpscaleNodesTemplate from './workflows/qwen-t2i-seedvr-upscale.json';
import seedvrLiteGraphWorkflowTemplate from './workflows/qwen-t2i-seedvr-litegraph.json';
import seedvrUpscaleStandaloneTemplate from './workflows/seedvr-upscale-standalone.json';
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
    const liteGraphWorkflow = buildLiteGraphWorkflow({ ...payload, prompt: promptText }, seed, settings.builtInWorkflow);
    body = {
      prompt: appliedWorkflow,
      extra_data: {
        extra_pnginfo: {
          workflow: liteGraphWorkflow,
          prompt_text: promptText,
        }
      }
    };
  } else {
    body = buildComfyUIWorkflow({ ...payload, prompt: promptText }, settings.builtInWorkflow);
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
  // Always poll for upscaled output at node 81 (upscale is always enabled)
  const targetNodeId = '81';
  console.log('Polling for image:', historyUrl, 'targetNode:', targetNodeId);

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
      const isError = promptHistory.status?.status_str === 'error';
      console.log('Has outputs:', hasOutputs, 'Status:', promptHistory.status);

      // If workflow errored, stop polling and return null
      if (isError && !hasOutputs) {
        console.log('Workflow failed with error, no outputs available');
        return null;
      }

      if (hasOutputs) {
        const activeWorkflow = await getActiveWorkflow();
        let saveImageNode = null;

        // For imported workflows, use the configured output node
        if (activeWorkflow?.outputNodeId) {
          saveImageNode = promptHistory.outputs[activeWorkflow.outputNodeId];
        }

        // For built-in workflows, wait for upscaled node 81
        if (!saveImageNode?.images?.[0]) {
          const targetNode = promptHistory.outputs[targetNodeId];
          if (targetNode?.images?.[0]) {
            saveImageNode = targetNode;
            console.log(`Found image at target node ${targetNodeId}`);
          } else if (isError) {
            // Upscale failed - fall back to node 79 if available
            console.log('Upscale failed, falling back to regular output');
            saveImageNode = promptHistory.outputs['79'];
          } else {
            // Keep waiting for upscale to complete
            console.log(`Waiting for upscale node ${targetNodeId} to complete...`);
            continue;
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

interface HistoryCheckResult {
  status: 'ready' | 'waiting' | 'error';
  imageUrl?: string;
  imageInfo?: ImageInfo;
}

/**
 * Non-blocking single check for upscaled image at node 81.
 * Used by alarm-based polling in the service worker.
 */
async function checkHistoryForUpscaledImage(promptId: string, settings: ComfyUISettings): Promise<HistoryCheckResult> {
  const historyUrl = `${settings.serverAddress}/history/${promptId}`;
  try {
    const response = await fetch(historyUrl);
    if (!response.ok) return { status: 'waiting' };

    const historyData = await response.json();
    const promptHistory = historyData[promptId];
    if (!promptHistory) return { status: 'waiting' };

    const hasOutputs = promptHistory.outputs && Object.keys(promptHistory.outputs).length > 0;
    const isError = promptHistory.status?.status_str === 'error';

    if (isError && !hasOutputs) return { status: 'error' };

    if (hasOutputs) {
      // Check upscaled node 81 first
      const node81 = promptHistory.outputs['81'];
      if (node81?.images?.[0]) {
        const img = node81.images[0];
        const imageUrl = `${settings.serverAddress}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`;
        return { status: 'ready', imageUrl };
      }

      // If errored, fall back to node 79
      if (isError) {
        const node79 = promptHistory.outputs['79'];
        if (node79?.images?.[0]) {
          const img = node79.images[0];
          const imageUrl = `${settings.serverAddress}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`;
          return { status: 'ready', imageUrl };
        }
        return { status: 'error' };
      }

      // Outputs exist but node 81 not ready yet — keep waiting
      return { status: 'waiting' };
    }

    return { status: 'waiting' };
  } catch {
    return { status: 'waiting' }; // Network error, retry on next tick
  }
}

/**
 * Non-blocking single check for base image at node 79.
 * Returns both imageUrl (for display) and imageInfo (for upscale submission).
 */
async function checkHistoryForBaseImage(promptId: string, settings: ComfyUISettings): Promise<HistoryCheckResult> {
  const historyUrl = `${settings.serverAddress}/history/${promptId}`;
  try {
    const response = await fetch(historyUrl);
    if (!response.ok) return { status: 'waiting' };

    const historyData = await response.json();
    const promptHistory = historyData[promptId];
    if (!promptHistory) return { status: 'waiting' };

    const isError = promptHistory.status?.status_str === 'error';
    if (isError) return { status: 'error' };

    const node79 = promptHistory.outputs?.['79'];
    if (node79?.images?.[0]) {
      const img = node79.images[0];
      const imageUrl = `${settings.serverAddress}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`;
      return {
        status: 'ready',
        imageUrl,
        imageInfo: { filename: img.filename, subfolder: img.subfolder, type: img.type },
      };
    }

    return { status: 'waiting' };
  } catch {
    return { status: 'waiting' };
  }
}

/**
 * Poll for base image at node 79 (smoothed output before upscale).
 * Returns image info (filename, subfolder, type) for uploading to ComfyUI input folder.
 */
async function pollForBaseImage(promptId: string, settings: ComfyUISettings, maxAttempts = 90): Promise<ImageInfo | null> {
  const historyUrl = `${settings.serverAddress}/history/${promptId}`;
  console.log('[pollForBaseImage] Polling for base output at node 79:', historyUrl);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const response = await fetch(historyUrl);
      if (!response.ok) continue;

      const historyData = await response.json();
      const promptHistory = historyData[promptId];
      if (!promptHistory) continue;

      const isError = promptHistory.status?.status_str === 'error';
      if (isError) {
        console.log('[pollForBaseImage] Workflow failed with error');
        return null;
      }

      const node79 = promptHistory.outputs?.['79'];
      if (node79?.images?.[0]) {
        const img = node79.images[0];
        console.log('[pollForBaseImage] Found base image:', img.filename);
        return { filename: img.filename, subfolder: img.subfolder, type: img.type };
      }
    } catch (error) {
      console.error('[pollForBaseImage] Poll error:', error);
    }
  }
  console.log('[pollForBaseImage] Polling timed out');
  return null;
}

/**
 * Upload base image to ComfyUI input folder, build standalone SeedVR upscale workflow,
 * and submit as a separate prompt. Returns the upscale prompt_id.
 *
 * Two-stage approach: ComfyUI needs to unload the QwenImage UNET (~19GB) before
 * SeedVR models can load on cuda:1. Separate prompts allow model eviction.
 */
async function sendSeedVRUpscale(baseImageInfo: ImageInfo, settings: ComfyUISettings, promptText?: string): Promise<string> {
  // Step 1: Fetch the base image from ComfyUI output
  const imageUrl = `${settings.serverAddress}/view?filename=${encodeURIComponent(baseImageInfo.filename)}&subfolder=${encodeURIComponent(baseImageInfo.subfolder)}&type=${baseImageInfo.type}`;
  console.log('[sendSeedVRUpscale] Fetching base image:', imageUrl);

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch base image: HTTP ${imageResponse.status}`);
  }
  const imageBlob = await imageResponse.blob();

  // Step 2: Upload to ComfyUI input folder
  const formData = new FormData();
  formData.append('image', imageBlob, baseImageInfo.filename);
  formData.append('overwrite', 'true');

  const uploadUrl = `${settings.serverAddress}/upload/image`;
  console.log('[sendSeedVRUpscale] Uploading to input folder:', uploadUrl);

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload image: HTTP ${uploadResponse.status}`);
  }
  const uploadResult = await uploadResponse.json();
  const uploadedFilename = uploadResult.name;
  console.log('[sendSeedVRUpscale] Uploaded as:', uploadedFilename);

  // Step 3: Build standalone upscale workflow with LoadImage node pointing to uploaded file
  const upscaleWorkflow = structuredClone(seedvrUpscaleStandaloneTemplate) as WorkflowTemplate;
  upscaleWorkflow["200"].inputs.image = uploadedFilename;
  upscaleWorkflow["124"].inputs.seed = Math.floor(Math.random() * 4294967295);

  console.log('[sendSeedVRUpscale] Submitting SeedVR upscale workflow');

  // Step 4: Submit upscale prompt with SeedVR litegraph workflow embedded for PNG drag-and-drop.
  // The base litegraph (with Note node 205 populated) lets users see the full generation pipeline
  // when dragging the upscaled image into ComfyUI.
  const promptUrl = `${settings.serverAddress}${settings.apiPath}`;
  const body: Record<string, unknown> = { prompt: upscaleWorkflow };

  // Build the base SeedVR litegraph with prompt populated in Note node for PNG metadata
  const liteGraphForPng = structuredClone(seedvrLiteGraphWorkflowTemplate) as LiteGraphWorkflow;
  for (const node of liteGraphForPng.nodes) {
    if (node.id === 205 && node.widgets_values) {
      node.widgets_values[0] = promptText || '';
    }
  }

  body.extra_data = {
    extra_pnginfo: {
      workflow: liteGraphForPng,
      prompt_text: promptText || '',
    }
  };
  const response = await fetch(promptUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...settings.headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`SeedVR upscale HTTP ${response.status}: ${response.statusText}`);
  }

  const result: ComfyUIPromptResponse = await response.json();
  console.log('[sendSeedVRUpscale] Upscale prompt_id:', result.prompt_id);
  return result.prompt_id;
}

/**
 * Build and submit an upscale workflow for a completed base image.
 * - qwen-t2i: re-submits full workflow with KSampler upscale nodes merged
 * - qwen-t2i-seedvr: uses standalone SeedVR upscale workflow via sendSeedVRUpscale
 * Returns the upscale prompt_id.
 */
async function buildAndSendUpscale(
  entry: PromptEntry,
  payload: ComfyUIPayload,
  settings: ComfyUISettings,
): Promise<string> {
  const workflowType = entry.workflowType || settings.builtInWorkflow;

  if (workflowType === 'qwen-t2i-seedvr') {
    if (!entry.baseImageInfo) throw new Error('No base image info for SeedVR upscale');
    return sendSeedVRUpscale(entry.baseImageInfo, settings, entry.text);
  }

  // qwen-t2i: rebuild full workflow with upscale nodes merged
  const seed = payload.seed === -1 ? Math.floor(Math.random() * 1000000000000) : payload.seed;
  const workflow: WorkflowTemplate = structuredClone(baseWorkflowTemplate) as WorkflowTemplate;

  workflow["3"].inputs.seed = seed;
  workflow["3"].inputs.steps = payload.steps;
  workflow["3"].inputs.cfg = payload.cfg;
  workflow["105"].inputs.text = payload.negativePrompt || "dust, dots, stain";
  workflow["118"].inputs.text = payload.prompt;

  const ratio = payload.aspectRatio.replace(/\s*[◻▭▯]$/, '');
  const dims = computeDimensionsForRatio(ratio, payload.megapixel);
  workflow["114"].inputs.aspect_ratio = snapToValidRatio(ratio);
  workflow["114"].inputs.megapixels = payload.megapixel;
  workflow["114"].inputs.width = dims.width;
  workflow["114"].inputs.height = dims.height;
  workflow["114"].inputs.preset = dims.preset;

  // Merge KSampler upscale nodes
  const upscaleNodes = structuredClone(upscaleNodesTemplate) as WorkflowTemplate;
  if (upscaleNodes["83"]) {
    upscaleNodes["83"].inputs.seed = Math.floor(Math.random() * 1000000000000);
  }
  Object.assign(workflow, upscaleNodes);

  console.log('[buildAndSendUpscale] qwen-t2i workflow with upscale, nodes:', Object.keys(workflow).join(', '));

  // Embed full prompt text in PNG metadata for recovery if original image deleted
  const promptUrl = `${settings.serverAddress}${settings.apiPath}`;
  const liteGraphWorkflow = buildLiteGraphWorkflow(payload, seed, workflowType);
  const body: Record<string, unknown> = {
    prompt: workflow,
    extra_data: {
      extra_pnginfo: {
        workflow: liteGraphWorkflow,
        prompt_text: entry.text,
      }
    }
  };
  const response = await fetch(promptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...settings.headers },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Upscale HTTP ${response.status}: ${response.statusText}`);
  }

  const result: ComfyUIPromptResponse = await response.json();
  console.log('[buildAndSendUpscale] Upscale prompt_id:', result.prompt_id);
  return result.prompt_id;
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

function buildLiteGraphWorkflow(payload: ComfyUIPayload, seed: number, workflowType: BuiltInWorkflowType = 'qwen-t2i'): LiteGraphWorkflow {
  // Select template based on workflow type
  const template = workflowType === 'qwen-t2i-seedvr'
    ? seedvrLiteGraphWorkflowTemplate
    : liteGraphWorkflowTemplate;

  // Clone the template workflow
  const lgWorkflow: LiteGraphWorkflow = structuredClone(template) as unknown as LiteGraphWorkflow;

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
      case 83: // KSampler - upscale sampler (standard workflow only)
        if (node.widgets_values && workflowType === 'qwen-t2i') {
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
      case 114: // AGSoft_Empty_Latent_QwenImage
        if (node.widgets_values) {
          const ratio = payload.aspectRatio.replace(/\s*[◻▭▯]$/, '');
          const dims = computeDimensionsForRatio(ratio, payload.megapixel);
          node.widgets_values[0] = 'Megapixels';          // size_mode
          node.widgets_values[1] = dims.preset;            // preset
          node.widgets_values[2] = dims.width;             // width
          node.widgets_values[3] = dims.height;            // height
          node.widgets_values[4] = payload.megapixel;      // megapixels
          node.widgets_values[5] = snapToValidRatio(ratio); // aspect_ratio (must be in node's dropdown)
          node.widgets_values[6] = 1;                      // batch_size
        }
        break;
      case 205: // Note - full prompt text (unconnected, visible when image dragged into ComfyUI)
        if (node.widgets_values) {
          node.widgets_values[0] = payload.prompt;
        }
        break;
    }
  }

  return lgWorkflow;
}

// Valid aspect ratios accepted by AGSoft_Empty_Latent_QwenImage node dropdown.
const AGSOFT_VALID_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21', '4:5', '5:4'];

/**
 * Snap an arbitrary aspect ratio to the closest one accepted by the AGSoft node.
 * Compares as decimal values (w/h) and picks the nearest match.
 */
function snapToValidRatio(ratio: string): string {
  if (AGSOFT_VALID_RATIOS.includes(ratio)) return ratio;

  const match = ratio.match(/^(\d+):(\d+)/);
  if (!match) return '16:9'; // fallback

  const target = parseInt(match[1]) / parseInt(match[2]);
  let closest = AGSOFT_VALID_RATIOS[0];
  let closestDiff = Infinity;

  for (const valid of AGSOFT_VALID_RATIOS) {
    const [w, h] = valid.split(':').map(Number);
    const diff = Math.abs(w / h - target);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = valid;
    }
  }

  console.log(`[Workflow] Snapped aspect ratio ${ratio} → ${closest}`);
  return closest;
}

// Valid presets from AGSoft_Empty_Latent_QwenImage dropdown, keyed by aspect ratio.
// When size_mode="Megapixels", the node computes dimensions from megapixels + aspect_ratio;
// the preset just needs to pass dropdown validation.
const AGSOFT_PRESET_MAP: Record<string, string> = {
  '1:1':  'Square - 1568x1568 (1:1)',
  '5:4':  'Landscape - 1120x896 (5:4)',
  '4:3':  'Landscape - 1792x1344 (4:3)',
  '3:2':  'Landscape - 1680x1120 (3:2)',
  '16:9': 'Landscape - 1792x1008 (16:9)',
  '2:1':  'Landscape - 2240x1120 (2:1)',
  '21:9': 'Landscape - 2240x1120 (2:1)',   // closest match
  '32:9': 'Landscape - 2912x1456 (2:1)',   // closest match
  '4:5':  'Portrait - 896x1120 (4:5)',
  '3:4':  'Portrait - 1008x1344 (3:4)',
  '2:3':  'Portrait - 1120x1680 (2:3)',
  '9:16': 'Portrait - 1008x1792 (9:16)',
  '1:2':  'Portrait - 1120x2240 (1:2)',
  '9:21': 'Portrait - 1120x2240 (1:2)',    // closest match
  '9:32': 'Portrait - 1120x2240 (1:2)',    // closest match
};

function computeDimensionsForRatio(ratio: string, megapixels: number): { width: number; height: number; preset: string } {
  const match = ratio.match(/^(\d+):(\d+)/);
  if (!match) return { width: 2128, height: 1232, preset: AGSOFT_PRESET_MAP['16:9'] };

  const rW = parseInt(match[1]);
  const rH = parseInt(match[2]);
  const totalPixels = megapixels * 1e6;
  const ratioValue = rW / rH;

  let width = Math.sqrt(totalPixels * ratioValue);
  let height = Math.sqrt(totalPixels / ratioValue);

  // Round to nearest multiple of 112 (div-112 for QwenImage latent)
  width = Math.round(width / 112) * 112;
  height = Math.round(height / 112) * 112;

  const preset = AGSOFT_PRESET_MAP[ratio] || AGSOFT_PRESET_MAP['16:9'];

  return { width, height, preset };
}

function buildComfyUIWorkflow(payload: ComfyUIPayload, workflowType: BuiltInWorkflowType = 'qwen-t2i'): object {
  const seed = payload.seed === -1 ? Math.floor(Math.random() * 1000000000000) : payload.seed;

  console.log('[buildComfyUIWorkflow] workflowType:', workflowType);

  // For SeedVR workflow, build base-only (no upscale nodes merged).
  // SeedVR upscale runs as a separate prompt to avoid OOM — the QwenImage UNET (~19GB on cuda:1)
  // must be unloaded before SeedVR models can load on the same GPU.
  if (workflowType === 'qwen-t2i-seedvr') {
    const workflow: WorkflowTemplate = structuredClone(seedvrBaseWorkflowTemplate) as WorkflowTemplate;

    // Apply dynamic parameters
    workflow["3"].inputs.seed = seed;
    workflow["3"].inputs.steps = payload.steps;
    workflow["3"].inputs.cfg = payload.cfg;
    workflow["105"].inputs.text = payload.negativePrompt || "dust, dots, stain";
    workflow["118"].inputs.text = payload.prompt;

    // Apply aspect ratio and megapixels to AGSoft_Empty_Latent_QwenImage (node 114)
    const seedvrRatio = payload.aspectRatio.replace(/\s*[◻▭▯]$/, '');
    const seedvrDims = computeDimensionsForRatio(seedvrRatio, payload.megapixel);
    workflow["114"].inputs.aspect_ratio = snapToValidRatio(seedvrRatio);
    workflow["114"].inputs.megapixels = payload.megapixel;
    workflow["114"].inputs.width = seedvrDims.width;
    workflow["114"].inputs.height = seedvrDims.height;
    workflow["114"].inputs.preset = seedvrDims.preset;

    // SeedVR base-only: no upscale nodes merged (two-stage to avoid OOM)
    console.log('[buildComfyUIWorkflow] SeedVR base-only workflow (upscale sent separately)');
    console.log('[buildComfyUIWorkflow] Workflow nodes:', Object.keys(workflow).join(', '));

    const liteGraphWorkflow = buildLiteGraphWorkflow(payload, seed, workflowType);
    return {
      prompt: workflow,
      extra_data: {
        extra_pnginfo: {
          workflow: liteGraphWorkflow,
          prompt_text: payload.prompt,
        }
      }
    };
  }

  // For standard qwen-t2i workflow, use existing merge approach
  const workflow: WorkflowTemplate = structuredClone(baseWorkflowTemplate) as WorkflowTemplate;

  workflow["3"].inputs.seed = seed;
  workflow["3"].inputs.steps = payload.steps;
  workflow["3"].inputs.cfg = payload.cfg;
  workflow["105"].inputs.text = payload.negativePrompt || "dust, dots, stain";
  workflow["118"].inputs.text = payload.prompt;

  // Apply aspect ratio and megapixels to AGSoft_Empty_Latent_QwenImage (node 114)
  const stdRatio = payload.aspectRatio.replace(/\s*[◻▭▯]$/, '');
  const stdDims = computeDimensionsForRatio(stdRatio, payload.megapixel);
  workflow["114"].inputs.aspect_ratio = snapToValidRatio(stdRatio);
  workflow["114"].inputs.megapixels = payload.megapixel;
  workflow["114"].inputs.width = stdDims.width;
  workflow["114"].inputs.height = stdDims.height;
  workflow["114"].inputs.preset = stdDims.preset;

  // Base-only: no upscale nodes merged. Upscale is user-triggered separately.
  console.log('[buildComfyUIWorkflow] Base-only workflow (no upscale merge)');
  console.log('[buildComfyUIWorkflow] Workflow nodes:', Object.keys(workflow).join(', '));

  // Build LiteGraph workflow for PNG embedding using the selected template
  const liteGraphWorkflow = buildLiteGraphWorkflow(payload, seed, workflowType);

  return {
    prompt: workflow,
    extra_data: {
      extra_pnginfo: {
        workflow: liteGraphWorkflow,
        prompt_text: payload.prompt,
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

interface PromptMetadata {
  aspectRatio?: string;
  negativePrompt?: string;
  cleanPrompt: string;
}

function parsePromptMetadata(promptText: string): PromptMetadata {
  const result: PromptMetadata = { cleanPrompt: promptText };

  // Match "Aspect Ratio: X:Y" pattern (case insensitive)
  const aspectRatioMatch = promptText.match(/^Aspect\s*Ratio:\s*(\d+:\d+)\s*$/im);

  if (aspectRatioMatch) {
    const ratio = aspectRatioMatch[1];
    // Map common ratios to their display format with orientation symbols
    const ratioMappings: Record<string, string> = {
      '1:1': '1:1 ◻',
      '5:4': '5:4 ▭',
      '4:3': '4:3 ▭',
      '3:2': '3:2 ▭',
      '16:9': '16:9 ▭',
      '2:1': '2:1 ▭',
      '21:9': '21:9 ▭',
      '32:9': '32:9 ▭',
      '4:5': '4:5 ▯',
      '3:4': '3:4 ▯',
      '2:3': '2:3 ▯',
      '9:16': '9:16 ▯',
      '1:2': '1:2 ▯',
      '9:21': '9:21 ▯',
      '9:32': '9:32 ▯',
    };

    result.aspectRatio = ratioMappings[ratio] || ratio;

    // Remove the aspect ratio line from prompt
    result.cleanPrompt = promptText
      .replace(/^Aspect\s*Ratio:\s*\d+:\d+\s*$/im, '')
      .replace(/\n\n+/g, '\n\n')
      .trim();
  }

  // Match "Negative: ..." pattern (case insensitive, captures rest of line)
  const negativeMatch = result.cleanPrompt.match(/^Negative:\s*(.+)$/im);
  if (negativeMatch) {
    result.negativePrompt = negativeMatch[1].trim();

    // Remove the negative prompt line from clean prompt
    result.cleanPrompt = result.cleanPrompt
      .replace(/^Negative:\s*.+$/im, '')
      .replace(/\n\n+/g, '\n\n')
      .trim();
  }

  return result;
}

function buildWorkflowJsonForClipboard(payload: ComfyUIPayload, workflowType: BuiltInWorkflowType = 'qwen-t2i'): string {
  const seed = payload.seed === -1 ? Math.floor(Math.random() * 1000000000000) : payload.seed;
  const liteGraphWorkflow = buildLiteGraphWorkflow(payload, seed, workflowType);
  return JSON.stringify(liteGraphWorkflow);
}

// --- Timing stats ---

async function getTimingStats(): Promise<TimingStats> {
  const result = await storage.local.get(STORAGE_KEYS.TIMING_STATS);
  return result[STORAGE_KEYS.TIMING_STATS] || { generationTimes: [], upscaleTimes: [] };
}

async function recordTimingSample(type: 'generation' | 'upscale', durationMs: number): Promise<void> {
  if (durationMs <= 0) return;
  const stats = await getTimingStats();
  const arr = type === 'generation' ? stats.generationTimes : stats.upscaleTimes;
  arr.push(durationMs);
  // Keep only the last N samples
  if (arr.length > MAX_TIMING_SAMPLES) {
    arr.splice(0, arr.length - MAX_TIMING_SAMPLES);
  }
  await storage.local.set({ [STORAGE_KEYS.TIMING_STATS]: stats });
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m${sec}s` : `${min}m`;
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
  pollForBaseImage,
  sendSeedVRUpscale,
  buildAndSendUpscale,
  checkHistoryForUpscaledImage,
  checkHistoryForBaseImage,
  getRelativeTime,
  parsePromptMetadata,
  buildWorkflowJsonForClipboard,
  getTimingStats,
  recordTimingSample,
  formatDuration,
};

export type { PromptMetadata, ImageInfo, HistoryCheckResult };
