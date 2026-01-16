import { ImportedWorkflow, WorkflowMapping, WorkflowNode, MappingType, STORAGE_KEYS, ComfyUIPayload } from './types';

const storage = chrome.storage;

async function getWorkflows(): Promise<ImportedWorkflow[]> {
  const result = await storage.local.get(STORAGE_KEYS.WORKFLOWS);
  return result[STORAGE_KEYS.WORKFLOWS] || [];
}

async function saveWorkflows(workflows: ImportedWorkflow[]): Promise<void> {
  await storage.local.set({ [STORAGE_KEYS.WORKFLOWS]: workflows });
}

async function getActiveWorkflowId(): Promise<string | null> {
  const result = await storage.local.get(STORAGE_KEYS.ACTIVE_WORKFLOW);
  return result[STORAGE_KEYS.ACTIVE_WORKFLOW] || null;
}

async function setActiveWorkflowId(id: string | null): Promise<void> {
  await storage.local.set({ [STORAGE_KEYS.ACTIVE_WORKFLOW]: id });
}

async function getActiveWorkflow(): Promise<ImportedWorkflow | null> {
  const activeId = await getActiveWorkflowId();
  if (!activeId) return null;
  const workflows = await getWorkflows();
  return workflows.find(w => w.id === activeId) || null;
}

async function addWorkflow(workflow: ImportedWorkflow): Promise<void> {
  const workflows = await getWorkflows();
  workflows.push(workflow);
  await saveWorkflows(workflows);
}

async function updateWorkflow(id: string, updates: Partial<ImportedWorkflow>): Promise<void> {
  const workflows = await getWorkflows();
  const index = workflows.findIndex(w => w.id === id);
  if (index !== -1) {
    workflows[index] = { ...workflows[index], ...updates };
    await saveWorkflows(workflows);
  }
}

async function deleteWorkflow(id: string): Promise<void> {
  const workflows = await getWorkflows();
  const filtered = workflows.filter(w => w.id !== id);
  await saveWorkflows(filtered);
  const activeId = await getActiveWorkflowId();
  if (activeId === id) {
    await setActiveWorkflowId(null);
  }
}

interface DetectedMapping {
  type: MappingType;
  nodeId: string;
  inputKey: string;
  confidence: 'high' | 'medium' | 'low';
  nodeType: string;
}

function detectWorkflowMappings(workflow: Record<string, WorkflowNode>): DetectedMapping[] {
  const mappings: DetectedMapping[] = [];

  for (const [nodeId, node] of Object.entries(workflow)) {
    const classType = node.class_type;

    if (classType === 'CLIPTextEncode') {
      const hasTextInput = 'text' in node.inputs;
      if (hasTextInput) {
        const textValue = node.inputs.text;
        const isNegative = typeof textValue === 'string' && 
          (textValue.toLowerCase().includes('dust') || 
           textValue.toLowerCase().includes('blur') ||
           textValue.toLowerCase().includes('bad') ||
           textValue.toLowerCase().includes('ugly'));
        
        mappings.push({
          type: isNegative ? 'negativePrompt' : 'prompt',
          nodeId,
          inputKey: 'text',
          confidence: isNegative ? 'medium' : 'medium',
          nodeType: classType,
        });
      }
    }

    if (classType === 'KSampler' || classType === 'KSamplerAdvanced') {
      if ('seed' in node.inputs) {
        mappings.push({ type: 'seed', nodeId, inputKey: 'seed', confidence: 'high', nodeType: classType });
      }
      if ('steps' in node.inputs) {
        mappings.push({ type: 'steps', nodeId, inputKey: 'steps', confidence: 'high', nodeType: classType });
      }
      if ('cfg' in node.inputs) {
        mappings.push({ type: 'cfg', nodeId, inputKey: 'cfg', confidence: 'high', nodeType: classType });
      }
    }

    if (classType === 'SaveImage' || classType === 'PreviewImage') {
      mappings.push({ type: 'outputImage', nodeId, inputKey: 'images', confidence: 'high', nodeType: classType });
    }

    if (classType === 'Ratio to Size' || classType === 'EmptyLatentImage') {
      if ('ratio' in node.inputs) {
        mappings.push({ type: 'aspectRatio', nodeId, inputKey: 'ratio', confidence: 'high', nodeType: classType });
      }
      if ('Megapixel' in node.inputs) {
        mappings.push({ type: 'megapixel', nodeId, inputKey: 'Megapixel', confidence: 'high', nodeType: classType });
      }
    }

    if (classType === 'AGSoftTextSplit' || classType === 'TextInput' || classType === 'PrimitiveNode') {
      if ('text' in node.inputs && typeof node.inputs.text === 'string') {
        const existingPrompt = mappings.find(m => m.type === 'prompt');
        if (!existingPrompt) {
          mappings.push({ type: 'prompt', nodeId, inputKey: 'text', confidence: 'medium', nodeType: classType });
        }
      }
    }
  }

  return mappings;
}

function findOutputNodeId(workflow: Record<string, WorkflowNode>): string | null {
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (node.class_type === 'SaveImage') {
      return nodeId;
    }
  }
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (node.class_type === 'PreviewImage') {
      return nodeId;
    }
  }
  return null;
}

function applyMappingsToWorkflow(
  workflow: Record<string, WorkflowNode>,
  mappings: WorkflowMapping[],
  payload: ComfyUIPayload
): Record<string, WorkflowNode> {
  const result = structuredClone(workflow);

  for (const mapping of mappings) {
    const node = result[mapping.nodeId];
    if (!node) continue;

    switch (mapping.type) {
      case 'prompt':
        node.inputs[mapping.inputKey] = payload.prompt;
        break;
      case 'negativePrompt':
        node.inputs[mapping.inputKey] = payload.negativePrompt;
        break;
      case 'seed':
        node.inputs[mapping.inputKey] = payload.seed === -1 
          ? Math.floor(Math.random() * 1000000000000) 
          : payload.seed;
        break;
      case 'steps':
        node.inputs[mapping.inputKey] = payload.steps;
        break;
      case 'cfg':
        node.inputs[mapping.inputKey] = payload.cfg;
        break;
      case 'aspectRatio':
        node.inputs[mapping.inputKey] = payload.aspectRatio;
        break;
      case 'megapixel':
        node.inputs[mapping.inputKey] = payload.megapixel;
        break;
    }
  }

  return result;
}

function parseWorkflowFile(content: string): Record<string, WorkflowNode> | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed.prompt && typeof parsed.prompt === 'object') {
      return parsed.prompt as Record<string, WorkflowNode>;
    }
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      const firstKey = Object.keys(parsed)[0];
      if (firstKey && parsed[firstKey]?.class_type) {
        return parsed as Record<string, WorkflowNode>;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export {
  getWorkflows,
  saveWorkflows,
  getActiveWorkflowId,
  setActiveWorkflowId,
  getActiveWorkflow,
  addWorkflow,
  updateWorkflow,
  deleteWorkflow,
  detectWorkflowMappings,
  findOutputNodeId,
  applyMappingsToWorkflow,
  parseWorkflowFile,
};

export type { DetectedMapping };
