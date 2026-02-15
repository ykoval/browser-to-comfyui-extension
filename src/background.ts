/// <reference types="chrome" />

import { getSettings, getHistory, addPromptEntry, sendToComfyUI, buildAndSendUpscale, cancelPrompt, updatePromptEntry, isPromptDuplicate, checkHistoryForUpscaledImage, checkHistoryForBaseImage, parsePromptMetadata, recordTimingSample } from './utils';
import type { ComfyUISettings, PromptEntry } from './types';

// --- Alarm-based polling constants ---
const POLL_ALARM_NAME = 'poll-generations';
const POLL_INTERVAL_MINUTES = 0.5; // 30 seconds (Chrome minimum for alarms)
const MAX_POLL_TICKS_BASE = 12;    // 12 × 30s = 6 minutes (base generation)
const MAX_POLL_TICKS_UPSCALE = 12; // 12 × 30s = 6 minutes (upscale)

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
  const hasInFlight = history.some(e => e.imageStatus === 'generating' || e.upscaleStatus === 'upscaling');
  if (!hasInFlight) {
    await chrome.alarms.clear(POLL_ALARM_NAME);
    console.log('[Background] Cleared poll alarm (no in-flight work)');
  }
}

// --- Generation orchestration ---

function buildPayload(text: string, settings: ComfyUISettings) {
  const metadata = parsePromptMetadata(text);
  return {
    prompt: metadata.cleanPrompt,
    negativePrompt: metadata.negativePrompt || settings.negativePrompt,
    seed: settings.seed,
    steps: settings.steps,
    cfg: settings.cfg,
    aspectRatio: metadata.aspectRatio || settings.aspectRatio,
    megapixel: settings.megapixel,
  };
}

// In-memory lock to prevent concurrent SeedVR submissions from race conditions
let seedvrSubmitting = false;

/**
 * Check if another SeedVR generation is already in-flight (base or upscale stage).
 * SeedVR must be serialized to avoid OOM from model thrashing on cuda:1.
 * Excludes the given entryId from the check (it's the one we're deciding about).
 */
async function hasSeedVRInFlight(excludeEntryId?: string): Promise<boolean> {
  const history = await getHistory();
  return history.some(e =>
    e.id !== excludeEntryId &&
    e.imageStatus === 'generating' &&
    e.workflowType === 'qwen-t2i-seedvr' &&
    e.promptId // has actually been submitted to ComfyUI
  );
}

/**
 * Submit workflow to ComfyUI and set up entry for alarm-based polling.
 * Returns immediately — the alarm handler does the rest.
 *
 * SeedVR generations are serialized: if another SeedVR is in-flight,
 * the entry is marked 'generating' with stage 'queued' and no promptId.
 * The alarm tick handler will submit it when the slot is free.
 */
async function startGeneration(entryId: string, text: string): Promise<void> {
  const settings = await getSettings();
  const isSeedVR = settings.builtInWorkflow === 'qwen-t2i-seedvr';

  // SeedVR: serialize to avoid OOM from model thrashing
  if (isSeedVR && (seedvrSubmitting || await hasSeedVRInFlight(entryId))) {
    console.log(`[Background] SeedVR slot busy, queueing entry ${entryId.substring(0, 8)}`);
    await updatePromptEntry(entryId, {
      imageStatus: 'generating',
      generationStage: 'queued',
      workflowType: settings.builtInWorkflow,
      pollAttempts: 0,
    });
    await ensurePollAlarm();
    return;
  }

  try {
    if (isSeedVR) seedvrSubmitting = true;
    const promptId = await sendToComfyUI(buildPayload(text, settings), settings);

    await updatePromptEntry(entryId, {
      imageStatus: 'generating',
      promptId,
      generationStage: 'polling',
      basePromptId: promptId,
      pollAttempts: 0,
      workflowType: settings.builtInWorkflow,
      generationStartedAt: Date.now(),
    });
    if (isSeedVR) seedvrSubmitting = false;

    await ensurePollAlarm();
    console.log(`[Background] Generation started: entry=${entryId.substring(0, 8)}, promptId=${promptId}, workflow=${settings.builtInWorkflow}`);

    // Quick first check after 5s (best-effort, alarm is the fallback)
    setTimeout(() => handleAlarmTick(), 5000);
  } catch (error) {
    if (isSeedVR) seedvrSubmitting = false;
    console.error('[Background] Failed to start generation:', error);
    await updatePromptEntry(entryId, { imageStatus: 'error' });
  }
}

// --- Alarm tick handler (state machine) ---

async function handleAlarmTick(): Promise<void> {
  const history = await getHistory();
  const inFlight = history.filter(e => e.imageStatus === 'generating' && e.promptId);
  const queued = history.filter(e => e.imageStatus === 'generating' && e.generationStage === 'queued' && !e.promptId);
  const upscaleActive = history.filter(e => e.upscaleStatus === 'upscaling' && e.upscalePromptId);
  const upscaleQueued = history.filter(e => e.upscaleStatus === 'upscaling' && !e.upscalePromptId);

  if (inFlight.length === 0 && queued.length === 0 && upscaleActive.length === 0 && upscaleQueued.length === 0) {
    await clearPollAlarmIfIdle();
    return;
  }

  const settings = await getSettings();
  console.log(`[Background] Alarm tick: ${inFlight.length} generating, ${queued.length} queued, ${upscaleActive.length} upscaling, ${upscaleQueued.length} upscale-queued`);

  // Process active base generations — poll node 79
  for (const entry of inFlight) {
    try {
      await processGenerationTick(entry, settings);
    } catch (error) {
      console.error(`[Background] Tick error for ${entry.id.substring(0, 8)}:`, error);
      await updatePromptEntry(entry.id, { imageStatus: 'error', generationStage: undefined });
    }
  }

  // Process active upscales — poll node 81
  for (const entry of upscaleActive) {
    try {
      await processUpscaleTick(entry, settings);
    } catch (error) {
      console.error(`[Background] Upscale tick error for ${entry.id.substring(0, 8)}:`, error);
      await updatePromptEntry(entry.id, { upscaleStatus: 'error' });
    }
  }

  // Promote queued SeedVR base entries if slot is free
  const freshHistory = await getHistory();
  const freshQueued = freshHistory.filter(e => e.imageStatus === 'generating' && e.generationStage === 'queued' && !e.promptId);
  if (freshQueued.length > 0 && !await hasSeedVRInFlight()) {
    const next = freshQueued[0];
    console.log(`[Background] SeedVR slot free, submitting queued entry ${next.id.substring(0, 8)}`);
    try {
      const promptId = await sendToComfyUI(buildPayload(next.text, settings), settings);
      await updatePromptEntry(next.id, {
        promptId,
        generationStage: 'polling',
        basePromptId: promptId,
        pollAttempts: 0,
        generationStartedAt: Date.now(),
      });
      console.log(`[Background] Queued SeedVR started: promptId=${promptId}`);
    } catch (error) {
      console.error(`[Background] Failed to start queued SeedVR:`, error);
      await updatePromptEntry(next.id, { imageStatus: 'error', generationStage: undefined });
    }
  }

  // Promote queued upscales — only when no base generations are in-flight
  // This prevents model thrashing (QwenImage must fully unload before upscale models load)
  if (!await hasBaseGenerationsInFlight()) {
    const freshHistory2 = await getHistory();
    const pendingUpscales = freshHistory2.filter(e => e.upscaleStatus === 'upscaling' && !e.upscalePromptId);
    if (pendingUpscales.length > 0) {
      const next = pendingUpscales[0];
      console.log(`[Background] Base batch done, submitting queued upscale ${next.id.substring(0, 8)}`);
      await submitUpscale(next, settings);
    }
  }

  await clearPollAlarmIfIdle();
}

/**
 * Base generation polling — check node 79 for base image.
 * When ready, mark done with base image URL. No auto-upscale.
 */
async function processGenerationTick(entry: PromptEntry, settings: ComfyUISettings): Promise<void> {
  const attempts = (entry.pollAttempts || 0) + 1;

  if (attempts > MAX_POLL_TICKS_BASE) {
    console.log(`[Background] Base timeout for ${entry.id.substring(0, 8)} (${attempts} ticks)`);
    await updatePromptEntry(entry.id, { imageStatus: 'error', generationStage: undefined });
    return;
  }

  const result = await checkHistoryForBaseImage(entry.promptId!, settings);

  if (result.status === 'ready' && result.imageUrl) {
    const doneAt = Date.now();
    console.log(`[Background] Base image ready for ${entry.id.substring(0, 8)}`);
    await updatePromptEntry(entry.id, {
      imageStatus: 'done',
      imageUrl: result.imageUrl,
      baseImageUrl: result.imageUrl,
      baseImageInfo: result.imageInfo,
      generationStage: undefined,
      generationDoneAt: doneAt,
    });
    // Record timing sample for average calculation
    if (entry.generationStartedAt) {
      await recordTimingSample('generation', doneAt - entry.generationStartedAt);
    }
  } else if (result.status === 'error') {
    await updatePromptEntry(entry.id, { imageStatus: 'error', generationStage: undefined });
  } else {
    await updatePromptEntry(entry.id, { pollAttempts: attempts });
  }
}

/**
 * Upscale polling — check node 81 for upscaled image.
 */
async function processUpscaleTick(entry: PromptEntry, settings: ComfyUISettings): Promise<void> {
  const attempts = (entry.upscalePollAttempts || 0) + 1;

  if (attempts > MAX_POLL_TICKS_UPSCALE) {
    console.log(`[Background] Upscale timeout for ${entry.id.substring(0, 8)} (${attempts} ticks)`);
    await updatePromptEntry(entry.id, { upscaleStatus: 'error' });
    return;
  }

  const result = await checkHistoryForUpscaledImage(entry.upscalePromptId!, settings);

  if (result.status === 'ready' && result.imageUrl) {
    const doneAt = Date.now();
    console.log(`[Background] Upscale complete for ${entry.id.substring(0, 8)}`);
    await updatePromptEntry(entry.id, {
      upscaleStatus: 'done',
      imageUrl: result.imageUrl, // Update display image to upscaled version
      upscaleDoneAt: doneAt,
    });
    // Record timing sample for average calculation
    if (entry.upscaleStartedAt) {
      await recordTimingSample('upscale', doneAt - entry.upscaleStartedAt);
    }
  } else if (result.status === 'error') {
    await updatePromptEntry(entry.id, { upscaleStatus: 'error' });
  } else {
    await updatePromptEntry(entry.id, { upscalePollAttempts: attempts });
  }
}

/**
 * Check if any base generations are pending (generating or queued).
 * Includes both active (with promptId) and queued (without promptId) entries.
 * Upscales must wait until ALL base work is done to avoid model thrashing.
 */
async function hasBaseGenerationsInFlight(): Promise<boolean> {
  const history = await getHistory();
  return history.some(e => e.imageStatus === 'generating');
}

/**
 * User-triggered upscale for a completed base image.
 * Queues the upscale — actual submission happens in alarm tick when no base generations are in-flight.
 * This prevents model thrashing (QwenImage UNET vs upscale models on same GPU).
 */
async function startUpscale(entryId: string): Promise<void> {
  const history = await getHistory();
  const entry = history.find(e => e.id === entryId);
  if (!entry || entry.imageStatus !== 'done') {
    console.error(`[Background] Cannot upscale entry ${entryId.substring(0, 8)}: not done`);
    return;
  }

  // Mark as queued for upscale — alarm tick will submit when base batch is done
  await updatePromptEntry(entryId, {
    upscaleStatus: 'upscaling',
    upscalePollAttempts: 0,
  });
  await ensurePollAlarm();
  console.log(`[Background] Upscale queued: entry=${entryId.substring(0, 8)}`);
}

/**
 * Actually submit an upscale workflow to ComfyUI.
 * Called from alarm tick when base generation batch is done.
 */
async function submitUpscale(entry: PromptEntry, settings: ComfyUISettings): Promise<void> {
  const payload = buildPayload(entry.text, settings);

  try {
    const upscalePromptId = await buildAndSendUpscale(entry, payload, settings);
    await updatePromptEntry(entry.id, {
      upscalePromptId,
      upscalePollAttempts: 0,
      upscaleStartedAt: Date.now(),
    });
    console.log(`[Background] Upscale submitted: entry=${entry.id.substring(0, 8)}, promptId=${upscalePromptId}`);
  } catch (error) {
    console.error(`[Background] Failed to submit upscale:`, error);
    await updatePromptEntry(entry.id, { upscaleStatus: 'error' });
  }
}

// --- Alarm listener ---
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) {
    handleAlarmTick();
  }
});

// --- Service worker startup recovery ---
// When Chrome restarts the service worker, re-establish alarm if work is in-flight
(async () => {
  const history = await getHistory();
  const hasInFlight = history.some(e => e.imageStatus === 'generating' || e.upscaleStatus === 'upscaling');
  if (hasInFlight) {
    console.log('[Background] Service worker started with in-flight work, ensuring alarm');
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
  } else if (message.type === 'START_UPSCALE') {
    startUpscale(message.entryId);
    sendResponse({ success: true });
  } else if (message.type === 'CANCEL_UPSCALE') {
    handleCancelUpscaleMessage(message.entryId, message.promptId);
    sendResponse({ success: true });
  } else if (message.type === 'CANCEL_ALL') {
    handleCancelAll();
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

async function handleCancelUpscaleMessage(entryId: string, promptId: string): Promise<void> {
  const settings = await getSettings();
  await cancelPrompt(promptId, settings);
  await updatePromptEntry(entryId, { upscaleStatus: 'error', upscalePromptId: undefined });
}

async function handleCancelAll(): Promise<void> {
  const settings = await getSettings();
  const history = await getHistory();

  for (const entry of history) {
    // Cancel active base generations
    if (entry.imageStatus === 'generating') {
      if (entry.promptId) {
        try { await cancelPrompt(entry.promptId, settings); } catch { /* ignore */ }
      }
      await updatePromptEntry(entry.id, { imageStatus: 'error', generationStage: undefined });
    }
    // Cancel active/queued upscales
    if (entry.upscaleStatus === 'upscaling') {
      if (entry.upscalePromptId) {
        try { await cancelPrompt(entry.upscalePromptId, settings); } catch { /* ignore */ }
      }
      await updatePromptEntry(entry.id, { upscaleStatus: 'error', upscalePromptId: undefined });
    }
  }

  await chrome.alarms.clear(POLL_ALARM_NAME);
  console.log('[Background] Cancelled all generations and upscales');
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
