/// <reference types="chrome" />

interface AutoDetectSettings {
  startMarker: string;
  endMarker: string;
}

class PromptAutoDetector {
  private observer: MutationObserver | null = null;
  private settings: AutoDetectSettings | null = null;
  private detectedPrompts: Map<string, string> = new Map();
  private detectedCount: number = 0;
  private indicator: HTMLElement | null = null;
  private isActive: boolean = false;
  private scanDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isDragging: boolean = false;
  private dragOffset: { x: number; y: number } = { x: 0, y: 0 };
  private generatingCount: number = 0;

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
    this.createIndicator();
    this.scanPage();
    this.startObserver();
    this.startGenerationListener();
  }

  private stop() {
    this.isActive = false;
    this.stopObserver();
    this.stopGenerationListener();
    this.removeIndicator();
    this.detectedPrompts.clear();
    this.detectedCount = 0;
  }

  private createIndicator() {
    if (this.indicator) return;

    this.indicator = document.createElement('div');
    this.indicator.id = 'comfyui-auto-detect-indicator';
    this.indicator.innerHTML = `
      <div class="comfyui-indicator-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 6v6l4 2"/>
        </svg>
      </div>
      <div class="comfyui-indicator-badge">0</div>
    `;
    
    const style = document.createElement('style');
    style.textContent = `
      #comfyui-auto-detect-indicator {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 48px;
        height: 48px;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 2px solid #00ff88;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        z-index: 2147483647;
        box-shadow: 0 4px 20px rgba(0, 255, 136, 0.3), 0 0 30px rgba(0, 255, 136, 0.1);
        transition: box-shadow 0.3s ease, transform 0.1s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        user-select: none;
      }
      #comfyui-auto-detect-indicator:hover {
        box-shadow: 0 6px 30px rgba(0, 255, 136, 0.5), 0 0 40px rgba(0, 255, 136, 0.2);
      }
      #comfyui-auto-detect-indicator.dragging {
        cursor: grabbing;
        transform: scale(1.1);
      }
      #comfyui-auto-detect-indicator .comfyui-indicator-icon {
        color: #00ff88;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      }
      #comfyui-auto-detect-indicator .comfyui-indicator-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 20px;
        height: 20px;
        background: #ff2e97;
        color: white;
        font-size: 11px;
        font-weight: bold;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 6px;
        box-shadow: 0 2px 8px rgba(255, 46, 151, 0.5);
        pointer-events: none;
      }
      #comfyui-auto-detect-indicator.pulse .comfyui-indicator-badge {
        animation: comfyui-pulse 0.6s ease-out;
      }
      #comfyui-auto-detect-indicator.scanning .comfyui-indicator-icon {
        animation: comfyui-spin 1s linear infinite;
      }
      #comfyui-auto-detect-indicator.generating .comfyui-indicator-badge {
        background: #ffaa00;
        box-shadow: 0 2px 8px rgba(255, 170, 0, 0.5);
      }
      #comfyui-auto-detect-indicator.generating {
        border-color: transparent;
        background-clip: padding-box;
      }
      #comfyui-auto-detect-indicator.generating::before {
        content: '';
        position: absolute;
        inset: -3px;
        border-radius: 50%;
        background: conic-gradient(from 0deg, #00ff88, #00ccff, #ff2e97, #ffaa00, #00ff88);
        animation: comfyui-border-spin 1.5s linear infinite;
        z-index: -1;
      }
      #comfyui-auto-detect-indicator.generating::after {
        content: '';
        position: absolute;
        inset: -3px;
        border-radius: 50%;
        background: conic-gradient(from 0deg, #00ff88, #00ccff, #ff2e97, #ffaa00, #00ff88);
        animation: comfyui-border-spin 1.5s linear infinite;
        filter: blur(8px);
        opacity: 0.6;
        z-index: -2;
      }
      @keyframes comfyui-pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.3); background: #00ff88; }
        100% { transform: scale(1); }
      }
      @keyframes comfyui-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes comfyui-border-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(this.indicator);
    
    this.setupDraggable();
  }

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
    if (!this.indicator) return;
    this.indicator.classList.add('scanning');
    this.scanPage();
    setTimeout(() => {
      this.indicator?.classList.remove('scanning');
    }, 500);
  }

  private storageChangeHandler: ((changes: { [key: string]: chrome.storage.StorageChange }) => void) | null = null;

  private startGenerationListener() {
    // Check initial state
    this.checkGenerationStatus();

    // Listen for storage changes to promptHistory
    this.storageChangeHandler = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.promptHistory) {
        const history = changes.promptHistory.newValue || [];
        const count = history.filter((e: { imageStatus: string }) => e.imageStatus === 'generating').length;
        this.setGeneratingState(count);
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

  private checkGenerationStatus() {
    chrome.storage.local.get('promptHistory', (result) => {
      const history = result.promptHistory || [];
      const count = history.filter((e: { imageStatus: string }) => e.imageStatus === 'generating').length;
      this.setGeneratingState(count);
    });
  }

  private setGeneratingState(count: number) {
    if (!this.indicator) return;
    this.generatingCount = count;

    if (count > 0) {
      this.indicator.classList.add('generating');
      // Show generating count on the badge (amber color via CSS)
      const badge = this.indicator.querySelector('.comfyui-indicator-badge');
      if (badge) {
        badge.textContent = count.toString();
      }
    } else {
      this.indicator.classList.remove('generating');
      // Restore detected prompt count on the badge (pink color via CSS)
      const badge = this.indicator.querySelector('.comfyui-indicator-badge');
      if (badge) {
        badge.textContent = this.detectedCount.toString();
      }
    }
  }

  private removeIndicator() {
    if (this.indicator) {
      this.indicator.remove();
      this.indicator = null;
    }
  }

  private updateBadge(count: number) {
    if (!this.indicator) return;
    const badge = this.indicator.querySelector('.comfyui-indicator-badge');
    if (badge) {
      badge.textContent = count.toString();
      this.indicator.classList.remove('pulse');
      void this.indicator.offsetWidth;
      this.indicator.classList.add('pulse');
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

  private scanPage() {
    if (!this.settings || !this.isActive) return;
    
    const pageText = document.body.innerText;
    const { startMarker, endMarker } = this.settings;
    let searchStart = 0;

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
        this.detectedCount++;
        this.updateBadge(this.detectedCount);
        console.log(`[Content] Detected #${this.detectedCount}: "${promptText.substring(0, 50)}..."`);
        this.sendPromptToBackground(promptText);
      }

      searchStart = endIndex + endMarker.length;
    }
  }

  private sendPromptToBackground(text: string) {
    console.log(`[Content] Sending to background: "${text.substring(0, 50)}..."`);
    chrome.runtime.sendMessage({
      type: 'AUTO_DETECTED_PROMPT',
      text: text,
    }).then(response => {
      console.log(`[Content] Background response:`, response);
    }).catch(err => {
      console.error(`[Content] Failed to send:`, err);
    });
  }
}

const detector = new PromptAutoDetector();
