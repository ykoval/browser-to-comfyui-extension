/// <reference types="chrome" />

import { getSettings, getHistory, addPromptEntry, sendToComfyUI, sendSeedVRUpscale, cancelPrompt, updatePromptEntry, isPromptDuplicate, checkHistoryForUpscaledImage, checkHistoryForBaseImage, parsePromptMetadata } from './utils';
import type { ComfyUISettings, PromptEntry } from './types';

// --- Alarm-based polling constants ---
const POLL_ALARM_NAME = 'poll-generations';
const POLL_INTERVAL_MINUTES = 0.5; // 30 seconds (Chrome minimum for alarms)
const MAX_POLL_TICKS_STANDARD = 12; // 12 × 30s = 6 minutes
const MAX_POLL_TICKS_SEEDVR_BASE = 6; // 6 × 30s = 3 minutes
const MAX_POLL_TICKS_SEEDVR_UPSCALE = 12; // 12 × 30s = 6 minutes

// --- Context menu setup ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'saveAsPrompt',
      title: 'Save as Prompt',
      contexts: ['selection'],
    });
  });
});

// --- Alarm management ---

async function ensurePollAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(POLL_ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(POLL_ALARM_NAME, {
      delayInMinutes: POLL_INTERVAL_MINUTES,
      periodInMinutes: POLL_INTERVAL_MINUTES,
    });
    console.log('[Background] Created poll alarm');
  }
}

async function clearPollAlarmIfIdle(): Promise<void> {
  const history = await getHistory();
  const hasInFlight = history.some(e => e.imageStatus === 'generating');
  if (!hasInFlight) {
    await chrome.alarms.clear(POLL_ALARM_NAME);
    console.log('[Background] Cleared poll alarm (no in-flight generations)');
  }
}

// --- Generation orchestration ---

function buildPayload(text: string, settings: ComfyUISettings) {
  const metadata = parsePromptMetadata(text);
  return {
    prompt: metadata.cleanPrompt,
    negativePrompt: settings.negativePrompt,
    seed: settings.seed,
    steps: settings.steps,
    cfg: settings.cfg,
    aspectRatio: metadata.aspectRatio || settings.aspectRatio,
    megapixel: settings.megapixel,
  };
}

/**
 * Submit workflow to ComfyUI and set up entry for alarm-based polling.
 * Returns immediately — the alarm handler does the rest.
 */
async function startGeneration(entryId: string, text: string): Promise<void> {
  const settings = await getSettings();

  try {
    const promptId = await sendToComfyUI(buildPayload(text, settings), settings);
    const isSeedVR = settings.builtInWorkflow === 'qwen-t2i-seedvr';

    await updatePromptEntry(entryId, {
      imageStatus: 'generating',
      promptId,
      generationStage: isSeedVR ? 'polling-base' : 'polling-upscale',
      basePromptId: promptId,
      pollAttempts: 0,
      workflowType: settings.builtInWorkflow,
    });

    await ensurePollAlarm();
    console.log(`[Background] Generation started: entry=${entryId.substring(0, 8)}, promptId=${promptId}, workflow=${settings.builtInWorkflow}`);

    // Quick first check after 5s (best-effort, alarm is the fallback)
    setTimeout(() => handleAlarmTick(), 5000);
  } catch (error) {
    console.error('[Background] Failed to start generation:', error);
    await updatePromptEntry(entryId, { imageStatus: 'error' });
  }
}

// --- Alarm tick handler (state machine) ---

async function handleAlarmTick(): Promise<void> {
  const history = await getHistory();
  const inFlight = history.filter(e => e.imageStatus === 'generating' && e.promptId);

  if (inFlight.length === 0) {
    await clearPollAlarmIfIdle();
    return;
  }

  const settings = await getSettings();
  console.log(`[Background] Alarm tick: ${inFlight.length} in-flight generation(s)`);

  for (const entry of inFlight) {
    try {
      await processGenerationTick(entry, settings);
    } catch (error) {
      console.error(`[Background] Tick error for ${entry.id.substring(0, 8)}:`, error);
      await updatePromptEntry(entry.id, { imageStatus: 'error', generationStage: undefined });
    }
  }

  await clearPollAlarmIfIdle();
}

async function processGenerationTick(entry: PromptEntry, settings: ComfyUISettings): Promise<void> {
  const attempts = (entry.pollAttempts || 0) + 1;
  const stage = entry.generationStage || 'polling-upscale';

  // Determine max attempts based on stage
  let maxAttempts: number;
  if (stage === 'polling-base') {
    maxAttempts = MAX_POLL_TICKS_SEEDVR_BASE;
  } else if (stage === 'polling-upscale' && entry.workflowType === 'qwen-t2i-seedvr') {
    maxAttempts = MAX_POLL_TICKS_SEEDVR_UPSCALE;
  } else {
    maxAttempts = MAX_POLL_TICKS_STANDARD;
  }

  if (attempts > maxAttempts) {
    console.log(`[Background] Timeout for ${entry.id.substring(0, 8)} at stage ${stage} (${attempts} ticks)`);
    await updatePromptEntry(entry.id, { imageStatus: 'error', generationStage: undefined });
    return;
  }

  switch (stage) {
    case 'polling-base': {
      // SeedVR stage 1: check node 79 for base image
      const result = await checkHistoryForBaseImage(entry.promptId!, settings);

      if (result.status === 'ready' && result.imageInfo) {
        console.log(`[Background] Base image ready for ${entry.id.substring(0, 8)}, starting upscale`);
        await updatePromptEntry(entry.id, {
          generationStage: 'uploading-upscale',
          pollAttempts: 0,
        });
        // Immediately attempt upload + submit in this same tick
        await handleUpscaleSubmission(entry, result.imageInfo, settings);
      } else if (result.status === 'error') {
        await updatePromptEntry(entry.id, { imageStatus: 'error', generationStage: undefined });
      } else {
        await updatePromptEntry(entry.id, { pollAttempts: attempts });
      }
      break;
    }

    case 'uploading-upscale': {
      // Retry upload+submit if previous tick failed mid-way
      const result = await checkHistoryForBaseImage(entry.basePromptId!, settings);
      if (result.status === 'ready' && result.imageInfo) {
        await handleUpscaleSubmission(entry, result.imageInfo, settings);
      } else {
        console.log(`[Background] Cannot recover base image for upscale, marking error`);
        await updatePromptEntry(entry.id, { imageStatus: 'error', generationStage: undefined });
      }
      break;
    }

    case 'polling-upscale': {
      // Both qwen-t2i and SeedVR stage 2: check node 81
      const result = await checkHistoryForUpscaledImage(entry.promptId!, settings);

      if (result.status === 'ready' && result.imageUrl) {
        console.log(`[Background] Generation complete for ${entry.id.substring(0, 8)}`);
        await updatePromptEntry(entry.id, {
          imageStatus: 'done',
          imageUrl: result.imageUrl,
          generationStage: undefined,
        });
      } else if (result.status === 'error') {
        await updatePromptEntry(entry.id, { imageStatus: 'error', generationStage: undefined });
      } else {
        await updatePromptEntry(entry.id, { pollAttempts: attempts });
      }
      break;
    }
  }
}

async function handleUpscaleSubmission(
  entry: PromptEntry,
  baseImageInfo: { filename: string; subfolder: string; type: string },
  settings: ComfyUISettings,
): Promise<void> {
  try {
    const upscalePromptId = await sendSeedVRUpscale(baseImageInfo, settings);
    await updatePromptEntry(entry.id, {
      promptId: upscalePromptId,
      generationStage: 'polling-upscale',
      pollAttempts: 0,
    });
    console.log(`[Background] SeedVR upscale submitted: ${upscalePromptId}`);
  } catch (error) {
    console.error(`[Background] SeedVR upscale failed for ${entry.id.substring(0, 8)}:`, error);
    await updatePromptEntry(entry.id, { imageStatus: 'error', generationStage: undefined });
  }
}

// --- Alarm listener ---
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) {
    handleAlarmTick();
  }
});

// --- Service worker startup recovery ---
// When Chrome restarts the service worker, re-establish alarm if generations are in-flight
(async () => {
  const history = await getHistory();
  const hasInFlight = history.some(e => e.imageStatus === 'generating');
  if (hasInFlight) {
    console.log('[Background] Service worker started with in-flight generations, ensuring alarm');
    await ensurePollAlarm();
  }
})();

// --- Message handlers ---
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log(`[Background] Received message:`, message.type);

  if (message.type === 'AUTO_DETECTED_PROMPT') {
    console.log(`[Background] Processing prompt: "${message.text?.substring(0, 50)}..."`);
    handleAutoDetectedPrompt(message.text);
    sendResponse({ success: true });
  } else if (message.type === 'OPEN_POPUP') {
    chrome.action.openPopup();
    sendResponse({ success: true });
  } else if (message.type === 'START_GENERATION') {
    handleStartGenerationMessage(message.entryId, message.text, message.isRegenerate);
    sendResponse({ success: true });
  } else if (message.type === 'CANCEL_GENERATION') {
    handleCancelMessage(message.entryId, message.promptId);
    sendResponse({ success: true });
  }

  return true;
});

async function handleStartGenerationMessage(entryId: string, text: string, isRegenerate?: boolean): Promise<void> {
  if (isRegenerate) {
    const history = await getHistory();
    const entry = history.find(e => e.id === entryId);
    if (entry) {
      const newCount = (entry.generationCount || 0) + 1;
      await updatePromptEntry(entryId, { imageStatus: 'generating', generationCount: newCount });
    }
  }
  await startGeneration(entryId, text);
}

async function handleCancelMessage(entryId: string, promptId: string): Promise<void> {
  const settings = await getSettings();
  await cancelPrompt(promptId, settings);
  await updatePromptEntry(entryId, { imageStatus: 'error', generationStage: undefined });
}

// --- Auto-detected prompt handler ---
async function handleAutoDetectedPrompt(text: string) {
  console.log(`[Background] Checking duplicate for: "${text.substring(0, 50)}..."`);
  const isDuplicate = await isPromptDuplicate(text);
  console.log(`[Background] isDuplicate: ${isDuplicate}`);
  if (isDuplicate) {
    console.log(`[Background] Skipping duplicate`);
    return;
  }

  const settings = await getSettings();
  console.log(`[Background] Adding to history...`);
  const entry = await addPromptEntry(text);
  console.log(`[Background] Added entry:`, entry.id);

  if (settings.autoSend) {
    await startGeneration(entry.id, entry.text);
  }
}

// --- Context menu handler ---
chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, _tab?: chrome.tabs.Tab) => {
  if (info.menuItemId === 'saveAsPrompt' && info.selectionText) {
    const settings = await getSettings();
    const entry = await addPromptEntry(info.selectionText);

    if (settings.autoSend) {
      await startGeneration(entry.id, entry.text);
    }
  }
});

// --- Keyboard shortcut handler ---
chrome.commands.onCommand.addListener(async (command: string) => {
  if (command === 'save_prompt_shortcut') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString(),
      });
      const selectedText = result[0]?.result;
      if (selectedText) {
        const settings = await getSettings();
        const entry = await addPromptEntry(selectedText);

        if (settings.autoSend) {
          await startGeneration(entry.id, entry.text);
        }
      }
    }
  }
});
