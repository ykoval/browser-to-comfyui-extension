/// <reference types="chrome" />

import { getSettings, addPromptEntry, sendToComfyUI, pollForImage, updatePromptEntry, isPromptDuplicate } from './utils';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'saveAsPrompt',
      title: 'Save as Prompt',
      contexts: ['selection'],
    });
  });
});

function buildPayload(text: string, settings: {
  negativePrompt: string;
  seed: number;
  steps: number;
  cfg: number;
  aspectRatio: string;
  megapixel: number;
  enableUpscale: boolean;
}) {
  return {
    prompt: text,
    negativePrompt: settings.negativePrompt,
    seed: settings.seed,
    steps: settings.steps,
    cfg: settings.cfg,
    aspectRatio: settings.aspectRatio,
    megapixel: settings.megapixel,
    enableUpscale: settings.enableUpscale,
  };
}

chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
  if (info.menuItemId === 'saveAsPrompt' && info.selectionText) {
    const settings = await getSettings();
    const entry = await addPromptEntry(info.selectionText);

    if (settings.autoSend) {
      try {
        const promptId = await sendToComfyUI(buildPayload(entry.text, settings), settings);
        await updatePromptEntry(entry.id, { imageStatus: 'generating', promptId });
        
        const imageUrl = await pollForImage(promptId, settings);
        if (imageUrl) {
          await updatePromptEntry(entry.id, { imageStatus: 'done', imageUrl });
        } else {
          await updatePromptEntry(entry.id, { imageStatus: 'error' });
        }
      } catch (error) {
        console.error('Auto-send failed:', error);
        await updatePromptEntry(entry.id, { imageStatus: 'error' });
      }
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log(`[Background] Received message:`, message.type);
  if (message.type === 'AUTO_DETECTED_PROMPT') {
    console.log(`[Background] Processing prompt: "${message.text?.substring(0, 50)}..."`);
    handleAutoDetectedPrompt(message.text);
    sendResponse({ success: true });
  } else if (message.type === 'OPEN_POPUP') {
    chrome.action.openPopup();
    sendResponse({ success: true });
  }
  return true;
});

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
    try {
      const promptId = await sendToComfyUI(buildPayload(entry.text, settings), settings);
      await updatePromptEntry(entry.id, { imageStatus: 'generating', promptId });

      const imageUrl = await pollForImage(promptId, settings);
      if (imageUrl) {
        await updatePromptEntry(entry.id, { imageStatus: 'done', imageUrl });
      } else {
        await updatePromptEntry(entry.id, { imageStatus: 'error' });
      }
    } catch (error) {
      console.error('Auto-detect auto-send failed:', error);
      await updatePromptEntry(entry.id, { imageStatus: 'error' });
    }
  }
}

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
          try {
            const promptId = await sendToComfyUI(buildPayload(entry.text, settings), settings);
            await updatePromptEntry(entry.id, { imageStatus: 'generating', promptId });
            
            const imageUrl = await pollForImage(promptId, settings);
            if (imageUrl) {
              await updatePromptEntry(entry.id, { imageStatus: 'done', imageUrl });
            } else {
              await updatePromptEntry(entry.id, { imageStatus: 'error' });
            }
          } catch (error) {
            console.error('Shortcut auto-send failed:', error);
            await updatePromptEntry(entry.id, { imageStatus: 'error' });
          }
        }
      }
    }
  }
});
