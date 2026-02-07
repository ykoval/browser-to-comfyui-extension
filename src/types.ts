type BuiltInWorkflowType = 'qwen-t2i' | 'qwen-t2i-seedvr';

type GenerationStage = 'polling-base' | 'uploading-upscale' | 'polling-upscale';

interface ComfyUISettings {
  serverAddress: string;
  apiPath: string;
  workflowId: string;
  builtInWorkflow: BuiltInWorkflowType;
  autoSend: boolean;
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
  imageStatus: 'pending' | 'generating' | 'done' | 'error';
  imageUrl?: string;
  promptId?: string;
  generationCount?: number;
  // Alarm-based orchestration fields (set by background service worker)
  generationStage?: GenerationStage;
  basePromptId?: string;
  pollAttempts?: number;
  workflowType?: BuiltInWorkflowType;
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
} as const;

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
  serverAddress: 'http://192.168.50.143:8188',
  apiPath: '/prompt',
  workflowId: 'default_workflow',
  builtInWorkflow: 'qwen-t2i',
  autoSend: false,
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

export type { ComfyUISettings, PromptEntry, ComfyUIPayload, ComfyUIResponse, MappingType, WorkflowMapping, ImportedWorkflow, WorkflowNode, BuiltInWorkflowType, GenerationStage };
export { STORAGE_KEYS, DEFAULT_SETTINGS, MAX_HISTORY_ENTRIES, ASPECT_RATIOS, BUILT_IN_WORKFLOWS };
