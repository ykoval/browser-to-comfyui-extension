/// <reference types="chrome" />

interface AutoDetectSettings {
  startMarker: string;
  endMarker: string;
}

interface HistoryEntry {
  id: string;
  text: string;
  createdAt: number;
  imageStatus: 'pending' | 'generating' | 'done' | 'error';
  generationStage?: 'queued' | 'polling';
  imageUrl?: string;
  baseImageUrl?: string;
  promptId?: string;
  upscaleStatus?: 'upscaling' | 'done' | 'error';
  upscalePromptId?: string;
  generationStartedAt?: number;
  generationDoneAt?: number;
  upscaleStartedAt?: number;
  upscaleDoneAt?: number;
}

interface TimingStats {
  generationTimes: number[];
  upscaleTimes: number[];
}

class PromptAutoDetector {
  private observer: MutationObserver | null = null;
  private settings: AutoDetectSettings | null = null;
  private detectedPrompts: Map<string, string> = new Map();
  private detectedCount = 0;
  private generatingCount = 0;
  private history: HistoryEntry[] = [];
  private timingStats: TimingStats = { generationTimes: [], upscaleTimes: [] };

  private indicator: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private panelList: HTMLElement | null = null;
  private panelCount: HTMLElement | null = null;
  private panelStatus: HTMLElement | null = null;
  private panelMetrics: HTMLElement | null = null;
  private panelResizeObserver: ResizeObserver | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private previewCache: Map<string, string> = new Map();

  private isActive = false;
  private isPanelOpen = false;
  private scanDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isDragging = false;
  private dragOffset: { x: number; y: number } = { x: 0, y: 0 };

  private storageChangeHandler: ((changes: { [key: string]: chrome.storage.StorageChange }) => void) | null = null;

  constructor() {
    this.setupMessageListener();
  }

  private setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'INIT_AUTO_DETECT') {
        this.start(message.settings);
        sendResponse({ success: true });
      } else if (message.type === 'STOP_AUTO_DETECT') {
        this.stop();
        sendResponse({ success: true });
      }
      return true;
    });
  }

  private start(settings: AutoDetectSettings) {
    this.settings = settings;

    if (this.isActive) {
      this.scanPage();
      return;
    }

    this.isActive = true;
    this.injectStyles();
    this.createIndicator();
    this.createPanel();
    this.scanPage();
    this.startObserver();
    this.startGenerationListener();
  }

  private stop() {
    this.isActive = false;
    this.stopObserver();
    this.stopGenerationListener();
    this.removePanel();
    this.removeIndicator();
    this.removeStyles();
    this.detectedPrompts.clear();
    this.detectedCount = 0;
    this.generatingCount = 0;
    this.history = [];
    this.previewCache.clear();
    this.removeOrphanedUi();
  }

  private injectStyles() {
    if (this.styleEl) return;

    const style = document.createElement('style');
    style.id = 'comfyui-auto-detect-style';
    style.textContent = `
      #comfyui-auto-detect-indicator {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 52px;
        height: 52px;
        background: linear-gradient(135deg, #1a1d31 0%, #132038 100%);
        border: 2px solid #00d084;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        z-index: 2147483646;
        box-shadow: 0 8px 24px rgba(0, 208, 132, 0.28);
        user-select: none;
      }
      #comfyui-auto-detect-indicator:hover {
        box-shadow: 0 10px 28px rgba(0, 208, 132, 0.4);
      }
      #comfyui-auto-detect-indicator.dragging {
        cursor: grabbing;
        transform: scale(1.05);
      }
      #comfyui-auto-detect-indicator .comfyui-indicator-icon {
        color: #00e395;
        display: flex;
        pointer-events: none;
      }
      #comfyui-auto-detect-indicator .comfyui-indicator-badge {
        position: absolute;
        top: -5px;
        right: -5px;
        min-width: 22px;
        height: 22px;
        border-radius: 11px;
        background: #ff5c93;
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        padding: 0 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 3px 12px rgba(255, 92, 147, 0.4);
        pointer-events: none;
      }
      #comfyui-auto-detect-indicator.generating .comfyui-indicator-badge {
        background: #f59f0b;
        box-shadow: 0 3px 12px rgba(245, 159, 11, 0.4);
      }
      #comfyui-auto-detect-indicator.pulse .comfyui-indicator-badge {
        animation: comfyui-pulse 0.45s ease-out;
      }
      @keyframes comfyui-pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.25); }
        100% { transform: scale(1); }
      }

      #comfyui-session-panel {
        position: fixed;
        width: 360px;
        height: min(62vh, 560px);
        background: #0f1322;
        border: 1px solid #22324d;
        border-radius: 14px;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
        z-index: 2147483645;
        display: none;
        overflow: hidden;
        resize: both;
        min-width: 320px;
        min-height: 260px;
        max-width: 92vw;
        max-height: 86vh;
        color: #edf2ff;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      #comfyui-session-panel.open {
        display: flex;
        flex-direction: column;
      }
      .comfyui-panel-header {
        padding: 12px 14px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #1f2b43;
        background: linear-gradient(180deg, #141b2f 0%, #10172a 100%);
      }
      .comfyui-panel-title {
        display: flex;
        gap: 8px;
        align-items: baseline;
      }
      .comfyui-panel-title strong {
        font-size: 14px;
      }
      .comfyui-panel-title span {
        font-size: 12px;
        color: #9fb2d7;
      }
      .comfyui-panel-actions {
        display: flex;
        gap: 8px;
      }
      .comfyui-btn {
        border: 1px solid #2b3c5c;
        background: #15203a;
        color: #d9e6ff;
        border-radius: 8px;
        font-size: 12px;
        padding: 6px 10px;
        cursor: pointer;
      }
      .comfyui-btn:hover {
        border-color: #3e5c86;
        background: #1b2b49;
      }
      .comfyui-btn-primary {
        border-color: #00c980;
        color: #0ee59a;
      }
      .comfyui-panel-sub {
        padding: 8px 14px;
        font-size: 12px;
        color: #8ea1c6;
        border-bottom: 1px solid #1b2640;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .comfyui-panel-metrics {
        padding: 7px 14px;
        font-size: 11px;
        color: #7f93ba;
        border-bottom: 1px solid #1b2640;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .comfyui-panel-list {
        overflow-y: auto;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1;
        min-height: 96px;
      }
      .comfyui-empty {
        padding: 16px;
        border: 1px dashed #2b3c5c;
        border-radius: 10px;
        color: #8ea1c6;
        font-size: 12px;
        text-align: center;
      }
      .comfyui-item {
        border: 1px solid #253451;
        background: #131c32;
        border-radius: 10px;
        padding: 10px;
      }
      .comfyui-item-main {
        display: grid;
        grid-template-columns: 64px 1fr;
        gap: 10px;
        align-items: start;
      }
      .comfyui-thumb-col {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 6px;
      }
      .comfyui-thumb {
        width: 64px;
        height: 64px;
        border-radius: 8px;
        border: 1px solid #2b3c5c;
        background: #10192e;
        object-fit: cover;
        display: block;
      }
      .comfyui-thumb.clickable {
        cursor: pointer;
      }
      .comfyui-thumb.clickable:hover {
        border-color: #3f5f8f;
      }
      .comfyui-thumb-placeholder {
        width: 64px;
        height: 64px;
        border-radius: 8px;
        border: 1px dashed #2b3c5c;
        background: linear-gradient(120deg, #121d35 25%, #172543 40%, #121d35 55%);
        background-size: 220% 100%;
        animation: comfyui-shimmer 1.2s linear infinite;
      }
      @keyframes comfyui-shimmer {
        0% { background-position: 100% 0; }
        100% { background-position: 0 0; }
      }
      .comfyui-item-content {
        min-width: 0;
      }
      .comfyui-thumb-times {
        font-size: 10px;
        color: #7f93ba;
        line-height: 1.2;
        text-align: center;
        min-height: 24px;
      }
      .comfyui-item-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .comfyui-item-head {
        min-width: 0;
      }
      .comfyui-item-title {
        font-size: 15px;
        font-weight: 700;
        color: #e3ecff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .comfyui-item-id {
        margin-top: 2px;
        font-size: 10px;
        color: #7f93ba;
      }
      .comfyui-status {
        font-size: 11px;
        border: 1px solid #314564;
        border-radius: 12px;
        padding: 3px 8px;
        color: #a9bde2;
        white-space: nowrap;
      }
      .comfyui-status.ready { border-color: #1f8a5b; color: #59e39f; }
      .comfyui-status.running { border-color: #8f6925; color: #ffcd6e; }
      .comfyui-status.queued { border-color: #315489; color: #8fc0ff; }
      .comfyui-status.error { border-color: #8a2d4e; color: #ff8db2; }
      .comfyui-item-text {
        margin: 6px 0;
        font-size: 12px;
        line-height: 1.35;
        color: #d6e4ff;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: pre-wrap;
      }
      .comfyui-item-row {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
      }
      .comfyui-item-actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .comfyui-action {
        border: 1px solid #2f4062;
        border-radius: 7px;
        background: #1a2843;
        color: #d8e7ff;
        font-size: 11px;
        padding: 4px 8px;
        cursor: pointer;
      }
      .comfyui-action:hover {
        background: #203257;
      }
      .comfyui-action.primary {
        border-color: #1f8a5b;
        color: #66e6ac;
      }
      .comfyui-action.warn {
        border-color: #8d3b29;
        color: #ffb096;
      }
      .comfyui-action.danger {
        border-color: #8a2d4e;
        color: #ff94b8;
      }
      @media (max-width: 600px) {
        #comfyui-session-panel {
          width: min(92vw, 360px);
          height: min(56vh, 520px);
        }
      }
    `;

    this.styleEl = style;
    document.head.appendChild(style);
  }

  private removeStyles() {
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }
  }

  private removeOrphanedUi() {
    // Defensive cleanup if previous script instances left detached UI behind.
    document.querySelectorAll('#comfyui-auto-detect-indicator, #comfyui-session-panel, #comfyui-auto-detect-style')
      .forEach((el) => el.remove());
  }

  private createIndicator() {
    if (this.indicator) return;

    this.indicator = document.createElement('div');
    this.indicator.id = 'comfyui-auto-detect-indicator';
    this.indicator.title = 'Prompt queue';
    this.indicator.innerHTML = `
      <div class="comfyui-indicator-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="4" y="4" width="16" height="16" rx="3"></rect>
          <path d="M8 9h8M8 13h8M8 17h5"></path>
        </svg>
      </div>
      <div class="comfyui-indicator-badge">0</div>
    `;

    document.body.appendChild(this.indicator);
    this.setupDraggable();
  }

  private createPanel() {
    if (this.panel) return;

    const panel = document.createElement('div');
    panel.id = 'comfyui-session-panel';
    panel.innerHTML = `
      <div class="comfyui-panel-header">
        <div class="comfyui-panel-title">
          <strong>Session Prompts</strong>
          <span id="comfyui-panel-count">0 items</span>
        </div>
        <div class="comfyui-panel-actions">
          <button type="button" class="comfyui-btn" id="comfyui-scan-now">Scan Now</button>
          <button type="button" class="comfyui-btn" id="comfyui-open-popup">Open Full</button>
        </div>
      </div>
      <div class="comfyui-panel-sub">
        <span>Detected on this page session</span>
        <span id="comfyui-panel-status"></span>
      </div>
      <div class="comfyui-panel-metrics" id="comfyui-panel-metrics"></div>
      <div class="comfyui-panel-list" id="comfyui-panel-list"></div>
    `;

    document.body.appendChild(panel);
    this.panel = panel;
    this.panelList = panel.querySelector('#comfyui-panel-list');
    this.panelCount = panel.querySelector('#comfyui-panel-count');
    this.panelStatus = panel.querySelector('#comfyui-panel-status');
    this.panelMetrics = panel.querySelector('#comfyui-panel-metrics');

    const scanNowBtn = panel.querySelector('#comfyui-scan-now') as HTMLButtonElement;
    const openPopupBtn = panel.querySelector('#comfyui-open-popup') as HTMLButtonElement;

    this.restorePanelSize();
    scanNowBtn.addEventListener('click', () => this.scanPage(true));
    openPopupBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => undefined);
    });

    this.panelResizeObserver = new ResizeObserver(() => {
      this.persistPanelSize();
      this.ensurePanelInViewport();
    });
    this.panelResizeObserver.observe(panel);

    window.addEventListener('resize', this.handleWindowResize);
    document.addEventListener('click', this.handleOutsideClick);
  }

  private removePanel() {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
      this.panelList = null;
      this.panelCount = null;
      this.panelStatus = null;
      this.panelMetrics = null;
    }
    if (this.panelResizeObserver) {
      this.panelResizeObserver.disconnect();
      this.panelResizeObserver = null;
    }
    window.removeEventListener('resize', this.handleWindowResize);
    this.isPanelOpen = false;
    document.removeEventListener('click', this.handleOutsideClick);
  }

  private handleWindowResize = () => {
    if (!this.isPanelOpen) return;
    this.ensurePanelInViewport();
  };

  private handleOutsideClick = (event: MouseEvent) => {
    if (!this.isPanelOpen || !this.panel || !this.indicator) return;
    const target = event.target as Node;
    if (this.panel.contains(target) || this.indicator.contains(target)) return;
    this.setPanelOpen(false);
  };

  private setupDraggable() {
    if (!this.indicator) return;

    let startX = 0;
    let startY = 0;
    let hasMoved = false;

    const onMouseDown = (e: MouseEvent) => {
      if (!this.indicator) return;
      e.preventDefault();
      this.isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;

      const rect = this.indicator.getBoundingClientRect();
      this.dragOffset.x = e.clientX - rect.left;
      this.dragOffset.y = e.clientY - rect.top;

      this.indicator.classList.add('dragging');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this.isDragging || !this.indicator) return;

      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx > 5 || dy > 5) hasMoved = true;

      const x = e.clientX - this.dragOffset.x;
      const y = e.clientY - this.dragOffset.y;

      const maxX = window.innerWidth - this.indicator.offsetWidth;
      const maxY = window.innerHeight - this.indicator.offsetHeight;

      this.indicator.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
      this.indicator.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
      this.indicator.style.right = 'auto';
      this.indicator.style.bottom = 'auto';

      if (this.isPanelOpen) {
        this.positionPanelNearIndicator();
      }
    };

    const onMouseUp = () => {
      if (!this.indicator) return;
      this.isDragging = false;
      this.indicator.classList.remove('dragging');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (!hasMoved) {
        this.handleIndicatorClick();
      }
    };

    this.indicator.addEventListener('mousedown', onMouseDown);
  }

  private handleIndicatorClick() {
    this.setPanelOpen(!this.isPanelOpen);
  }

  private setPanelOpen(open: boolean) {
    if (!this.panel) return;
    this.isPanelOpen = open;
    this.panel.classList.toggle('open', open);
    if (open) {
      this.positionPanelNearIndicator();
      this.renderSessionList();
    }
  }

  private positionPanelNearIndicator() {
    if (!this.panel || !this.indicator) return;

    const indRect = this.indicator.getBoundingClientRect();
    const panelWidth = this.panel.offsetWidth || 360;
    const panelHeight = this.panel.offsetHeight || 400;
    const margin = 10;

    let left = indRect.right - panelWidth;
    let top = indRect.top - panelHeight - margin;

    if (left < 8) left = 8;
    if (left + panelWidth > window.innerWidth - 8) left = window.innerWidth - panelWidth - 8;

    if (top < 8) {
      top = indRect.bottom + margin;
      if (top + panelHeight > window.innerHeight - 8) {
        top = window.innerHeight - panelHeight - 8;
      }
    }

    this.panel.style.left = `${left}px`;
    this.panel.style.top = `${Math.max(8, top)}px`;
    this.ensurePanelInViewport();
  }

  private ensurePanelInViewport() {
    if (!this.panel) return;
    const rect = this.panel.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;

    if (rect.right > window.innerWidth - 8) {
      left -= rect.right - (window.innerWidth - 8);
    }
    if (rect.bottom > window.innerHeight - 8) {
      top -= rect.bottom - (window.innerHeight - 8);
    }
    if (left < 8) left = 8;
    if (top < 8) top = 8;

    this.panel.style.left = `${Math.round(left)}px`;
    this.panel.style.top = `${Math.round(top)}px`;
  }

  private restorePanelSize() {
    if (!this.panel) return;
    const raw = localStorage.getItem('comfyui_session_panel_size');
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as { width?: number; height?: number };
      if (parsed.width && parsed.width >= 320) {
        this.panel.style.width = `${Math.round(parsed.width)}px`;
      }
      if (parsed.height && parsed.height >= 260) {
        this.panel.style.height = `${Math.round(parsed.height)}px`;
      }
    } catch {
      // ignore malformed persisted value
    }
  }

  private persistPanelSize() {
    if (!this.panel) return;
    const rect = this.panel.getBoundingClientRect();
    localStorage.setItem(
      'comfyui_session_panel_size',
      JSON.stringify({ width: Math.round(rect.width), height: Math.round(rect.height) }),
    );
  }

  private startGenerationListener() {
    this.syncHistoryState();

    this.storageChangeHandler = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.promptHistory) {
        this.history = (changes.promptHistory.newValue || []) as HistoryEntry[];
        this.syncCountsFromHistory();
        this.renderSessionList();
      }
      if (changes.timingStats) {
        this.timingStats = (changes.timingStats.newValue || { generationTimes: [], upscaleTimes: [] }) as TimingStats;
        this.renderSessionList();
      }
    };

    chrome.storage.local.onChanged.addListener(this.storageChangeHandler);
  }

  private stopGenerationListener() {
    if (this.storageChangeHandler) {
      chrome.storage.local.onChanged.removeListener(this.storageChangeHandler);
      this.storageChangeHandler = null;
    }
  }

  private syncHistoryState() {
    chrome.storage.local.get(['promptHistory', 'timingStats'], (result) => {
      this.history = (result.promptHistory || []) as HistoryEntry[];
      this.timingStats = (result.timingStats || { generationTimes: [], upscaleTimes: [] }) as TimingStats;
      this.syncCountsFromHistory();
      this.renderSessionList();
    });
  }

  private syncCountsFromHistory() {
    this.generatingCount = this.history.filter((e) => e.imageStatus === 'generating' || e.upscaleStatus === 'upscaling').length;
    this.setGeneratingState(this.generatingCount);
  }

  private setGeneratingState(count: number) {
    if (!this.indicator) return;

    this.generatingCount = count;
    this.indicator.classList.toggle('generating', count > 0);
    this.refreshBadge();
  }

  private removeIndicator() {
    if (this.indicator) {
      this.indicator.remove();
      this.indicator = null;
    }
  }

  private updateBadge() {
    if (!this.indicator) return;
    this.refreshBadge();

    this.indicator.classList.remove('pulse');
    void this.indicator.offsetWidth;
    this.indicator.classList.add('pulse');
  }

  private refreshBadge() {
    if (!this.indicator) return;

    const badge = this.indicator.querySelector('.comfyui-indicator-badge');
    if (!badge) return;

    if (this.generatingCount > 0 && this.detectedCount > 0) {
      badge.textContent = `${this.detectedCount}/${this.generatingCount}`;
    } else if (this.generatingCount > 0) {
      badge.textContent = `${this.generatingCount}`;
    } else {
      badge.textContent = this.detectedCount.toString();
    }
  }

  private startObserver() {
    if (this.observer) return;

    this.observer = new MutationObserver(() => {
      this.debouncedScan();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  private debouncedScan() {
    if (this.scanDebounceTimer) {
      clearTimeout(this.scanDebounceTimer);
    }
    this.scanDebounceTimer = setTimeout(() => {
      this.scanPage();
    }, 500);
  }

  private stopObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  private scanPage(manual = false) {
    if (!this.settings || !this.isActive) return;

    const pageText = document.body.innerText;
    const { startMarker, endMarker } = this.settings;
    let searchStart = 0;
    let newCount = 0;

    while (searchStart < pageText.length) {
      const startIndex = pageText.indexOf(startMarker, searchStart);
      if (startIndex === -1) break;

      const contentStart = startIndex + startMarker.length;
      const endIndex = pageText.indexOf(endMarker, contentStart);
      if (endIndex === -1) break;

      const promptText = pageText.substring(contentStart, endIndex).trim();
      const normalizedPrompt = promptText.toLowerCase();

      if (promptText && !this.detectedPrompts.has(normalizedPrompt)) {
        this.detectedPrompts.set(normalizedPrompt, promptText);
        this.detectedCount = this.detectedPrompts.size;
        this.updateBadge();
        this.renderSessionList();
        this.sendPromptToBackground(promptText);
        newCount++;
      }

      searchStart = endIndex + endMarker.length;
    }

    if (manual && this.panelStatus) {
      this.panelStatus.textContent = newCount > 0 ? `+${newCount} new` : 'No new prompts';
      setTimeout(() => {
        if (this.panelStatus) this.panelStatus.textContent = this.generatingCount > 0 ? `${this.generatingCount} active` : 'Idle';
      }, 1500);
    }
  }

  private sendPromptToBackground(text: string) {
    chrome.runtime.sendMessage({ type: 'AUTO_DETECTED_PROMPT', text }).catch((err) => {
      console.error('[Content] Failed to send prompt:', err);
    });
  }

  private getSessionEntries(): HistoryEntry[] {
    if (this.detectedPrompts.size === 0) return [];
    return this.history
      .filter((entry) => this.detectedPrompts.has(entry.text.trim().toLowerCase()))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  private renderSessionList() {
    if (!this.panelList) return;

    const entries = this.getSessionEntries();

    if (this.panelCount) {
      this.panelCount.textContent = `${entries.length} item${entries.length === 1 ? '' : 's'}`;
    }

    if (this.panelStatus) {
      this.panelStatus.textContent = this.buildPanelStatusText(entries);
    }
    this.updatePanelMetrics(entries);

    this.panelList.innerHTML = '';

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'comfyui-empty';
      empty.textContent = 'No detected prompts yet. Keep chatting and prompts will appear here automatically.';
      this.panelList.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const item = document.createElement('div');
      item.className = 'comfyui-item';

      const main = document.createElement('div');
      main.className = 'comfyui-item-main';

      const thumbCol = document.createElement('div');
      thumbCol.className = 'comfyui-thumb-col';
      const thumb = this.buildPreview(entry);
      thumbCol.appendChild(thumb);
      const thumbTimes = document.createElement('div');
      thumbTimes.className = 'comfyui-thumb-times';
      thumbTimes.innerHTML = this.buildTimingLabel(entry);
      thumbCol.appendChild(thumbTimes);
      main.appendChild(thumbCol);

      const content = document.createElement('div');
      content.className = 'comfyui-item-content';

      const top = document.createElement('div');
      top.className = 'comfyui-item-top';

      const head = document.createElement('div');
      head.className = 'comfyui-item-head';
      const title = document.createElement('div');
      title.className = 'comfyui-item-title';
      title.textContent = this.getDisplayTitle(entry.text);
      const idLine = document.createElement('div');
      idLine.className = 'comfyui-item-id';
      idLine.textContent = `ID ${entry.id.slice(0, 6)}`;
      head.appendChild(title);
      head.appendChild(idLine);

      const status = this.buildStatusBadge(entry);

      top.appendChild(head);
      top.appendChild(status);

      const text = document.createElement('div');
      text.className = 'comfyui-item-text';
      text.textContent = entry.text;

      const row = document.createElement('div');
      row.className = 'comfyui-item-row';

      const actions = document.createElement('div');
      actions.className = 'comfyui-item-actions';
      this.appendActions(actions, entry);

      row.appendChild(actions);

      content.appendChild(top);
      content.appendChild(text);
      content.appendChild(row);
      main.appendChild(content);
      item.appendChild(main);

      this.panelList.appendChild(item);
    }
  }

  private buildPreview(entry: HistoryEntry): HTMLElement {
    const previewUrl = entry.imageUrl || entry.baseImageUrl;
    if (previewUrl) {
      const img = document.createElement('img');
      img.className = 'comfyui-thumb clickable';
      const cached = this.previewCache.get(previewUrl);
      img.src = cached || previewUrl;
      img.alt = 'Generated preview';
      img.loading = 'lazy';
      img.title = 'Open image';
      img.addEventListener('error', () => this.tryLoadPreviewViaBackground(img, previewUrl), { once: true });
      img.addEventListener('click', () => window.open(previewUrl, '_blank'));
      return img;
    }

    const placeholder = document.createElement('div');
    placeholder.className = 'comfyui-thumb-placeholder';
    placeholder.title = entry.imageStatus === 'generating' || entry.upscaleStatus === 'upscaling'
      ? 'Rendering...'
      : 'No preview yet';
    return placeholder;
  }

  private async tryLoadPreviewViaBackground(img: HTMLImageElement, imageUrl: string) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_IMAGE_PREVIEW', url: imageUrl });
      if (!response?.success || !response?.dataUrl) return;
      this.previewCache.set(imageUrl, response.dataUrl);
      img.src = response.dataUrl as string;
    } catch (error) {
      console.error('[Content] Preview fallback failed:', error);
    }
  }

  private buildStatusBadge(entry: HistoryEntry): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'comfyui-status';

    if (entry.upscaleStatus === 'upscaling' && !entry.upscalePromptId) {
      badge.textContent = '⬆ Queued (Up)';
      badge.classList.add('queued');
      return badge;
    }

    if (entry.upscaleStatus === 'upscaling' && entry.upscalePromptId) {
      badge.textContent = '⬆ Upscaling';
      badge.classList.add('running');
      return badge;
    }

    if (entry.imageStatus === 'generating' && !entry.promptId) {
      badge.textContent = '⚡ Queued (Gen)';
      badge.classList.add('queued');
      return badge;
    }

    if (entry.imageStatus === 'generating' && entry.promptId) {
      badge.textContent = '⚡ Generating';
      badge.classList.add('running');
      return badge;
    }

    if (entry.upscaleStatus === 'done') {
      badge.textContent = '⬆ Upscaled';
      badge.classList.add('ready');
      return badge;
    }

    if (entry.imageStatus === 'done') {
      badge.textContent = '⚡ Ready';
      badge.classList.add('ready');
      return badge;
    }

    if (entry.imageStatus === 'error' || entry.upscaleStatus === 'error') {
      badge.textContent = 'Needs Attention';
      badge.classList.add('error');
      return badge;
    }

    badge.textContent = 'Queued';
    badge.classList.add('queued');
    return badge;
  }

  private buildPanelStatusText(entries: HistoryEntry[]): string {
    const runningGen = entries.filter((e) => e.imageStatus === 'generating' && !!e.promptId).length;
    const queuedGen = entries.filter((e) => e.imageStatus === 'generating' && !e.promptId).length;
    const runningUp = entries.filter((e) => e.upscaleStatus === 'upscaling' && !!e.upscalePromptId).length;
    const queuedUp = entries.filter((e) => e.upscaleStatus === 'upscaling' && !e.upscalePromptId).length;

    const running = runningGen + runningUp;
    const queued = queuedGen + queuedUp;

    if (running === 0 && queued === 0) return 'Idle';
    if (running > 0 && queued > 0) return `${running} running · ${queued} queued`;
    if (running > 0) return `${running} running`;
    return `${queued} queued`;
  }

  private appendActions(container: HTMLElement, entry: HistoryEntry) {
    const makeBtn = (label: string, onClick: () => void, extraClass = '') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `comfyui-action ${extraClass}`.trim();
      btn.textContent = label;
      btn.addEventListener('click', onClick);
      container.appendChild(btn);
    };

    if (entry.imageStatus === 'pending') {
      makeBtn('Generate', () => this.startGeneration(entry, false), 'primary');
    }

    if (entry.imageStatus === 'generating' && entry.promptId) {
      makeBtn('Cancel', () => this.cancelGeneration(entry), 'warn');
    }

    if (entry.upscaleStatus === 'upscaling' && entry.upscalePromptId) {
      makeBtn('Cancel Upscale', () => this.cancelUpscale(entry), 'warn');
    }

    if (entry.imageStatus === 'done' && !entry.upscaleStatus) {
      makeBtn('Upscale', () => this.startUpscale(entry), 'primary');
    }

    if (entry.imageStatus === 'error') {
      makeBtn('Retry', () => this.startGeneration(entry, true), 'primary');
    }

    if (entry.upscaleStatus === 'error' && entry.imageStatus === 'done') {
      makeBtn('Upscale Again', () => this.startUpscale(entry), 'primary');
    }

    if (entry.imageStatus === 'done') {
      makeBtn('Regenerate', () => this.startGeneration(entry, true));
    }

    makeBtn('Delete', () => this.deleteEntry(entry.id), 'danger');
  }

  private getDisplayTitle(text: string): string {
    const titleMatch = text.match(/^Title:\s*(.+)$/im);
    if (titleMatch?.[1]) return titleMatch[1].trim();

    const firstContent = text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && line !== '===' && !/^Keywords:/i.test(line) && !/^Aspect Ratio:/i.test(line) && !/^Negative:/i.test(line));

    return firstContent || 'Prompt';
  }

  private buildTimingLabel(entry: HistoryEntry): string {
    const now = Date.now();
    const parts: string[] = [];

    if (entry.generationStartedAt) {
      const genMs = entry.generationDoneAt
        ? entry.generationDoneAt - entry.generationStartedAt
        : now - entry.generationStartedAt;
      const prefix = entry.generationDoneAt ? 'Gen' : 'Gen...';
      parts.push(`${prefix} ${this.formatDuration(genMs)}`);
    }

    if (entry.upscaleStartedAt) {
      const upMs = entry.upscaleDoneAt
        ? entry.upscaleDoneAt - entry.upscaleStartedAt
        : now - entry.upscaleStartedAt;
      const prefix = entry.upscaleDoneAt ? 'Up' : 'Up...';
      parts.push(`${prefix} ${this.formatDuration(upMs)}`);
    }

    if (entry.generationDoneAt && entry.upscaleDoneAt && entry.generationStartedAt) {
      const totalMs = entry.upscaleDoneAt - entry.generationStartedAt;
      parts.push(`Total ${this.formatDuration(totalMs)}`);
    }

    if (parts.length === 0) return '&nbsp;';
    return parts.slice(0, 2).join('<br>');
  }

  private updatePanelMetrics(entries: HistoryEntry[]) {
    if (!this.panelMetrics) return;

    const avgGenMs = this.getAverageMs(this.timingStats.generationTimes);
    const avgUpMs = this.getAverageMs(this.timingStats.upscaleTimes);
    const avgGenText = avgGenMs ? this.formatDuration(avgGenMs) : 'n/a';
    const avgUpText = avgUpMs ? this.formatDuration(avgUpMs) : 'n/a';

    const activeGen = entries.filter((e) => e.imageStatus === 'generating').length;
    const activeUp = entries.filter((e) => e.upscaleStatus === 'upscaling').length;
    const activeTotal = activeGen + activeUp;

    let etaText = 'Total ETA: idle';
    if (activeTotal > 0) {
      const etaMs = (avgGenMs * activeGen) + (avgUpMs * activeUp);
      etaText = etaMs > 0
        ? `Total ETA: ~${this.formatDuration(etaMs)}`
        : 'Total ETA: estimating...';
    }

    this.panelMetrics.textContent = `Avg Gen: ${avgGenText} | Avg Upscale: ${avgUpText} | ${etaText}`;
  }

  private getAverageMs(arr: number[]): number {
    if (!arr || arr.length === 0) return 0;
    const total = arr.reduce((sum, value) => sum + value, 0);
    return Math.round(total / arr.length);
  }

  private formatDuration(ms: number): string {
    const totalSec = Math.max(1, Math.round(ms / 1000));
    if (totalSec < 60) return `${totalSec}s`;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return sec > 0 ? `${min}m${sec}s` : `${min}m`;
  }

  private startGeneration(entry: HistoryEntry, isRegenerate: boolean) {
    chrome.runtime.sendMessage({
      type: 'START_GENERATION',
      entryId: entry.id,
      text: entry.text,
      isRegenerate,
    }).catch((err) => console.error('[Content] Start generation failed:', err));
  }

  private cancelGeneration(entry: HistoryEntry) {
    if (!entry.promptId) return;
    chrome.runtime.sendMessage({
      type: 'CANCEL_GENERATION',
      entryId: entry.id,
      promptId: entry.promptId,
    }).catch((err) => console.error('[Content] Cancel generation failed:', err));
  }

  private startUpscale(entry: HistoryEntry) {
    chrome.runtime.sendMessage({
      type: 'START_UPSCALE',
      entryId: entry.id,
    }).catch((err) => console.error('[Content] Upscale failed:', err));
  }

  private cancelUpscale(entry: HistoryEntry) {
    if (!entry.upscalePromptId) return;
    chrome.runtime.sendMessage({
      type: 'CANCEL_UPSCALE',
      entryId: entry.id,
      promptId: entry.upscalePromptId,
    }).catch((err) => console.error('[Content] Cancel upscale failed:', err));
  }

  private deleteEntry(entryId: string) {
    chrome.runtime.sendMessage({ type: 'DELETE_ENTRY', entryId }).catch((err) => {
      console.error('[Content] Delete failed:', err);
    });
  }
}

declare global {
  interface Window {
    __comfyuiPromptDetector?: PromptAutoDetector;
  }
}

if (!window.__comfyuiPromptDetector) {
  window.__comfyuiPromptDetector = new PromptAutoDetector();
}
