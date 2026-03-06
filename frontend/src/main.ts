/**
 * Together AI Voice Demo - Frontend Client
 * 
 * Two top-level features:
 *  - Text to Speech (TTS): WebSocket proxy mode or Together REST API mode.
 *  - Speech to Text (ASR): Streams microphone audio to an ASR deployment via
 *    the backend WebSocket proxy and displays live transcription.
 */

import './style.css';

// ---------- Types ----------

interface TTSConfig {
  ws_url: string;
  api_key?: string;
  language: string;
  sample_rate: number;
}

interface TogetherConfig {
  mode: 'together';
  model: string;
  voice: string;
  api_key: string;
  sample_rate: number;
}

interface TTSMessage {
  type: string;
  [key: string]: unknown;
}

type AppMode = 'websocket' | 'together';
type FeatureView = 'tts' | 'asr';
type Status = 'ready' | 'connecting' | 'connected' | 'streaming' | 'error';

// ---------- Voice definitions per model ----------

// Full Cartesia voice list (shared across sonic, sonic-2, sonic-3)
const CARTESIA_VOICES: string[] = [
  'german conversational woman', 'nonfiction man', 'friendly sidekick',
  'french conversational lady', 'french narrator lady', 'german reporter woman',
  'indian lady', 'british reading lady', 'british narration lady',
  'japanese children book', 'japanese woman conversational', 'japanese male conversational',
  'reading lady', 'newsman', 'child', 'meditation lady', 'maria',
  "1920's radioman", 'newslady', 'calm lady', 'helpful woman', 'mexican woman',
  'korean narrator woman', 'russian calm lady', 'russian narrator man 1',
  'russian narrator man 2', 'russian narrator woman', 'hinglish speaking lady',
  'italian narrator woman', 'polish narrator woman', 'chinese female conversational',
  'pilot over intercom', 'chinese commercial man', 'french narrator man',
  'spanish narrator man', 'reading man', 'new york man', 'friendly french man',
  'barbershop man', 'indian man', 'australian customer support man',
  'friendly australian man', 'wise man', 'friendly reading man', 'customer support man',
  'dutch confident man', 'dutch man', 'hindi reporter man', 'italian calm man',
  'italian narrator man', 'swedish narrator man', 'polish confident man',
  'spanish-speaking storyteller man', 'kentucky woman', 'chinese commercial woman',
  'middle eastern woman', 'hindi narrator woman', 'sarah', 'sarah curious',
  'laidback woman', 'reflective woman', 'helpful french lady', 'pleasant brazilian lady',
  'customer support lady', 'british lady', 'wise lady', 'australian narrator lady',
  'indian customer support lady', 'swedish calm lady', 'spanish narrator lady',
  'salesman', 'yogaman', 'movieman', 'wizardman', 'australian woman',
  'korean calm woman', 'friendly german man', 'announcer man', 'wise guide man',
  'midwestern man', 'kentucky man', 'brazilian young man', 'chinese call center man',
  'german reporter man', 'confident british man', 'southern man', 'classy british man',
  'polite man', 'mexican man', 'korean narrator man', 'turkish narrator man',
  'turkish calm man', 'hindi calm man', 'hindi narrator man', 'polish narrator man',
  'polish young man', 'alabama male', 'australian male', 'anime girl',
  'japanese man book', 'sweet lady', 'commercial lady', 'teacher lady', 'princess',
  'commercial man', 'asmr lady', 'professional woman', 'tutorial man',
  'calm french woman', 'new york woman', 'spanish-speaking lady', 'midwestern woman',
  'sportsman', 'storyteller lady', 'spanish-speaking man', 'doctor mischief',
  'spanish-speaking reporter man', 'young spanish-speaking woman', 'the merchant',
  'stern french man', 'madame mischief', 'german storyteller man', 'female nurse',
  'german conversation man', 'friendly brazilian man', 'german woman', 'southern woman',
  'british customer support lady', 'chinese woman narrator', 'pleasant man',
  'california girl', 'john', 'anna',
];

const MODEL_VOICES: Record<string, string[]> = {
  'canopylabs/orpheus-3b-0.1-ft': [
    'tara', 'leah', 'jess', 'leo', 'dan', 'mia', 'zac', 'zoe',
  ],
  'hexgrad/Kokoro-82M': [
    'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore',
    'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
    'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael',
    'am_onyx', 'am_puck', 'am_santa',
    'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
    'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
    'jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo',
    'zf_xiaobei', 'zf_xiaoni', 'zf_xiaoxiao', 'zf_xiaoyi',
    'zm_yunjian', 'zm_yunxi', 'zm_yunxia', 'zm_yunyang',
    'ef_dora', 'em_alex', 'em_santa', 'ff_siwis',
    'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi',
    'if_sara', 'im_nicola', 'pf_dora', 'pm_alex', 'pm_santa',
  ],
  'cartesia/sonic-3': CARTESIA_VOICES,
  'cartesia/sonic-2': CARTESIA_VOICES,
  'cartesia/sonic':   CARTESIA_VOICES,
};

const MODEL_DEFAULT_VOICE: Record<string, string> = {
  'canopylabs/orpheus-3b-0.1-ft': 'tara',
  'hexgrad/Kokoro-82M': 'af_heart',
  'cartesia/sonic-3': 'sweet lady',
  'cartesia/sonic-2': 'sweet lady',
  'cartesia/sonic': 'sweet lady',
};

// ---------- Audio settings ----------

const DEFAULT_SAMPLE_RATE = 24000;
const AUDIO_CHANNELS = 1;

// ---------- State ----------

let currentFeature: FeatureView = 'tts';
let currentMode: AppMode = 'websocket';
let websocket: WebSocket | null = null;
let audioContext: AudioContext | null = null;
let audioQueue: Float32Array[] = [];
let currentStatus: Status = 'ready';
let analyser: AnalyserNode | null = null;
let animationFrameId: number | null = null;
/** The audio-clock time at which the next buffer should start playing. */
let nextStartTime = 0;
/** Active audio sources so we can stop them on demand. */
let activeSources: AudioBufferSourceNode[] = [];

// ASR state
let asrWebSocket: WebSocket | null = null;
let asrMediaStream: MediaStream | null = null;
let asrAudioContext: AudioContext | null = null;
let asrWorkletNode: AudioWorkletNode | null = null;
let asrStatus: Status = 'ready';
let asrIsRecording = false;

// ---------- DOM Elements ----------

// Feature tabs (TTS / ASR)
const featureTabs = document.querySelectorAll<HTMLButtonElement>('.feature-tab');
const ttsView = document.getElementById('tts-view') as HTMLElement;
const asrView = document.getElementById('asr-view') as HTMLElement;

// TTS Mode tabs
const modeTabs = document.querySelectorAll<HTMLButtonElement>('.mode-tab');
const wsPanel = document.getElementById('ws-panel') as HTMLDivElement;
const togetherPanel = document.getElementById('together-panel') as HTMLDivElement;

// WebSocket mode
const wsUrlInput = document.getElementById('ws-url') as HTMLInputElement;
const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
const languageInput = document.getElementById('language') as HTMLInputElement;

// Together API mode
const togetherModelSelect = document.getElementById('together-model-select') as HTMLSelectElement;
const togetherModelCustom = document.getElementById('together-model-custom') as HTMLInputElement;
const togetherVoiceSelect = document.getElementById('together-voice-select') as HTMLSelectElement;
const togetherVoiceCustom = document.getElementById('together-voice-custom') as HTMLInputElement;
const togetherApiKeyInput = document.getElementById('together-api-key') as HTMLInputElement;

// TTS shared
const textInput = document.getElementById('text-input') as HTMLTextAreaElement;
const speakBtn = document.getElementById('speak-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const statusIndicator = document.getElementById('status-indicator') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const ttfbBanner = document.getElementById('ttfb-banner') as HTMLDivElement;
const ttfbValue = document.getElementById('ttfb-value') as HTMLDivElement;
const logContainer = document.getElementById('log') as HTMLDivElement;
const clearLogBtn = document.getElementById('clear-log') as HTMLButtonElement;
const visualizerCanvas = document.getElementById('visualizer-canvas') as HTMLCanvasElement;

// ASR elements
const asrDeploymentIdInput = document.getElementById('asr-deployment-id') as HTMLInputElement;
const asrLanguageInput = document.getElementById('asr-language') as HTMLInputElement;
const asrApiKeyInput = document.getElementById('asr-api-key') as HTMLInputElement;
const asrStartBtn = document.getElementById('asr-start-btn') as HTMLButtonElement;
const asrStopBtn = document.getElementById('asr-stop-btn') as HTMLButtonElement;
const asrStatusIndicator = document.getElementById('asr-status-indicator') as HTMLDivElement;
const asrStatusText = document.getElementById('asr-status-text') as HTMLSpanElement;
const asrTranscript = document.getElementById('asr-transcript') as HTMLDivElement;
const asrLogContainer = document.getElementById('asr-log') as HTMLDivElement;
const asrClearLogBtn = document.getElementById('asr-clear-log') as HTMLButtonElement;

// ---------- Utilities ----------

function formatTime(): string {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
}

function log(message: string, type: 'info' | 'success' | 'error' | 'audio' = 'info'): void {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">${formatTime()}</span><span class="log-msg">${message}</span>`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function setStatus(status: Status, text?: string): void {
  currentStatus = status;
  statusIndicator.className = `status-indicator ${status}`;
  statusText.textContent = text || status.charAt(0).toUpperCase() + status.slice(1);
  
  speakBtn.disabled = status === 'connecting' || status === 'streaming';
  stopBtn.disabled = status === 'ready' || status === 'error';
}

// ---------- Feature switching (TTS / ASR) ----------

function switchFeature(feature: FeatureView): void {
  currentFeature = feature;

  featureTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.feature === feature);
  });

  ttsView.classList.toggle('hidden', feature !== 'tts');
  asrView.classList.toggle('hidden', feature !== 'asr');

  localStorage.setItem('feature_view', feature);
}

// ASR-specific log and status helpers
function asrLog(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">${formatTime()}</span><span class="log-msg">${message}</span>`;
  asrLogContainer.appendChild(entry);
  asrLogContainer.scrollTop = asrLogContainer.scrollHeight;
}

function setAsrStatus(status: Status, text?: string): void {
  asrStatus = status;
  asrStatusIndicator.className = `status-indicator ${status}`;
  asrStatusText.textContent = text || status.charAt(0).toUpperCase() + status.slice(1);

  asrStartBtn.disabled = status === 'connecting' || status === 'streaming';
  asrStopBtn.disabled = status === 'ready' || status === 'error';
}

// ---------- TTS Mode switching ----------

function switchMode(mode: AppMode): void {
  currentMode = mode;
  
  modeTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === mode);
  });
  
  wsPanel.classList.toggle('hidden', mode !== 'websocket');
  togetherPanel.classList.toggle('hidden', mode !== 'together');
  
  localStorage.setItem('tts_mode', mode);
}

function getVoicesForModel(model: string): string[] {
  // Exact match first
  if (MODEL_VOICES[model]) return MODEL_VOICES[model];
  // For custom models, try matching by prefix (e.g. "cartesia/my-custom" → cartesia voices)
  if (model.startsWith('cartesia/')) return CARTESIA_VOICES;
  if (model.startsWith('canopylabs/')) return MODEL_VOICES['canopylabs/orpheus-3b-0.1-ft'];
  if (model.startsWith('hexgrad/')) return MODEL_VOICES['hexgrad/Kokoro-82M'];
  return [];
}

function getDefaultVoiceForModel(model: string): string {
  if (MODEL_DEFAULT_VOICE[model]) return MODEL_DEFAULT_VOICE[model];
  if (model.startsWith('cartesia/')) return 'sweet lady';
  if (model.startsWith('canopylabs/')) return 'tara';
  if (model.startsWith('hexgrad/')) return 'af_heart';
  return '';
}

const CUSTOM_VALUE = '__custom__';

/** Returns the effective model string (from select or custom input). */
function getSelectedModel(): string {
  if (togetherModelSelect.value === CUSTOM_VALUE) {
    return togetherModelCustom.value.trim();
  }
  return togetherModelSelect.value;
}

function handleModelSelectChange(): void {
  if (togetherModelSelect.value === CUSTOM_VALUE) {
    togetherModelCustom.classList.remove('hidden');
    togetherModelCustom.focus();
  } else {
    togetherModelCustom.classList.add('hidden');
  }
  updateVoiceSuggestions();
  localStorage.setItem('together_model', getSelectedModel());
}

function updateVoiceSuggestions(): void {
  const model = getSelectedModel();
  const voices = getVoicesForModel(model);

  // Remember state before rebuilding
  const wasExplicitlyCustom = togetherVoiceSelect.value === CUSTOM_VALUE;
  const previousVoice = getSelectedVoice();

  // Rebuild the <select> options
  togetherVoiceSelect.innerHTML = '';

  voices.forEach(voice => {
    const opt = document.createElement('option');
    opt.value = voice;
    opt.textContent = voice;
    togetherVoiceSelect.appendChild(opt);
  });

  // Always add a "Custom…" option at the end
  const customOpt = document.createElement('option');
  customOpt.value = CUSTOM_VALUE;
  customOpt.textContent = '— Custom —';
  togetherVoiceSelect.appendChild(customOpt);

  // Restore voice selection
  if (previousVoice && voices.includes(previousVoice)) {
    // Previous voice exists in the new model — keep it
    togetherVoiceSelect.value = previousVoice;
    togetherVoiceCustom.classList.add('hidden');
  } else if (wasExplicitlyCustom && previousVoice) {
    // User explicitly chose "Custom" and typed a value — preserve it
    togetherVoiceSelect.value = CUSTOM_VALUE;
    togetherVoiceCustom.value = previousVoice;
    togetherVoiceCustom.classList.remove('hidden');
  } else {
    // Previous voice was a preset from another model — reset to new default
    const defaultVoice = getDefaultVoiceForModel(model) || voices[0] || '';
    togetherVoiceSelect.value = defaultVoice;
    togetherVoiceCustom.classList.add('hidden');
  }
}

function handleVoiceSelectChange(): void {
  if (togetherVoiceSelect.value === CUSTOM_VALUE) {
    togetherVoiceCustom.classList.remove('hidden');
    togetherVoiceCustom.focus();
  } else {
    togetherVoiceCustom.classList.add('hidden');
  }
  localStorage.setItem('together_voice', getSelectedVoice());
}

/** Returns the effective voice value (from select or custom input). */
function getSelectedVoice(): string {
  if (togetherVoiceSelect.value === CUSTOM_VALUE) {
    return togetherVoiceCustom.value.trim();
  }
  return togetherVoiceSelect.value;
}

// ---------- Audio handling ----------

async function initAudio(): Promise<void> {
  if (!audioContext) {
    audioContext = new AudioContext({ sampleRate: DEFAULT_SAMPLE_RATE });
    
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.connect(audioContext.destination);
  }
  
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
}

/**
 * Schedule an audio chunk for gapless playback using the Web Audio clock.
 *
 * Instead of starting each buffer at "now" and using setTimeout to pace them
 * (which causes gaps/overlaps → crackling), we track `nextStartTime` on the
 * high-precision audio clock and schedule each buffer to begin exactly where
 * the previous one ended.  This is the same principle the CLI uses via its
 * sounddevice callback — sample-accurate sequencing with no JS-timer jitter.
 */
function scheduleAudioChunk(audioData: Float32Array): void {
  if (!audioContext || !analyser) return;

  const buffer = audioContext.createBuffer(AUDIO_CHANNELS, audioData.length, DEFAULT_SAMPLE_RATE);
  buffer.getChannelData(0).set(audioData);

  const now = audioContext.currentTime;

  // If the scheduled time is in the past (first chunk, or an underrun gap),
  // reset to "now" with a tiny look-ahead so the browser has time to enqueue.
  if (nextStartTime < now) {
    nextStartTime = now + 0.02;          // 20 ms look-ahead
  }

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(analyser);
  source.start(nextStartTime);

  // Track so stopTTS() can cancel scheduled playback
  activeSources.push(source);
  source.onended = () => {
    const idx = activeSources.indexOf(source);
    if (idx !== -1) activeSources.splice(idx, 1);
  };

  nextStartTime += buffer.duration;      // seamlessly abut the next chunk
}

function processAudioQueue(): void {
  while (audioQueue.length > 0) {
    const chunk = audioQueue.shift()!;
    scheduleAudioChunk(chunk);
  }
}

function decodeBase64Audio(base64: string): Float32Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

// ---------- Visualizer ----------

function setupVisualizer(): void {
  const canvas = visualizerCanvas;
  const ctx = canvas.getContext('2d')!;
  
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  
  function draw(): void {
    animationFrameId = requestAnimationFrame(draw);
    
    const width = rect.width;
    const height = rect.height;
    
    ctx.fillStyle = '#18181B';
    ctx.fillRect(0, 0, width, height);
    
    if (!analyser) {
      drawIdleLine(ctx, width, height);
      return;
    }
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    
    const hasActivity = dataArray.some(v => v > 10);
    
    if (!hasActivity) {
      drawIdleLine(ctx, width, height);
      return;
    }
    
    const barWidth = width / bufferLength * 2.5;
    let x = 0;
    
    ctx.fillStyle = '#0066FF';
    
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * height * 0.8;
      const y = (height - barHeight) / 2;
      
      ctx.fillRect(x, y, barWidth - 1, barHeight);
      x += barWidth;
      
      if (x > width) break;
    }
  }
  
  function drawIdleLine(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.strokeStyle = '#27272A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
  }
  
  draw();
}

function stopVisualizer(): void {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// ---------- WebSocket handling ----------

function getBackendWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/tts`;
}

function handleMessage(data: TTSMessage, resolveConnect?: (value: void) => void): void {
  switch (data.type) {
    case 'ready':
      log('Backend ready', 'success');
      setStatus('connected', 'Connected');
      resolveConnect?.();
      break;
      
    case 'session.created':
      log(`TTS session created (language: ${data.language}, format: ${data.format})`, 'success');
      break;
      
    case 'ttfb': {
      const ttfbMs = data.ttfb_ms as number;
      log(`\u26A1 TTFB: ${ttfbMs.toFixed(0)}ms`, 'success');

      // Show the prominent TTFB banner
      ttfbValue.textContent = `${ttfbMs.toFixed(0)}ms`;
      ttfbValue.className = 'ttfb-value ' + (ttfbMs < 200 ? 'fast' : ttfbMs < 500 ? 'medium' : 'slow');
      ttfbBanner.classList.remove('hidden');
      ttfbBanner.classList.add('highlight');
      // Remove highlight border after a moment, keep the value visible
      setTimeout(() => ttfbBanner.classList.remove('highlight'), 2000);
      break;
    }
      
    case 'audio.chunk': {
      const audioB64 = data.audio as string;
      if (audioB64) {
        const audioData = decodeBase64Audio(audioB64);
        const duration = audioData.length / DEFAULT_SAMPLE_RATE;
        log(`Received ${duration.toFixed(2)}s of audio`, 'audio');
        
        audioQueue.push(audioData);
        processAudioQueue();
        
        setStatus('streaming', 'Playing audio...');
        
        if (data.isFinal) {
          log('Audio stream complete', 'success');
          setTimeout(() => {
            if (currentStatus === 'streaming') {
              setStatus('ready');
            }
          }, 1000);
        }
      } else if (data.isFinal) {
        log('Audio stream complete', 'success');
        setTimeout(() => {
          if (currentStatus === 'streaming') {
            setStatus('ready');
          }
        }, 1000);
      }
      break;
    }
      
    case 'error': {
      const errorMsg = data.message as string || 'Unknown error';
      log(`Error: ${errorMsg}`, 'error');
      setStatus('error', 'Error');
      break;
    }
      
    case 'timeout':
      log('Waiting for TTS worker...', 'info');
      break;
      
    default:
      log(`Unknown message type: ${data.type}`, 'info');
  }
}

async function connectAndSend(configPayload: Record<string, unknown>, text: string, language: string): Promise<void> {
  setStatus('connecting', 'Connecting to backend...');
  
  const modeLabel = configPayload.mode === 'together' ? 'Together API' : 'WebSocket';
  log(`Starting ${modeLabel} TTS session...`);
  
  return new Promise((resolve, reject) => {
    try {
      websocket = new WebSocket(getBackendWsUrl());
      
      websocket.onopen = () => {
        log('Connected to backend, sending config...', 'info');
        websocket!.send(JSON.stringify(configPayload));
      };
      
      websocket.onmessage = async (event) => {
        try {
          const data: TTSMessage = JSON.parse(event.data);
          
          if (data.type === 'ready') {
            handleMessage(data);
            
            // Send TTS commands
            log(`Opening TTS session (language: ${language})`);
            websocket!.send(JSON.stringify({ type: 'open', language }));
            
            log(`Sending text (${text.length} chars)`);
            websocket!.send(JSON.stringify({ type: 'text', text }));
            
            log('Sending end-of-stream');
            websocket!.send(JSON.stringify({ type: 'eos' }));
            
            setStatus('streaming', 'Waiting for audio...');
            resolve();
          } else {
            handleMessage(data);
          }
        } catch (e) {
          log(`Failed to parse message: ${e}`, 'error');
        }
      };
      
      websocket.onerror = (event) => {
        log('WebSocket error', 'error');
        console.error('WebSocket error:', event);
        setStatus('error', 'Connection error');
        reject(new Error('WebSocket error'));
      };
      
      websocket.onclose = (event) => {
        log(`Connection closed: ${event.reason || 'Unknown reason'}`, 'info');
        if (currentStatus !== 'error') {
          setStatus('ready');
        }
        websocket = null;
      };
      
    } catch (e) {
      log(`Failed to connect: ${e}`, 'error');
      setStatus('error', 'Failed to connect');
      reject(e);
    }
  });
}

// ---------- TTS entry points ----------

async function startTTS(): Promise<void> {
  const text = textInput.value.trim();
  
  if (!text) {
    log('Please enter text to synthesize', 'error');
    return;
  }
  
  await initAudio();
  audioQueue = [];
  activeSources = [];
  nextStartTime = 0;                    // reset scheduler for new utterance
  ttfbBanner.classList.add('hidden');    // hide stale TTFB from previous run
  
  if (currentMode === 'together') {
    await startTogetherTTS(text);
  } else {
    await startWebSocketTTS(text);
  }
}

async function startWebSocketTTS(text: string): Promise<void> {
  const wsUrl = wsUrlInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  const language = languageInput.value.trim() || 'en';
  
  if (!wsUrl) {
    log('Please enter a WebSocket URL', 'error');
    return;
  }
  
  const configPayload = {
    type: 'config',
    mode: 'websocket',
    ws_url: wsUrl,
    api_key: apiKey || undefined,
    language,
    sample_rate: DEFAULT_SAMPLE_RATE,
  };
  
  try {
    await connectAndSend(configPayload, text, language);
  } catch (e) {
    log(`Failed to start TTS: ${e}`, 'error');
  }
}

async function startTogetherTTS(text: string): Promise<void> {
  const model = getSelectedModel();
  const voice = getSelectedVoice();
  const apiKey = togetherApiKeyInput.value.trim();
  
  if (!apiKey) {
    log('Please enter your Together API key', 'error');
    return;
  }
  
  if (!voice) {
    log('Please enter a voice name', 'error');
    return;
  }
  
  log(`Model: ${model}, Voice: ${voice}`);
  
  const configPayload = {
    type: 'config',
    mode: 'together',
    model,
    voice,
    api_key: apiKey,
    sample_rate: DEFAULT_SAMPLE_RATE,
  };
  
  try {
    await connectAndSend(configPayload, text, 'en');
  } catch (e) {
    log(`Failed to start TTS: ${e}`, 'error');
  }
}

function stopTTS(): void {
  if (websocket) {
    websocket.close();
    websocket = null;
  }
  
  // Stop all scheduled audio sources immediately
  for (const src of activeSources) {
    try { src.stop(); } catch { /* already stopped */ }
  }
  activeSources = [];

  audioQueue = [];
  nextStartTime = 0;
  setStatus('ready');
  log('TTS stopped', 'info');
}

// ---------- ASR handling ----------

const ASR_SAMPLE_RATE = 24000;

function getAsrBackendWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/asr`;
}

function float32ToInt16Base64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function clearTranscript(): void {
  asrTranscript.innerHTML = '<div class="transcript-placeholder">Transcription will appear here...</div>';
}

let currentPartialDiv: HTMLDivElement | null = null;

function appendTranscriptDelta(delta: string): void {
  // Remove placeholder if present
  const placeholder = asrTranscript.querySelector('.transcript-placeholder');
  if (placeholder) placeholder.remove();

  if (!currentPartialDiv) {
    currentPartialDiv = document.createElement('div');
    currentPartialDiv.className = 'transcript-segment transcript-partial';
    asrTranscript.appendChild(currentPartialDiv);
  }
  currentPartialDiv.textContent += delta;
  asrTranscript.scrollTop = asrTranscript.scrollHeight;
}

function finalizeTranscriptSegment(transcript: string): void {
  const placeholder = asrTranscript.querySelector('.transcript-placeholder');
  if (placeholder) placeholder.remove();

  if (currentPartialDiv) {
    currentPartialDiv.className = 'transcript-segment transcript-final';
    currentPartialDiv.textContent = transcript || currentPartialDiv.textContent;
    currentPartialDiv = null;
  } else if (transcript) {
    const div = document.createElement('div');
    div.className = 'transcript-segment transcript-final';
    div.textContent = transcript;
    asrTranscript.appendChild(div);
  }
  asrTranscript.scrollTop = asrTranscript.scrollHeight;
}

async function startASR(): Promise<void> {
  const deploymentId = asrDeploymentIdInput.value.trim();
  const apiKey = asrApiKeyInput.value.trim();
  const language = asrLanguageInput.value.trim() || 'en';

  if (!deploymentId) {
    asrLog('Please enter a Deployment ID', 'error');
    return;
  }

  setAsrStatus('connecting', 'Connecting...');
  asrLog('Starting ASR session...');
  currentPartialDiv = null;

  try {
    // Request microphone access
    asrMediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: ASR_SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    asrLog('Microphone access granted', 'success');
  } catch (e) {
    asrLog(`Microphone access denied: ${e}`, 'error');
    setAsrStatus('error', 'Mic denied');
    return;
  }

  try {
    asrWebSocket = new WebSocket(getAsrBackendWsUrl());

    asrWebSocket.onopen = () => {
      asrLog('Connected to backend, sending config...');
      asrWebSocket!.send(JSON.stringify({
        type: 'config',
        deployment_id: deploymentId,
        api_key: apiKey,
        language,
      }));
    };

    asrWebSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const eventType = data.type || '';

        if (eventType === 'ready') {
          asrLog('ASR session ready — listening...', 'success');
          setAsrStatus('streaming', 'Listening...');
          asrIsRecording = true;
          asrStartBtn.classList.add('recording');
          startMicCapture().catch(e => {
            asrLog(`Mic capture failed: ${e}`, 'error');
            setAsrStatus('error', 'Mic error');
          });
        } else if (eventType === 'conversation.item.input_audio_transcription.delta') {
          const delta = data.delta || '';
          if (delta) {
            appendTranscriptDelta(delta);
          }
        } else if (eventType === 'conversation.item.input_audio_transcription.completed') {
          const transcript = data.transcript || '';
          finalizeTranscriptSegment(transcript);
          asrLog(`Segment: "${transcript.slice(0, 80)}${transcript.length > 80 ? '...' : ''}"`, 'success');
        } else if (eventType === 'error') {
          asrLog(`Error: ${data.message || 'Unknown error'}`, 'error');
          setAsrStatus('error', 'Error');
          stopASR();
        } else if (eventType === 'timeout') {
          asrLog('Waiting for ASR worker...');
        }
      } catch (e) {
        asrLog(`Failed to parse message: ${e}`, 'error');
      }
    };

    asrWebSocket.onerror = () => {
      asrLog('WebSocket error', 'error');
      setAsrStatus('error', 'Connection error');
    };

    asrWebSocket.onclose = (event) => {
      asrLog(`Connection closed: ${event.reason || 'Disconnected'}`);
      if (asrStatus !== 'error') {
        setAsrStatus('ready');
      }
      stopMicCapture();
      asrStartBtn.classList.remove('recording');
      asrIsRecording = false;
      asrWebSocket = null;
    };
  } catch (e) {
    asrLog(`Failed to connect: ${e}`, 'error');
    setAsrStatus('error', 'Failed to connect');
    stopMicCapture();
  }
}

const PCM_WORKLET_CODE = `
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      this.port.postMessage(input[0]);
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
`;

async function startMicCapture(): Promise<void> {
  if (!asrMediaStream) return;

  asrAudioContext = new AudioContext({ sampleRate: ASR_SAMPLE_RATE });

  const blob = new Blob([PCM_WORKLET_CODE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  await asrAudioContext.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const source = asrAudioContext.createMediaStreamSource(asrMediaStream);
  asrWorkletNode = new AudioWorkletNode(asrAudioContext, 'pcm-processor');

  asrWorkletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (!asrIsRecording || !asrWebSocket || asrWebSocket.readyState !== WebSocket.OPEN) return;
    const b64 = float32ToInt16Base64(e.data);
    asrWebSocket.send(JSON.stringify({ type: 'audio', audio: b64 }));
  };

  source.connect(asrWorkletNode);
  asrWorkletNode.connect(asrAudioContext.destination);
}

function stopMicCapture(): void {
  if (asrWorkletNode) {
    asrWorkletNode.disconnect();
    asrWorkletNode = null;
  }
  if (asrAudioContext) {
    asrAudioContext.close();
    asrAudioContext = null;
  }
  if (asrMediaStream) {
    asrMediaStream.getTracks().forEach(t => t.stop());
    asrMediaStream = null;
  }
}

function stopASR(): void {
  asrIsRecording = false;
  asrStartBtn.classList.remove('recording');

  if (asrWebSocket && asrWebSocket.readyState === WebSocket.OPEN) {
    asrWebSocket.send(JSON.stringify({ type: 'stop' }));
    asrWebSocket.close();
  }
  asrWebSocket = null;

  stopMicCapture();
  setAsrStatus('ready');
  asrLog('ASR stopped');
}

// ---------- Event handlers ----------

// Feature tabs (TTS / ASR)
featureTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    switchFeature(tab.dataset.feature as FeatureView);
  });
});

// TTS controls
speakBtn.addEventListener('click', startTTS);
stopBtn.addEventListener('click', stopTTS);

clearLogBtn.addEventListener('click', () => {
  logContainer.innerHTML = '';
});

// TTS Mode tabs
modeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    switchMode(tab.dataset.mode as AppMode);
  });
});

// ASR controls
asrStartBtn.addEventListener('click', startASR);
asrStopBtn.addEventListener('click', stopASR);
asrClearLogBtn.addEventListener('click', () => {
  asrLogContainer.innerHTML = '';
});

// Model select + custom input
togetherModelSelect.addEventListener('change', () => {
  handleModelSelectChange();
});
togetherModelCustom.addEventListener('input', () => {
  updateVoiceSuggestions();
  localStorage.setItem('together_model', getSelectedModel());
});

// Handle Enter key in text input (Cmd/Ctrl + Enter to speak)
textInput.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    if (!speakBtn.disabled) {
      startTTS();
    }
  }
});

// ---------- Initialization ----------

document.addEventListener('DOMContentLoaded', () => {
  setupVisualizer();
  setStatus('ready');
  log('Voice demo ready. Choose a mode and enter text to begin.', 'info');
  
  // Load saved values from localStorage
  const savedUrl = localStorage.getItem('tts_ws_url');
  const savedApiKey = localStorage.getItem('tts_api_key');
  const savedLanguage = localStorage.getItem('tts_language');
  const savedMode = localStorage.getItem('tts_mode') as AppMode | null;
  const savedModel = localStorage.getItem('together_model');
  const savedTogetherKey = localStorage.getItem('together_api_key');
  const savedVoice = localStorage.getItem('together_voice');
  
  if (savedUrl) wsUrlInput.value = savedUrl;
  if (savedApiKey) apiKeyInput.value = savedApiKey;
  if (savedLanguage) languageInput.value = savedLanguage;
  if (savedTogetherKey) togetherApiKeyInput.value = savedTogetherKey;

  // Restore saved model (may be a preset or custom)
  if (savedModel) {
    // Check if it matches a preset <option>
    const presetValues = Array.from(togetherModelSelect.options).map(o => o.value);
    if (presetValues.includes(savedModel)) {
      togetherModelSelect.value = savedModel;
      togetherModelCustom.classList.add('hidden');
    } else {
      togetherModelSelect.value = CUSTOM_VALUE;
      togetherModelCustom.value = savedModel;
      togetherModelCustom.classList.remove('hidden');
    }
  }
  
  // Populate voice options for the current model
  updateVoiceSuggestions();
  
  // Restore saved voice after populating options
  if (savedVoice) {
    const voices = getVoicesForModel(getSelectedModel());
    if (voices.includes(savedVoice)) {
      togetherVoiceSelect.value = savedVoice;
      togetherVoiceCustom.classList.add('hidden');
    } else {
      togetherVoiceSelect.value = CUSTOM_VALUE;
      togetherVoiceCustom.value = savedVoice;
      togetherVoiceCustom.classList.remove('hidden');
    }
  }
  
  // Restore TTS mode
  if (savedMode && (savedMode === 'websocket' || savedMode === 'together')) {
    switchMode(savedMode);
  }

  // Restore ASR values
  const savedDeploymentId = localStorage.getItem('asr_deployment_id');
  const savedAsrKey = localStorage.getItem('asr_api_key');
  const savedAsrLang = localStorage.getItem('asr_language');
  const savedFeature = localStorage.getItem('feature_view') as FeatureView | null;

  if (savedDeploymentId) asrDeploymentIdInput.value = savedDeploymentId;
  if (savedAsrKey) asrApiKeyInput.value = savedAsrKey;
  if (savedAsrLang) asrLanguageInput.value = savedAsrLang;

  // Restore feature view
  if (savedFeature && (savedFeature === 'tts' || savedFeature === 'asr')) {
    switchFeature(savedFeature);
  }
});

// Save values to localStorage on change
wsUrlInput.addEventListener('change', () => {
  localStorage.setItem('tts_ws_url', wsUrlInput.value);
});

apiKeyInput.addEventListener('change', () => {
  localStorage.setItem('tts_api_key', apiKeyInput.value);
});

languageInput.addEventListener('change', () => {
  localStorage.setItem('tts_language', languageInput.value);
});

togetherApiKeyInput.addEventListener('change', () => {
  localStorage.setItem('together_api_key', togetherApiKeyInput.value);
});

togetherVoiceSelect.addEventListener('change', () => {
  handleVoiceSelectChange();
});

togetherVoiceCustom.addEventListener('input', () => {
  localStorage.setItem('together_voice', togetherVoiceCustom.value);
});

// ASR localStorage persistence
asrDeploymentIdInput.addEventListener('change', () => {
  localStorage.setItem('asr_deployment_id', asrDeploymentIdInput.value);
});
asrApiKeyInput.addEventListener('change', () => {
  localStorage.setItem('asr_api_key', asrApiKeyInput.value);
});
asrLanguageInput.addEventListener('change', () => {
  localStorage.setItem('asr_language', asrLanguageInput.value);
});

// Handle window resize for visualizer
window.addEventListener('resize', () => {
  stopVisualizer();
  setupVisualizer();
});
