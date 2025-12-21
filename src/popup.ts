/// <reference types="chrome" />

import { getSettings, saveSettings, getHistory, clearHistory, getActiveTab, setActiveTab, fetchComfyUIQueue, cancelPrompt, deletePromptEntry, addPromptEntry, sendToComfyUI, pollForImage, updatePromptEntry, getRelativeTime } from './utils';
import { PromptEntry, ComfyUISettings, ASPECT_RATIOS } from './types';

class PopupApp {
  private promptInput: HTMLTextAreaElement;
  private generateBtn: HTMLButtonElement;
  private autoSendToggle: HTMLInputElement;
  private historyList: HTMLElement;
  private clearHistoryBtn: HTMLButtonElement;
  private serverAddressInput: HTMLInputElement;
  private negativePromptInput: HTMLTextAreaElement;
  private seedInput: HTMLInputElement;
  private stepsInput: HTMLInputElement;
  private cfgInput: HTMLInputElement;
  private enableSeparatorToggle: HTMLInputElement;
  private aspectRatioSelect: HTMLSelectElement;
  private megapixelInput: HTMLInputElement;
  private enableUpscaleToggle: HTMLInputElement;
  private saveSettingsBtn: HTMLButtonElement;
  private settingsStatus: HTMLElement;
  private tabBtns: NodeListOf<HTMLButtonElement>;
  private tabContents: NodeListOf<HTMLElement>;
  private settings!: ComfyUISettings;
  private history!: PromptEntry[];

  constructor() {
    this.promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
    this.generateBtn = document.getElementById('generateBtn') as HTMLButtonElement;
    this.autoSendToggle = document.getElementById('autoSendToggle') as HTMLInputElement;
    this.historyList = document.getElementById('historyList') as HTMLElement;
    this.clearHistoryBtn = document.getElementById('clearHistoryBtn') as HTMLButtonElement;
    this.serverAddressInput = document.getElementById('serverAddress') as HTMLInputElement;
    this.negativePromptInput = document.getElementById('negativePrompt') as HTMLTextAreaElement;
    this.seedInput = document.getElementById('seed') as HTMLInputElement;
    this.stepsInput = document.getElementById('steps') as HTMLInputElement;
    this.cfgInput = document.getElementById('cfg') as HTMLInputElement;
    this.enableSeparatorToggle = document.getElementById('enableSeparator') as HTMLInputElement;
    this.aspectRatioSelect = document.getElementById('aspectRatio') as HTMLSelectElement;
    this.megapixelInput = document.getElementById('megapixel') as HTMLInputElement;
    this.enableUpscaleToggle = document.getElementById('enableUpscale') as HTMLInputElement;
    this.saveSettingsBtn = document.getElementById('saveSettingsBtn') as HTMLButtonElement;
    this.settingsStatus = document.getElementById('settingsStatus') as HTMLElement;
    this.tabBtns = document.querySelectorAll('.tab-btn') as NodeListOf<HTMLButtonElement>;
    this.tabContents = document.querySelectorAll('.tab-content') as NodeListOf<HTMLElement>;

    this.initAspectRatioOptions();
    this.init();
  }

  private initAspectRatioOptions() {
    ASPECT_RATIOS.forEach(ratio => {
      const option = document.createElement('option');
      option.value = ratio;
      option.textContent = ratio;
      this.aspectRatioSelect.appendChild(option);
    });
  }

  private async init() {
    this.settings = await getSettings();
    this.history = await getHistory();
    await this.restoreActiveTab();
    this.updateUI();
    this.bindEvents();
    this.syncWithComfyUIQueue();
  }

  private async restoreActiveTab() {
    const activeTab = await getActiveTab();
    this.tabBtns.forEach(btn => btn.classList.remove('active'));
    this.tabContents.forEach(content => content.classList.remove('active'));
    const tabBtn = document.querySelector(`[data-tab="${activeTab}"]`) as HTMLButtonElement;
    if (tabBtn) tabBtn.classList.add('active');
    document.getElementById(`${activeTab}-tab`)?.classList.add('active');
  }

  private async syncWithComfyUIQueue() {
    const queue = await fetchComfyUIQueue(this.settings);
    const runningIds = new Set(queue.running.map(q => q.promptId));
    const pendingIds = new Set(queue.pending.map(q => q.promptId));
    
    let updated = false;
    for (const entry of this.history) {
      if (entry.imageStatus === 'generating' && entry.promptId) {
        if (!runningIds.has(entry.promptId) && !pendingIds.has(entry.promptId)) {
          const imageUrl = await this.checkHistoryForImage(entry.promptId);
          if (imageUrl) {
            await updatePromptEntry(entry.id, { imageStatus: 'done', imageUrl });
          } else {
            await updatePromptEntry(entry.id, { imageStatus: 'error' });
          }
          updated = true;
        }
      }
    }
    if (updated) await this.refreshHistory();
  }

  private async checkHistoryForImage(promptId: string): Promise<string | null> {
    const historyUrl = `${this.settings.serverAddress}/history/${promptId}`;
    try {
      const response = await fetch(historyUrl);
      if (!response.ok) return null;
      const data = await response.json();
      const promptHistory = data[promptId];
      if (!promptHistory?.outputs) return null;
      
      const upscaledNode = promptHistory.outputs['81'];
      const regularNode = promptHistory.outputs['79'];
      const saveImageNode = upscaledNode?.images?.[0] ? upscaledNode : regularNode;
      
      if (saveImageNode?.images?.[0]) {
        const img = saveImageNode.images[0];
        return `${this.settings.serverAddress}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`;
      }
    } catch (e) {
      console.error('Check history error:', e);
    }
    return null;
  }

  private updateUI() {
    this.autoSendToggle.checked = this.settings.autoSend;
    this.serverAddressInput.value = this.settings.serverAddress;
    this.negativePromptInput.value = this.settings.negativePrompt;
    this.seedInput.value = this.settings.seed.toString();
    this.stepsInput.value = this.settings.steps.toString();
    this.cfgInput.value = this.settings.cfg.toString();
    this.enableSeparatorToggle.checked = this.settings.enableSeparator;
    this.aspectRatioSelect.value = this.settings.aspectRatio;
    this.megapixelInput.value = this.settings.megapixel.toString();
    this.enableUpscaleToggle.checked = this.settings.enableUpscale;
    this.renderHistory();
  }

  private bindEvents() {
    this.generateBtn.addEventListener('click', this.handleGenerate.bind(this));
    this.autoSendToggle.addEventListener('change', this.handleAutoSendToggle.bind(this));
    this.saveSettingsBtn.addEventListener('click', this.handleSaveSettings.bind(this));
    this.tabBtns.forEach(btn => btn.addEventListener('click', this.handleTabClick.bind(this)));
    this.clearHistoryBtn.addEventListener('click', this.handleClearHistory.bind(this));
    this.aspectRatioSelect.addEventListener('change', this.handlePromptControlChange.bind(this));
    this.megapixelInput.addEventListener('change', this.handlePromptControlChange.bind(this));
    this.stepsInput.addEventListener('change', this.handlePromptControlChange.bind(this));
    this.enableUpscaleToggle.addEventListener('change', this.handlePromptControlChange.bind(this));
  }

  private async handleClearHistory() {
    if (confirm('Clear all history?')) {
      await clearHistory();
      this.history = [];
      this.renderHistory();
    }
  }

  private async handlePromptControlChange() {
    this.settings.aspectRatio = this.aspectRatioSelect.value;
    this.settings.megapixel = parseFloat(this.megapixelInput.value) || 2.5;
    this.settings.steps = parseInt(this.stepsInput.value) || 20;
    this.settings.enableUpscale = this.enableUpscaleToggle.checked;
    await saveSettings(this.settings);
  }

  private async handleTabClick(event: Event) {
    const target = event.target as HTMLButtonElement;
    const tabName = target.dataset.tab;
    if (!tabName) return;
    this.tabBtns.forEach(btn => btn.classList.remove('active'));
    this.tabContents.forEach(content => content.classList.remove('active'));
    target.classList.add('active');
    document.getElementById(`${tabName}-tab`)?.classList.add('active');
    await setActiveTab(tabName);
  }

  private async handleSaveSettings() {
    this.settings.serverAddress = this.serverAddressInput.value;
    this.settings.negativePrompt = this.negativePromptInput.value;
    this.settings.seed = parseInt(this.seedInput.value) || -1;
    this.settings.steps = parseInt(this.stepsInput.value) || 20;
    this.settings.cfg = parseFloat(this.cfgInput.value) || 4;
    this.settings.enableSeparator = this.enableSeparatorToggle.checked;
    this.settings.aspectRatio = this.aspectRatioSelect.value;
    this.settings.megapixel = parseFloat(this.megapixelInput.value) || 2.5;
    this.settings.enableUpscale = this.enableUpscaleToggle.checked;
    await saveSettings(this.settings);
    this.settingsStatus.textContent = 'Settings saved!';
    setTimeout(() => { this.settingsStatus.textContent = ''; }, 2000);
  }

  private buildPayload(promptText: string) {
    return {
      prompt: promptText,
      negativePrompt: this.settings.negativePrompt,
      seed: this.settings.seed,
      steps: this.settings.steps,
      cfg: this.settings.cfg,
      aspectRatio: this.settings.aspectRatio,
      megapixel: this.settings.megapixel,
      enableUpscale: this.settings.enableUpscale,
    };
  }

  private async handleGenerate() {
    const prompt = this.promptInput.value.trim();
    if (!prompt) return;

    this.generateBtn.disabled = true;
    this.generateBtn.textContent = 'Generating...';

    const entry = await addPromptEntry(prompt);
    await this.refreshHistory();

    try {
      const promptId = await sendToComfyUI(this.buildPayload(entry.text), this.settings);
      await updatePromptEntry(entry.id, { imageStatus: 'generating', promptId });
      await this.refreshHistory();

      const imageUrl = await pollForImage(promptId, this.settings);
      if (imageUrl) {
        await updatePromptEntry(entry.id, { imageStatus: 'done', imageUrl });
      } else {
        await updatePromptEntry(entry.id, { imageStatus: 'error' });
      }
      await this.refreshHistory();
    } catch (error) {
      console.error('Generation failed:', error);
      await updatePromptEntry(entry.id, { imageStatus: 'error' });
      await this.refreshHistory();
    } finally {
      this.generateBtn.disabled = false;
      this.generateBtn.textContent = 'Generate';
    }
  }

  private async handleAutoSendToggle() {
    this.settings.autoSend = this.autoSendToggle.checked;
    await saveSettings(this.settings);
  }

  private async handleSendToComfyUI(entryId: string) {
    const entry = this.history.find(e => e.id === entryId);
    if (!entry) return;

    try {
      await updatePromptEntry(entryId, { imageStatus: 'generating' });
      await this.refreshHistory();

      const promptId = await sendToComfyUI(this.buildPayload(entry.text), this.settings);
      await updatePromptEntry(entryId, { promptId });
      await this.refreshHistory();

      const imageUrl = await pollForImage(promptId, this.settings);
      if (imageUrl) {
        await updatePromptEntry(entryId, { imageStatus: 'done', imageUrl });
      } else {
        await updatePromptEntry(entryId, { imageStatus: 'error' });
      }
      await this.refreshHistory();
    } catch (error) {
      console.error('Send failed:', error);
      await updatePromptEntry(entryId, { imageStatus: 'error' });
      await this.refreshHistory();
    }
  }

  private renderHistory() {
    this.historyList.innerHTML = '';
    this.history.slice().reverse().forEach(entry => {
      const item = document.createElement('div');
      item.className = 'history-item';

      if (entry.imageUrl) {
        const img = document.createElement('img');
        img.src = entry.imageUrl;
        img.className = 'thumbnail';
        img.addEventListener('click', () => window.open(entry.imageUrl, '_blank'));
        item.appendChild(img);
      }

      const content = document.createElement('div');
      content.className = 'history-item-content';

      const text = document.createElement('div');
      text.className = 'prompt-text';
      text.textContent = entry.text;
      text.title = entry.text;

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<span class="timestamp">${getRelativeTime(entry.createdAt)}</span> · <span class="status status-${entry.imageStatus}">${entry.imageStatus}</span>`;

      content.appendChild(text);
      content.appendChild(meta);
      item.appendChild(content);

      const actions = document.createElement('div');
      actions.className = 'history-item-actions';

      if (entry.imageStatus === 'generating') {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-cancel';
        cancelBtn.textContent = '✕';
        cancelBtn.title = 'Cancel';
        cancelBtn.addEventListener('click', () => this.handleCancelGeneration(entry));
        actions.appendChild(cancelBtn);
      } else if (entry.imageStatus === 'pending' || entry.imageStatus === 'error') {
        const sendBtn = document.createElement('button');
        sendBtn.className = 'btn-send';
        sendBtn.textContent = '▶';
        sendBtn.title = 'Generate';
        sendBtn.addEventListener('click', () => this.handleSendToComfyUI(entry.id));
        actions.appendChild(sendBtn);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-delete';
      deleteBtn.textContent = '🗑';
      deleteBtn.title = 'Delete';
      deleteBtn.addEventListener('click', () => this.handleDeleteEntry(entry.id));
      actions.appendChild(deleteBtn);

      item.appendChild(actions);
      this.historyList.appendChild(item);
    });
  }

  private async handleCancelGeneration(entry: PromptEntry) {
    if (entry.promptId) {
      await cancelPrompt(entry.promptId, this.settings);
    }
    await updatePromptEntry(entry.id, { imageStatus: 'error' });
    await this.refreshHistory();
  }

  private async handleDeleteEntry(entryId: string) {
    await deletePromptEntry(entryId);
    await this.refreshHistory();
  }

  private async refreshHistory() {
    this.history = await getHistory();
    this.renderHistory();
  }
}

new PopupApp();
