/// <reference types="chrome" />

import { getSettings, saveSettings, getHistory, addPromptEntry, sendToComfyUI, pollForImage, updatePromptEntry, getRelativeTime } from './utils';
import { PromptEntry, ComfyUISettings, ASPECT_RATIOS } from './types';

class PopupApp {
  private promptInput: HTMLTextAreaElement;
  private generateBtn: HTMLButtonElement;
  private autoSendToggle: HTMLInputElement;
  private historyList: HTMLElement;
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
    this.updateUI();
    this.bindEvents();
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
  }

  private handleTabClick(event: Event) {
    const target = event.target as HTMLButtonElement;
    const tabName = target.dataset.tab;
    this.tabBtns.forEach(btn => btn.classList.remove('active'));
    this.tabContents.forEach(content => content.classList.remove('active'));
    target.classList.add('active');
    document.getElementById(`${tabName}-tab`)?.classList.add('active');
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
    this.history.push(entry);
    this.renderHistory();

    try {
      const promptId = await sendToComfyUI(this.buildPayload(entry.text), this.settings);
      await updatePromptEntry(entry.id, { imageStatus: 'generating', promptId });
      this.refreshHistory();

      const imageUrl = await pollForImage(promptId, this.settings);
      if (imageUrl) {
        await updatePromptEntry(entry.id, { imageStatus: 'done', imageUrl });
      } else {
        await updatePromptEntry(entry.id, { imageStatus: 'error' });
      }
      this.refreshHistory();
    } catch (error) {
      console.error('Generation failed:', error);
      await updatePromptEntry(entry.id, { imageStatus: 'error' });
      this.refreshHistory();
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
      this.refreshHistory();

      const promptId = await sendToComfyUI(this.buildPayload(entry.text), this.settings);
      await updatePromptEntry(entryId, { promptId });

      const imageUrl = await pollForImage(promptId, this.settings);
      if (imageUrl) {
        await updatePromptEntry(entryId, { imageStatus: 'done', imageUrl });
      } else {
        await updatePromptEntry(entryId, { imageStatus: 'error' });
      }
      this.refreshHistory();
    } catch (error) {
      console.error('Send failed:', error);
      await updatePromptEntry(entryId, { imageStatus: 'error' });
      this.refreshHistory();
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

      const text = document.createElement('div');
      text.className = 'prompt-text';
      text.textContent = entry.text.length > 100 ? entry.text.substring(0, 100) + '...' : entry.text;
      text.title = entry.text;

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<span class="timestamp">${getRelativeTime(entry.createdAt)}</span> · <span class="status status-${entry.imageStatus}">${entry.imageStatus}</span>`;

      const sendBtn = document.createElement('button');
      sendBtn.textContent = entry.imageStatus === 'generating' ? 'Generating...' : 'Send to ComfyUI';
      sendBtn.disabled = entry.imageStatus === 'generating';
      sendBtn.addEventListener('click', () => this.handleSendToComfyUI(entry.id));

      item.appendChild(text);
      item.appendChild(meta);
      item.appendChild(sendBtn);
      this.historyList.appendChild(item);
    });
  }

  private async refreshHistory() {
    this.history = await getHistory();
    this.renderHistory();
  }
}

new PopupApp();
