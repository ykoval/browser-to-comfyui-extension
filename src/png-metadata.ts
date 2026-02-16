/**
 * PNG tEXt chunk parser for extracting ComfyUI metadata from generated images.
 * Pure TypeScript, no external dependencies.
 *
 * ComfyUI embeds metadata as PNG tEXt chunks:
 * - "prompt": Full API JSON (node definitions, node 118 has prompt text)
 * - "prompt_text": Clean prompt string (JSON-encoded, newer extension images only)
 * - "workflow": LiteGraph JSON (visual editor format)
 */

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

export interface ExtractedPrompt {
  text: string;
  source: 'prompt_text' | 'node_118';
}

/**
 * Extract all tEXt chunks from a PNG file.
 * Returns a map of keyword → text value.
 */
async function extractPNGTextChunks(file: File): Promise<Record<string, string>> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Verify PNG signature
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Not a valid PNG file');
    }
  }

  const chunks: Record<string, string> = {};
  let offset = 8; // Skip signature

  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset, false); // big-endian
    const chunkType = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);

    if (chunkType === 'IEND') break;

    if (chunkType === 'tEXt') {
      const dataStart = offset + 8;
      const dataEnd = dataStart + chunkLength;

      if (dataEnd <= buffer.byteLength) {
        // Find null separator between keyword and text
        let nullPos = dataStart;
        while (nullPos < dataEnd && bytes[nullPos] !== 0x00) {
          nullPos++;
        }

        if (nullPos < dataEnd) {
          const keyword = new TextDecoder('latin1').decode(bytes.slice(dataStart, nullPos));
          const text = new TextDecoder('latin1').decode(bytes.slice(nullPos + 1, dataEnd));
          chunks[keyword] = text;
        }
      }
    }

    // Advance: 4 (length) + 4 (type) + data + 4 (CRC)
    offset += 12 + chunkLength;
  }

  return chunks;
}

/**
 * Extract the prompt text from a ComfyUI-generated PNG.
 *
 * Priority:
 * 1. "prompt_text" chunk (JSON-encoded string, from extension-generated images)
 * 2. "prompt" chunk → node 118 → inputs.text (from all ComfyUI images)
 *
 * Returns null if no prompt found.
 */
export async function extractPromptFromPNG(file: File): Promise<ExtractedPrompt | null> {
  try {
    const chunks = await extractPNGTextChunks(file);

    // Priority 1: prompt_text (JSON-encoded string)
    if (chunks.prompt_text) {
      try {
        const parsed = JSON.parse(chunks.prompt_text);
        if (typeof parsed === 'string' && parsed.trim().length > 0) {
          return { text: parsed, source: 'prompt_text' };
        }
      } catch {
        // Maybe it's a raw string (not JSON-encoded)
        if (chunks.prompt_text.trim().length > 0) {
          return { text: chunks.prompt_text, source: 'prompt_text' };
        }
      }
    }

    // Priority 2: prompt JSON → node 118 → inputs.text
    if (chunks.prompt) {
      try {
        const promptData = JSON.parse(chunks.prompt);
        const node118Text = promptData?.['118']?.inputs?.text;
        if (typeof node118Text === 'string' && node118Text.trim().length > 0) {
          return { text: node118Text, source: 'node_118' };
        }
      } catch {
        // Malformed JSON, skip
      }
    }

    return null;
  } catch (error) {
    console.error('[PNG Parser] Failed to parse:', error);
    return null;
  }
}
