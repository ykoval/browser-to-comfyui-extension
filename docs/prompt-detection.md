# Prompt Detection System

## Overview

The extension detects prompts on web pages using **marker-based text extraction**. Users configure start/end markers (e.g., `[PROMPT START]` / `[PROMPT END]`), and the system extracts text between these markers.

## Detection Modes

### 1. Manual Scan (One-time)
**Trigger**: User clicks "Scan Page" button in popup  
**File**: `src/popup.ts` → `handleScanPage()`, `extractPrompts()`

**Flow**:
1. Popup executes script on active tab to get `document.body.innerText`
2. `extractPrompts()` finds all text between configured markers
3. Duplicates are filtered (case-insensitive comparison)
4. New prompts saved via `addPromptEntry()`

### 2. Auto-Detect (Continuous)
**Trigger**: User enables toggle for current domain  
**Files**: `src/content.ts` (PromptAutoDetector class), `src/popup.ts`, `src/background.ts`

**Flow**:
1. User enables auto-detect toggle in popup
2. Content script (`content.ts`) injected into page
3. `INIT_AUTO_DETECT` message sent with marker settings
4. MutationObserver watches for DOM changes
5. On mutation: debounced scan extracts new prompts
6. Prompts sent to background via `AUTO_DETECTED_PROMPT` message
7. Background deduplicates and saves to history

## Key Components

### Content Script: `PromptAutoDetector` class
**Location**: `src/content.ts`

| Property | Purpose |
|----------|---------|
| `observer` | MutationObserver watching DOM changes |
| `settings` | Start/end markers from user settings |
| `detectedPrompts` | Set of already-detected prompts (dedup) |
| `indicator` | Floating UI badge showing detection count |

| Method | Purpose |
|--------|---------|
| `start(settings)` | Initialize detection with markers |
| `stop()` | Clean up observer and UI |
| `scanPage()` | Core extraction logic |
| `startObserver()` | Begin DOM mutation watching |
| `sendPromptToBackground(text)` | Send detected prompt via chrome.runtime |

### Core Extraction Algorithm
```typescript
extractPrompts(text: string): string[] {
  const seen = new Map<string, string>();
  const { startMarker, endMarker } = this.settings;
  let searchStart = 0;

  while (searchStart < text.length) {
    const startIndex = text.indexOf(startMarker, searchStart);
    if (startIndex === -1) break;

    const contentStart = startIndex + startMarker.length;
    const endIndex = text.indexOf(endMarker, contentStart);
    if (endIndex === -1) break;

    const promptText = text.substring(contentStart, endIndex).trim();
    const normalizedPrompt = promptText.toLowerCase();
    if (promptText && !seen.has(normalizedPrompt)) {
      seen.set(normalizedPrompt, promptText);
    }
    searchStart = endIndex + endMarker.length;
  }
  return Array.from(seen.values());
}
```

### Background Message Handler
**Location**: `src/background.ts`

```typescript
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'AUTO_DETECTED_PROMPT') {
    handleAutoDetectedPrompt(message.text);
  }
});
```

`handleAutoDetectedPrompt()`:
1. Checks for duplicates via `isPromptDuplicate()`
2. Adds to history via `addPromptEntry()`
3. If `autoSend` enabled: sends to ComfyUI immediately

## Configuration

**Settings Location**: `src/types.ts` → `ComfyUISettings`

| Setting | Default | Purpose |
|---------|---------|---------|
| `promptStartMarker` | `[PROMPT START]` | Beginning delimiter |
| `promptEndMarker` | `[PROMPT END]` | Ending delimiter |

**Domain Tracking**: `src/utils.ts`
- `getAutoDetectDomains()` - Get list of enabled domains
- `toggleAutoDetect(domain, enabled)` - Enable/disable for domain
- Storage key: `STORAGE_KEYS.AUTO_DETECT_DOMAINS`

## Message Types

| Message | Direction | Purpose |
|---------|-----------|---------|
| `INIT_AUTO_DETECT` | popup → content | Start detection with settings |
| `STOP_AUTO_DETECT` | popup → content | Stop detection |
| `AUTO_DETECTED_PROMPT` | content → background | Send detected prompt |

## Visual Indicator

When auto-detect is active, a draggable floating badge appears on page:
- Shows count of detected prompts
- Click triggers manual re-scan
- Pulses on new detection
- Styled with CSS injected by content script

## Deduplication

Two levels (both case-insensitive):
1. **Content script**: `detectedPrompts` Map with normalized (lowercase) keys prevents re-sending same prompt
2. **Background**: `isPromptDuplicate()` checks against stored history

## File Structure Summary

```
src/
├── content.ts      # PromptAutoDetector class (injected into pages)
├── background.ts   # Message handler, handleAutoDetectedPrompt()
├── popup.ts        # Manual scan, auto-detect toggle UI
├── utils.ts        # Storage helpers, domain tracking
└── types.ts        # Settings interface with marker config
```
