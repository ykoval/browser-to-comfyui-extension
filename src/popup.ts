/// <reference types="chrome" />

import { getSettings, saveSettings, getHistory, clearHistory, getActiveTab, setActiveTab, deletePromptEntry, addPromptEntry, updatePromptEntry, getRelativeTime, isAutoDetectEnabled, toggleAutoDetect, extractDomain, parsePromptMetadata, buildWorkflowJsonForClipboard } from './utils';
import { PromptEntry, ComfyUISettings, ASPECT_RATIOS, ImportedWorkflow, MappingType, BUILT_IN_WORKFLOWS, BuiltInWorkflowType } from './types';
import { getWorkflows, addWorkflow, deleteWorkflow, updateWorkflow, getActiveWorkflowId, setActiveWorkflowId, detectWorkflowMappings, findOutputNodeId, parseWorkflowFile, DetectedMapping } from './workflow-utils';

class PopupApp {
  private promptInput: HTMLTextAreaElement;
  private generateBtn: HTMLButtonElement;
  private openInComfyBtn: HTMLButtonElement;
  private autoSendToggle: HTMLInputElement;
  private historyList: HTMLElement;
  private clearHistoryBtn: HTMLButtonElement;
  private refreshStatusesBtn: HTMLButtonElement;
  private serverAddressInput: HTMLInputElement;
  private negativePromptInput: HTMLTextAreaElement;
  private seedInput: HTMLInputElement;
  private stepsInput: HTMLInputElement;
  private cfgInput: HTMLInputElement;
  private enableSeparatorToggle: HTMLInputElement;
  private aspectRatioSelect: HTMLSelectElement;
  private megapixelInput: HTMLInputElement;
  private promptStartMarkerInput: HTMLInputElement;
  private promptEndMarkerInput: HTMLInputElement;
  private saveSettingsBtn: HTMLButtonElement;
  private settingsStatus: HTMLElement;
  private autoDetectToggle: HTMLInputElement;
  private currentDomainLabel: HTMLElement;
  private scanPageBtn: HTMLButtonElement;
  private togglePasteBtn: HTMLButtonElement;
  private pasteArea: HTMLElement;
  private pasteInput: HTMLTextAreaElement;
  private scanPasteBtn: HTMLButtonElement;
  private scanStatus: HTMLElement;
  private tabBtns: NodeListOf<HTMLButtonElement>;
  private tabContents: NodeListOf<HTMLElement>;
  private buildTimeElement: HTMLElement;
  private builtInWorkflowSelect: HTMLSelectElement;
  private workflowSelect: HTMLSelectElement;
  private importWorkflowBtn: HTMLButtonElement;
  private editMappingsBtn: HTMLButtonElement;
  private deleteWorkflowBtn: HTMLButtonElement;
  private workflowFileInput: HTMLInputElement;
  private mappingsPanel: HTMLElement;
  private mappingsList: HTMLElement;
  private closeMappingsBtn: HTMLButtonElement;
  private saveMappingsBtn: HTMLButtonElement;
  private settings!: ComfyUISettings;
  private history!: PromptEntry[];
  private workflows: ImportedWorkflow[] = [];
  private currentMappings: DetectedMapping[] = [];
  private currentDomain: string = '';
  private currentTabId: number | null = null;

  constructor() {
    this.promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
    this.generateBtn = document.getElementById('generateBtn') as HTMLButtonElement;
    this.openInComfyBtn = document.getElementById('openInComfyBtn') as HTMLButtonElement;
    this.autoSendToggle = document.getElementById('autoSendToggle') as HTMLInputElement;
    this.historyList = document.getElementById('historyList') as HTMLElement;
    this.clearHistoryBtn = document.getElementById('clearHistoryBtn') as HTMLButtonElement;
    this.refreshStatusesBtn = document.getElementById('refreshStatusesBtn') as HTMLButtonElement;
    this.serverAddressInput = document.getElementById('serverAddress') as HTMLInputElement;
    this.negativePromptInput = document.getElementById('negativePrompt') as HTMLTextAreaElement;
    this.seedInput = document.getElementById('seed') as HTMLInputElement;
    this.stepsInput = document.getElementById('steps') as HTMLInputElement;
    this.cfgInput = document.getElementById('cfg') as HTMLInputElement;
    this.enableSeparatorToggle = document.getElementById('enableSeparator') as HTMLInputElement;
    this.aspectRatioSelect = document.getElementById('aspectRatio') as HTMLSelectElement;
    this.megapixelInput = document.getElementById('megapixel') as HTMLInputElement;
    this.promptStartMarkerInput = document.getElementById('promptStartMarker') as HTMLInputElement;
    this.promptEndMarkerInput = document.getElementById('promptEndMarker') as HTMLInputElement;
    this.saveSettingsBtn = document.getElementById('saveSettingsBtn') as HTMLButtonElement;
    this.settingsStatus = document.getElementById('settingsStatus') as HTMLElement;
    this.autoDetectToggle = document.getElementById('autoDetectToggle') as HTMLInputElement;
    this.currentDomainLabel = document.getElementById('currentDomain') as HTMLElement;
    this.scanPageBtn = document.getElementById('scanPageBtn') as HTMLButtonElement;
    this.togglePasteBtn = document.getElementById('togglePasteBtn') as HTMLButtonElement;
    this.pasteArea = document.getElementById('pasteArea') as HTMLElement;
    this.pasteInput = document.getElementById('pasteInput') as HTMLTextAreaElement;
    this.scanPasteBtn = document.getElementById('scanPasteBtn') as HTMLButtonElement;
    this.scanStatus = document.getElementById('scanStatus') as HTMLElement;
    this.tabBtns = document.querySelectorAll('.tab-btn') as NodeListOf<HTMLButtonElement>;
    this.tabContents = document.querySelectorAll('.tab-content') as NodeListOf<HTMLElement>;
    this.buildTimeElement = document.getElementById('buildTime') as HTMLElement;
    this.builtInWorkflowSelect = document.getElementById('builtInWorkflowSelect') as HTMLSelectElement;
    this.workflowSelect = document.getElementById('workflowSelect') as HTMLSelectElement;
    this.importWorkflowBtn = document.getElementById('importWorkflowBtn') as HTMLButtonElement;
    this.editMappingsBtn = document.getElementById('editMappingsBtn') as HTMLButtonElement;
    this.deleteWorkflowBtn = document.getElementById('deleteWorkflowBtn') as HTMLButtonElement;
    this.workflowFileInput = document.getElementById('workflowFileInput') as HTMLInputElement;
    this.mappingsPanel = document.getElementById('mappingsPanel') as HTMLElement;
    this.mappingsList = document.getElementById('mappingsList') as HTMLElement;
    this.closeMappingsBtn = document.getElementById('closeMappingsBtn') as HTMLButtonElement;
    this.saveMappingsBtn = document.getElementById('saveMappingsBtn') as HTMLButtonElement;

    this.initAspectRatioOptions();
    this.initBuiltInWorkflowOptions();
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

  private initBuiltInWorkflowOptions() {
    BUILT_IN_WORKFLOWS.forEach(wf => {
      const option = document.createElement('option');
      option.value = wf.id;
      option.textContent = wf.name;
      option.title = wf.description;
      this.builtInWorkflowSelect.appendChild(option);
    });
  }

  private async init() {
    this.settings = await getSettings();
    this.history = await getHistory();
    this.workflows = await getWorkflows();
    await this.initCurrentTab();
    await this.restoreActiveTab();
    await this.initWorkflowSelect();
    this.updateUI();
    this.bindEvents();
    this.setupStorageListener();
  }

  private async initWorkflowSelect() {
    this.workflowSelect.innerHTML = '<option value="">Use Built-in</option>';
    this.workflows.forEach(wf => {
      const option = document.createElement('option');
      option.value = wf.id;
      option.textContent = wf.name;
      this.workflowSelect.appendChild(option);
    });
    const activeId = await getActiveWorkflowId();
    if (activeId) {
      this.workflowSelect.value = activeId;
    }
  }

  private setupStorageListener() {
    chrome.storage.local.onChanged.addListener((changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.promptHistory) {
        console.log('[Popup] History changed in storage, refreshing...');
        this.refreshHistory();
      }
    });
  }

  private async initCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && tab.id) {
      this.currentDomain = extractDomain(tab.url);
      this.currentTabId = tab.id;
      this.currentDomainLabel.textContent = this.currentDomain;
      
      const isRestricted = this.isRestrictedPage(tab.url);
      this.autoDetectToggle.disabled = isRestricted;
      
      if (isRestricted) {
        this.autoDetectToggle.checked = false;
        this.currentDomainLabel.textContent = 'Restricted page';
      } else {
        this.autoDetectToggle.checked = await isAutoDetectEnabled(this.currentDomain);
      }
    }
  }

  private isRestrictedPage(url: string): boolean {
    return url.startsWith('chrome://') || 
           url.startsWith('chrome-extension://') || 
           url.startsWith('about:') ||
           url.startsWith('edge://') ||
           url.startsWith('brave://') ||
           url.startsWith('file://');
  }

  private async restoreActiveTab() {
    const activeTab = await getActiveTab();
    this.tabBtns.forEach(btn => btn.classList.remove('active'));
    this.tabContents.forEach(content => content.classList.remove('active'));
    const tabBtn = document.querySelector(`[data-tab="${activeTab}"]`) as HTMLButtonElement;
    if (tabBtn) tabBtn.classList.add('active');
    document.getElementById(`${activeTab}-tab`)?.classList.add('active');
  }

  private updateUI() {
    this.autoSendToggle.checked = this.settings.autoSend;
    this.serverAddressInput.value = this.settings.serverAddress;
    this.negativePromptInput.value = this.settings.negativePrompt;
    this.seedInput.value = String(this.settings.seed);
    this.stepsInput.value = String(this.settings.steps);
    this.cfgInput.value = String(this.settings.cfg);
    this.enableSeparatorToggle.checked = this.settings.enableSeparator;
    this.aspectRatioSelect.value = this.settings.aspectRatio;
    this.megapixelInput.value = String(this.settings.megapixel);
    this.builtInWorkflowSelect.value = this.settings.builtInWorkflow || 'qwen-t2i';
    this.promptStartMarkerInput.value = this.settings.promptStartMarker;
    this.promptEndMarkerInput.value = this.settings.promptEndMarker;
    this.updateBuildTime();
    this.renderHistory();
  }

  private updateBuildTime() {
    const buildDate = new Date(__BUILD_TIME__);
    const formatted = buildDate.toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    this.buildTimeElement.textContent = `Build: ${formatted}`;
  }

  private bindEvents() {
    this.generateBtn.addEventListener('click', this.handleGenerate.bind(this));
    this.openInComfyBtn.addEventListener('click', this.handleOpenInComfy.bind(this));
    this.autoSendToggle.addEventListener('change', this.handleAutoSendToggle.bind(this));
    this.saveSettingsBtn.addEventListener('click', this.handleSaveSettings.bind(this));
    this.tabBtns.forEach(btn => btn.addEventListener('click', this.handleTabClick.bind(this)));
    this.clearHistoryBtn.addEventListener('click', this.handleClearHistory.bind(this));
    this.refreshStatusesBtn.addEventListener('click', this.handleRefreshStatuses.bind(this));
    this.promptInput.addEventListener('input', this.handlePromptInputChange.bind(this));
    this.aspectRatioSelect.addEventListener('change', this.handlePromptControlChange.bind(this));
    this.megapixelInput.addEventListener('change', this.handlePromptControlChange.bind(this));
    this.stepsInput.addEventListener('change', this.handlePromptControlChange.bind(this));
    this.autoDetectToggle.addEventListener('change', this.handleAutoDetectToggle.bind(this));
    this.scanPageBtn.addEventListener('click', this.handleScanPage.bind(this));
    this.togglePasteBtn.addEventListener('click', this.handleTogglePaste.bind(this));
    this.scanPasteBtn.addEventListener('click', this.handleScanPaste.bind(this));
    this.builtInWorkflowSelect.addEventListener('change', this.handleBuiltInWorkflowChange.bind(this));
    this.workflowSelect.addEventListener('change', this.handleWorkflowChange.bind(this));
    this.importWorkflowBtn.addEventListener('click', () => this.workflowFileInput.click());
    this.workflowFileInput.addEventListener('change', this.handleWorkflowImport.bind(this));
    this.editMappingsBtn.addEventListener('click', this.handleEditMappings.bind(this));
    this.deleteWorkflowBtn.addEventListener('click', this.handleDeleteWorkflow.bind(this));
    this.closeMappingsBtn.addEventListener('click', () => this.mappingsPanel.classList.add('hidden'));
    this.saveMappingsBtn.addEventListener('click', this.handleSaveMappings.bind(this));
  }

  private handleTogglePaste() {
    this.pasteArea.classList.toggle('hidden');
    if (!this.pasteArea.classList.contains('hidden')) {
      this.pasteInput.focus();
    }
  }

  private async handleScanPaste() {
    const text = this.pasteInput.value;
    if (!text.trim()) {
      this.scanStatus.textContent = 'Paste some text first';
      return;
    }

    const prompts = this.extractPrompts(text);
    let addedCount = 0;

    for (const promptText of prompts) {
      const isDuplicate = this.history.some(
        entry => entry.text.trim().toLowerCase() === promptText.trim().toLowerCase()
      );
      if (!isDuplicate) {
        await addPromptEntry(promptText);
        addedCount++;
      }
    }

    await this.refreshHistory();

    if (prompts.length === 0) {
      this.scanStatus.textContent = 'No prompts found in text';
    } else if (addedCount === 0) {
      this.scanStatus.textContent = `${prompts.length} found, all duplicates`;
    } else {
      this.scanStatus.textContent = `Added ${addedCount} prompt${addedCount > 1 ? 's' : ''}`;
      this.scanStatus.classList.add('success');
      this.pasteInput.value = '';
      this.pasteArea.classList.add('hidden');
    }

    setTimeout(() => {
      this.scanStatus.textContent = '';
      this.scanStatus.classList.remove('success');
    }, 3000);
  }

  private async handleScanPage() {
    if (!this.currentTabId) return;
    
    this.scanPageBtn.disabled = true;
    this.scanPageBtn.textContent = 'Scanning...';
    this.scanStatus.textContent = '';
    
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: this.currentTabId },
        func: () => document.body.innerText,
      });
      
      const pageText = results[0]?.result || '';
      const prompts = this.extractPrompts(pageText);
      
      let addedCount = 0;
      for (const promptText of prompts) {
        const isDuplicate = this.history.some(
          entry => entry.text.trim().toLowerCase() === promptText.trim().toLowerCase()
        );
        
        if (!isDuplicate) {
          await addPromptEntry(promptText);
          addedCount++;
        }
      }
      
      await this.refreshHistory();
      
      if (prompts.length === 0) {
        this.scanStatus.textContent = 'No prompts found';
      } else if (addedCount === 0) {
        this.scanStatus.textContent = `${prompts.length} found, all duplicates`;
      } else {
        this.scanStatus.textContent = `Added ${addedCount} prompt${addedCount > 1 ? 's' : ''}`;
        this.scanStatus.classList.add('success');
      }
    } catch (error) {
      console.error('Scan page error:', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.scanStatus.textContent = `Error: ${msg.slice(0, 30)}`;
    } finally {
      this.scanPageBtn.disabled = false;
      this.scanPageBtn.textContent = 'Scan Page';
      setTimeout(() => {
        this.scanStatus.textContent = '';
        this.scanStatus.classList.remove('success');
      }, 3000);
    }
  }

  private extractPrompts(text: string): string[] {
    const seen = new Map<string, string>();
    const { promptStartMarker, promptEndMarker } = this.settings;
    let searchStart = 0;

    while (searchStart < text.length) {
      const startIndex = text.indexOf(promptStartMarker, searchStart);
      if (startIndex === -1) break;

      const contentStart = startIndex + promptStartMarker.length;
      const endIndex = text.indexOf(promptEndMarker, contentStart);
      if (endIndex === -1) break;

      const promptText = text.substring(contentStart, endIndex).trim();
      const normalizedPrompt = promptText.toLowerCase();
      if (promptText && !seen.has(normalizedPrompt)) {
        seen.set(normalizedPrompt, promptText);
      }

      searchStart = endIndex + promptEndMarker.length;
    }

    return Array.from(seen.values());
  }

  private async handleClearHistory() {
    if (confirm('Clear all history?')) {
      await clearHistory();
      this.history = [];
      this.renderHistory();
    }
  }

  private async handleRefreshStatuses() {
    this.refreshStatusesBtn.disabled = true;
    this.refreshStatusesBtn.textContent = '...';

    try {
      // Re-read history from storage (background service worker handles actual status updates)
      await this.refreshHistory();
    } catch (error) {
      console.error('Refresh statuses error:', error);
    } finally {
      this.refreshStatusesBtn.disabled = false;
      this.refreshStatusesBtn.textContent = '↻';
    }
  }

  private handlePromptInputChange() {
    // Parse metadata from prompt to auto-detect aspect ratio
    const metadata = parsePromptMetadata(this.promptInput.value);
    if (metadata.aspectRatio && this.aspectRatioSelect.value !== metadata.aspectRatio) {
      this.aspectRatioSelect.value = metadata.aspectRatio;
    }
  }

  private async handlePromptControlChange() {
    this.settings.aspectRatio = this.aspectRatioSelect.value;
    this.settings.megapixel = parseFloat(this.megapixelInput.value) || 2.5;
    this.settings.steps = parseInt(this.stepsInput.value) || 20;
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
    this.settings.builtInWorkflow = this.builtInWorkflowSelect.value as BuiltInWorkflowType;
    this.settings.promptStartMarker = this.promptStartMarkerInput.value || '[PROMPT START]';
    this.settings.promptEndMarker = this.promptEndMarkerInput.value || '[PROMPT END]';
    await saveSettings(this.settings);
    this.settingsStatus.textContent = 'Settings saved!';
    setTimeout(() => { this.settingsStatus.textContent = ''; }, 2000);
  }

  private async handleAutoDetectToggle() {
    const enabled = this.autoDetectToggle.checked;
    if (!this.currentDomain || !this.currentTabId) return;

    await toggleAutoDetect(this.currentDomain, enabled);

    if (enabled) {
      const success = await this.injectContentScript();
      if (!success) {
        this.autoDetectToggle.checked = false;
        await toggleAutoDetect(this.currentDomain, false);
      }
    } else {
      await this.removeContentScript();
    }
  }

  private async injectContentScript(): Promise<boolean> {
    if (!this.currentTabId) return false;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: this.currentTabId },
        files: ['dist/content.js'],
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      await chrome.tabs.sendMessage(this.currentTabId, {
        type: 'INIT_AUTO_DETECT',
        settings: {
          startMarker: this.settings.promptStartMarker,
          endMarker: this.settings.promptEndMarker,
        },
      });
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '';
      if (errorMsg.includes('policy') || errorMsg.includes('CSP')) {
        this.currentDomainLabel.textContent = 'Blocked by site policy';
      } else {
        this.currentDomainLabel.textContent = 'Cannot script this page';
      }
      return false;
    }
  }

  private async removeContentScript() {
    if (!this.currentTabId) return;
    try {
      await chrome.tabs.sendMessage(this.currentTabId, { type: 'STOP_AUTO_DETECT' });
    } catch {
      // Content script not present - already stopped or never injected
    }
  }

  private buildPayload(promptText: string) {
    // Parse metadata from prompt (e.g., "Aspect Ratio: 4:3")
    const metadata = parsePromptMetadata(promptText);

    // Use parsed aspect ratio if present, otherwise use settings
    const aspectRatio = metadata.aspectRatio || this.settings.aspectRatio;

    // Update UI to reflect the parsed aspect ratio
    if (metadata.aspectRatio && this.aspectRatioSelect.value !== metadata.aspectRatio) {
      this.aspectRatioSelect.value = metadata.aspectRatio;
    }

    return {
      prompt: metadata.cleanPrompt,
      negativePrompt: this.settings.negativePrompt,
      seed: this.settings.seed,
      steps: this.settings.steps,
      cfg: this.settings.cfg,
      aspectRatio: aspectRatio,
      megapixel: this.settings.megapixel,
    };
  }

  private async handleGenerate() {
    const prompt = this.promptInput.value.trim();
    if (!prompt) return;

    this.generateBtn.disabled = true;
    this.generateBtn.textContent = 'Sending...';

    try {
      const entry = await addPromptEntry(prompt);
      await this.refreshHistory();

      // Delegate generation to background service worker (alarm-based polling)
      chrome.runtime.sendMessage({
        type: 'START_GENERATION',
        entryId: entry.id,
        text: entry.text,
      });
    } catch (error) {
      console.error('Failed to start generation:', error);
    } finally {
      this.generateBtn.disabled = false;
      this.generateBtn.textContent = 'Generate';
    }
  }

  private async handleAutoSendToggle() {
    this.settings.autoSend = this.autoSendToggle.checked;
    await saveSettings(this.settings);
  }

  private async handleOpenInComfy() {
    const prompt = this.promptInput.value.trim();
    const payload = this.buildPayload(prompt || 'Test prompt');
    const workflowJson = buildWorkflowJsonForClipboard(payload, this.settings.builtInWorkflow);

    try {
      await navigator.clipboard.writeText(workflowJson);
      this.openInComfyBtn.textContent = 'Copied!';
      window.open(this.settings.serverAddress, '_blank');
      setTimeout(() => {
        this.openInComfyBtn.textContent = 'Open in ComfyUI';
      }, 2000);
    } catch (err) {
      console.error('Failed to copy workflow:', err);
      this.openInComfyBtn.textContent = 'Copy failed';
      setTimeout(() => {
        this.openInComfyBtn.textContent = 'Open in ComfyUI';
      }, 2000);
    }
  }

  private async handleSendToComfyUI(entryId: string) {
    const entry = this.history.find(e => e.id === entryId);
    if (!entry) return;

    console.log(`[Popup] Requesting regeneration for entry ${entryId.substring(0, 8)}`);

    // Delegate generation to background service worker (alarm-based polling)
    chrome.runtime.sendMessage({
      type: 'START_GENERATION',
      entryId: entry.id,
      text: entry.text,
      isRegenerate: true,
    });
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
      const stageLabel = entry.imageStatus === 'generating' && entry.generationStage
        ? `${entry.imageStatus} (${entry.generationStage})`
        : entry.imageStatus;
      meta.innerHTML = `<span class="timestamp">${getRelativeTime(entry.createdAt)}</span> · <span class="status status-${entry.imageStatus}">${stageLabel}</span>`;

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
      }

      const genCount = entry.generationCount || 0;
      const regenerateBtn = document.createElement('button');
      regenerateBtn.className = 'btn-regenerate';
      regenerateBtn.innerHTML = genCount > 1 ? `↻<span class="gen-count">${genCount}</span>` : '↻';
      regenerateBtn.title = genCount > 0 ? `Generate Again (${genCount} sent)` : 'Generate';
      regenerateBtn.addEventListener('click', () => this.handleSendToComfyUI(entry.id));
      actions.appendChild(regenerateBtn);

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
      // Delegate cancel to background service worker
      chrome.runtime.sendMessage({
        type: 'CANCEL_GENERATION',
        entryId: entry.id,
        promptId: entry.promptId,
      });
    } else {
      // No promptId yet — just mark as error locally
      await updatePromptEntry(entry.id, { imageStatus: 'error' });
      await this.refreshHistory();
    }
  }

  private async handleDeleteEntry(entryId: string) {
    await deletePromptEntry(entryId);
    await this.refreshHistory();
  }

  private async refreshHistory() {
    console.log('[Popup] Refreshing history...');
    this.history = await getHistory();
    console.log(`[Popup] Loaded ${this.history.length} entries:`, this.history.map(e => e.id.substring(0, 8)));
    this.renderHistory();
  }

  private async handleBuiltInWorkflowChange() {
    this.settings.builtInWorkflow = this.builtInWorkflowSelect.value as BuiltInWorkflowType;
    await saveSettings(this.settings);
    const workflow = BUILT_IN_WORKFLOWS.find(w => w.id === this.settings.builtInWorkflow);
    this.settingsStatus.textContent = `Switched to ${workflow?.name || 'Qwen T2I'}`;
    setTimeout(() => { this.settingsStatus.textContent = ''; }, 2000);
  }

  private async handleWorkflowChange() {
    const selectedId = this.workflowSelect.value || null;
    await setActiveWorkflowId(selectedId);
    this.settingsStatus.textContent = selectedId ? 'Custom workflow selected' : 'Using built-in workflow';
    setTimeout(() => { this.settingsStatus.textContent = ''; }, 2000);
  }

  private async handleWorkflowImport(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result as string;
      const workflowData = parseWorkflowFile(content);
      
      if (!workflowData) {
        this.settingsStatus.textContent = 'Invalid workflow file';
        setTimeout(() => { this.settingsStatus.textContent = ''; }, 3000);
        return;
      }

      const detectedMappings = detectWorkflowMappings(workflowData);
      const outputNodeId = findOutputNodeId(workflowData) || '';
      const workflowName = file.name.replace('.json', '');

      const newWorkflow: ImportedWorkflow = {
        id: crypto.randomUUID(),
        name: workflowName,
        workflow: workflowData,
        mappings: detectedMappings.map(m => ({ type: m.type, nodeId: m.nodeId, inputKey: m.inputKey })),
        outputNodeId,
        createdAt: Date.now(),
      };

      await addWorkflow(newWorkflow);
      this.workflows = await getWorkflows();
      await this.initWorkflowSelect();
      this.workflowSelect.value = newWorkflow.id;
      await setActiveWorkflowId(newWorkflow.id);

      this.currentMappings = detectedMappings;
      this.renderMappingsPanel(newWorkflow, detectedMappings);
      this.mappingsPanel.classList.remove('hidden');

      this.settingsStatus.textContent = `Imported: ${workflowName}`;
      setTimeout(() => { this.settingsStatus.textContent = ''; }, 3000);
    };
    reader.readAsText(file);
    input.value = '';
  }

  private handleEditMappings() {
    const selectedId = this.workflowSelect.value;
    if (!selectedId) {
      this.settingsStatus.textContent = 'Select an imported workflow first';
      setTimeout(() => { this.settingsStatus.textContent = ''; }, 2000);
      return;
    }

    const workflow = this.workflows.find(w => w.id === selectedId);
    if (!workflow) return;

    const detectedMappings = detectWorkflowMappings(workflow.workflow);
    this.currentMappings = detectedMappings;
    this.renderMappingsPanel(workflow, detectedMappings);
    this.mappingsPanel.classList.remove('hidden');
  }

  private async handleDeleteWorkflow() {
    const selectedId = this.workflowSelect.value;
    if (!selectedId) {
      this.settingsStatus.textContent = 'Select a workflow to delete';
      setTimeout(() => { this.settingsStatus.textContent = ''; }, 2000);
      return;
    }

    const workflow = this.workflows.find(w => w.id === selectedId);
    if (!workflow) return;

    if (!confirm(`Delete workflow "${workflow.name}"?`)) return;

    await deleteWorkflow(selectedId);
    this.workflows = await getWorkflows();
    await this.initWorkflowSelect();
    this.mappingsPanel.classList.add('hidden');
    this.settingsStatus.textContent = 'Workflow deleted';
    setTimeout(() => { this.settingsStatus.textContent = ''; }, 2000);
  }

  private renderMappingsPanel(workflow: ImportedWorkflow, detectedMappings: DetectedMapping[]) {
    this.mappingsList.innerHTML = '';
    const nodeOptions = Object.entries(workflow.workflow).map(([id, node]) => 
      `<option value="${id}">${id}: ${node.class_type}</option>`
    ).join('');

    const mappingTypes: MappingType[] = ['prompt', 'negativePrompt', 'seed', 'steps', 'cfg', 'aspectRatio', 'megapixel', 'outputImage'];
    
    mappingTypes.forEach(type => {
      const detected = detectedMappings.find(m => m.type === type);
      const saved = workflow.mappings.find(m => m.type === type);
      const mapping = saved || detected;

      const row = document.createElement('div');
      row.className = 'mapping-row';
      row.innerHTML = `
        <label>${type}</label>
        <select data-type="${type}" data-field="nodeId">
          <option value="">-- None --</option>
          ${nodeOptions}
        </select>
        <input type="text" data-type="${type}" data-field="inputKey" placeholder="input key" value="${mapping?.inputKey || ''}">
        ${detected ? `<span class="confidence-${detected.confidence}" title="${detected.nodeType}">●</span>` : ''}
      `;
      
      const nodeSelect = row.querySelector(`select[data-type="${type}"]`) as HTMLSelectElement;
      if (mapping?.nodeId) {
        nodeSelect.value = mapping.nodeId;
      }

      this.mappingsList.appendChild(row);
    });
  }

  private async handleSaveMappings() {
    const selectedId = this.workflowSelect.value;
    if (!selectedId) return;

    const mappings: { type: MappingType; nodeId: string; inputKey: string }[] = [];
    const rows = this.mappingsList.querySelectorAll('.mapping-row');
    
    rows.forEach(row => {
      const nodeSelect = row.querySelector('select[data-field="nodeId"]') as HTMLSelectElement;
      const inputKeyField = row.querySelector('input[data-field="inputKey"]') as HTMLInputElement;
      const type = nodeSelect.dataset.type as MappingType;
      
      if (nodeSelect.value && inputKeyField.value) {
        mappings.push({
          type,
          nodeId: nodeSelect.value,
          inputKey: inputKeyField.value,
        });
      }
    });

    await updateWorkflow(selectedId, { mappings });
    this.workflows = await getWorkflows();
    this.mappingsPanel.classList.add('hidden');
    this.settingsStatus.textContent = 'Mappings saved';
    setTimeout(() => { this.settingsStatus.textContent = ''; }, 2000);
  }
}

new PopupApp();
