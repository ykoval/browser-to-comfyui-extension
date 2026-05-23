type BuiltInWorkflowType = 'qwen-t2i' | 'qwen-t2i-seedvr';

type GenerationStage = 'queued' | 'polling';

interface ImageInfo {
  filename: string;
  subfolder: string;
  type: string;
}

interface ComfyUISettings {
  serverAddress: string;
  apiPath: string;
  workflowId: string;
  builtInWorkflow: BuiltInWorkflowType;
  autoSend: boolean;
  autoUpscaleWhenIdle: boolean;
  negativePrompt: string;
  seed: number;
  steps: number;
  cfg: number;
  headers: Record<string, string>;
  enableSeparator: boolean;
  aspectRatio: string;
  megapixel: number;
  promptStartMarker: string;
  promptEndMarker: string;
}

interface PromptEntry {
  id: string;
  text: string;
  createdAt: number;
  // Base generation
  imageStatus: 'pending' | 'generating' | 'done' | 'error';
  imageUrl?: string;            // Best available image URL (base or upscaled)
  baseImageUrl?: string;        // Node 79 output URL
  baseImageInfo?: ImageInfo;    // Node 79 file info (for upscale submission)
  promptId?: string;
  generationCount?: number;
  generationStage?: GenerationStage;
  basePromptId?: string;
  pollAttempts?: number;
  workflowType?: BuiltInWorkflowType;
  // Upscale (user-triggered)
  upscaleStatus?: 'upscaling' | 'done' | 'error';
  upscalePromptId?: string;
  upscalePollAttempts?: number;
  // Timing (millisecond timestamps)
  generationStartedAt?: number;  // When submitted to ComfyUI (not queued)
  generationDoneAt?: number;     // When base image ready
  upscaleStartedAt?: number;     // When upscale submitted to ComfyUI
  upscaleDoneAt?: number;        // When upscaled image ready
}

interface TimingStats {
  generationTimes: number[];  // Last N generation durations (ms)
  upscaleTimes: number[];     // Last N upscale durations (ms)
}

interface ComfyUIPayload {
  prompt: string;
  negativePrompt: string;
  seed: number;
  steps: number;
  cfg: number;
  aspectRatio: string;
  megapixel: number;
}

interface ComfyUIResponse {
  prompt_id: string;
  number: number;
  node_errors: Record<string, unknown>;
}

type MappingType = 'prompt' | 'negativePrompt' | 'seed' | 'steps' | 'cfg' | 'aspectRatio' | 'megapixel' | 'outputImage';

interface WorkflowMapping {
  type: MappingType;
  nodeId: string;
  inputKey: string;
}

interface ImportedWorkflow {
  id: string;
  name: string;
  workflow: Record<string, WorkflowNode>;
  mappings: WorkflowMapping[];
  outputNodeId: string;
  createdAt: number;
}

interface WorkflowNode {
  inputs: Record<string, unknown>;
  class_type: string;
}

const STORAGE_KEYS = {
  SETTINGS: 'comfyuiSettings',
  HISTORY: 'promptHistory',
  ACTIVE_TAB: 'activeTab',
  AUTO_DETECT_DOMAINS: 'autoDetectDomains',
  WORKFLOWS: 'importedWorkflows',
  ACTIVE_WORKFLOW: 'activeWorkflowId',
  TIMING_STATS: 'timingStats',
} as const;

const MAX_TIMING_SAMPLES = 20; // Keep last N timing samples for averages

const ASPECT_RATIOS = [
  '1:1 ◻',
  '5:4 ▭',
  '4:3 ▭',
  '3:2 ▭',
  '16:9 ▭',
  '2:1 ▭',
  '21:9 ▭',
  '32:9 ▭',
  '4:5 ▯',
  '3:4 ▯',
  '2:3 ▯',
  '9:16 ▯',
  '1:2 ▯',
  '9:21 ▯',
  '9:32 ▯',
] as const;

const BUILT_IN_WORKFLOWS: { id: BuiltInWorkflowType; name: string; description: string }[] = [
  { id: 'qwen-t2i', name: 'Qwen T2I', description: 'Standard KSampler upscale' },
  { id: 'qwen-t2i-seedvr', name: 'Qwen T2I + SeedVR', description: 'SeedVR2 upscaler (higher quality)' },
];

const DEFAULT_SETTINGS: ComfyUISettings = {
  serverAddress: 'http://127.0.0.1:8188',
  apiPath: '/prompt',
  workflowId: 'default_workflow',
  builtInWorkflow: 'qwen-t2i',
  autoSend: false,
  autoUpscaleWhenIdle: false,
  negativePrompt: 'dust, dots, stain',
  seed: -1,
  steps: 20,
  cfg: 4,
  headers: {},
  enableSeparator: true,
  aspectRatio: '16:9 ▭',
  megapixel: 2.5,
  promptStartMarker: '[PROMPT START]',
  promptEndMarker: '[PROMPT END]',
};

const MAX_HISTORY_ENTRIES = 50;

export type { ComfyUISettings, PromptEntry, ComfyUIPayload, ComfyUIResponse, MappingType, WorkflowMapping, ImportedWorkflow, WorkflowNode, BuiltInWorkflowType, GenerationStage, ImageInfo, TimingStats };
export { STORAGE_KEYS, DEFAULT_SETTINGS, MAX_HISTORY_ENTRIES, MAX_TIMING_SAMPLES, ASPECT_RATIOS, BUILT_IN_WORKFLOWS };
