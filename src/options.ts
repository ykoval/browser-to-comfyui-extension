import { getSettings, saveSettings } from './utils';
import { ComfyUISettings } from './types';

class OptionsApp {
  private form: HTMLFormElement;
  private serverAddress: HTMLInputElement;
  private apiPath: HTMLInputElement;
  private workflowId: HTMLInputElement;
  private negativePrompt: HTMLTextAreaElement;
  private seed: HTMLInputElement;
  private autoSend: HTMLInputElement;

  constructor() {
    this.form = document.getElementById('settingsForm') as HTMLFormElement;
    this.serverAddress = document.getElementById('serverAddress') as HTMLInputElement;
    this.apiPath = document.getElementById('apiPath') as HTMLInputElement;
    this.workflowId = document.getElementById('workflowId') as HTMLInputElement;
    this.negativePrompt = document.getElementById('negativePrompt') as HTMLTextAreaElement;
    this.seed = document.getElementById('seed') as HTMLInputElement;
    this.autoSend = document.getElementById('autoSend') as HTMLInputElement;

    this.init();
  }

  private async init() {
    const settings = await getSettings();
    this.populateForm(settings);
    this.form.addEventListener('submit', this.handleSubmit.bind(this));
  }

  private populateForm(settings: ComfyUISettings) {
    this.serverAddress.value = settings.serverAddress;
    this.apiPath.value = settings.apiPath;
    this.workflowId.value = settings.workflowId;
    this.negativePrompt.value = settings.negativePrompt;
    this.seed.value = settings.seed.toString();
    this.autoSend.checked = settings.autoSend;
  }

  private async handleSubmit(event: Event) {
    event.preventDefault();

    const currentSettings = await getSettings();
    const settings: ComfyUISettings = {
      ...currentSettings,
      serverAddress: this.serverAddress.value,
      apiPath: this.apiPath.value,
      workflowId: this.workflowId.value,
      negativePrompt: this.negativePrompt.value,
      seed: parseInt(this.seed.value) || -1,
      autoSend: this.autoSend.checked,
    };

    await saveSettings(settings);
    alert('Settings saved!');
  }
}

new OptionsApp();
