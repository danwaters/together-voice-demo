/**
 * Together AI Voice Demo - Frontend Client
 * 
 * Connects to the backend WebSocket proxy, which forwards requests
 * to the configured TTS server and streams audio back.
 */

import './style.css';

// Types
interface TTSConfig {
  ws_url: string;
  api_key?: string;
  language: string;
  sample_rate: number;
}

interface TTSMessage {
  type: string;
  [key: string]: unknown;
}

type Status = 'ready' | 'connecting' | 'connected' | 'streaming' | 'error';

// Audio settings
const DEFAULT_SAMPLE_RATE = 24000;
const AUDIO_CHANNELS = 1;

// State
let websocket: WebSocket | null = null;
let audioContext: AudioContext | null = null;
let audioQueue: Float32Array[] = [];
let isPlaying = false;
let currentStatus: Status = 'ready';
let analyser: AnalyserNode | null = null;
let animationFrameId: number | null = null;

// DOM Elements
const wsUrlInput = document.getElementById('ws-url') as HTMLInputElement;
const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
const languageInput = document.getElementById('language') as HTMLInputElement;
const textInput = document.getElementById('text-input') as HTMLTextAreaElement;
const speakBtn = document.getElementById('speak-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const statusIndicator = document.getElementById('status-indicator') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const logContainer = document.getElementById('log') as HTMLDivElement;
const clearLogBtn = document.getElementById('clear-log') as HTMLButtonElement;
const visualizerCanvas = document.getElementById('visualizer-canvas') as HTMLCanvasElement;

// Utilities
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
  
  // Update button states
  speakBtn.disabled = status === 'connecting' || status === 'streaming';
  stopBtn.disabled = status === 'ready' || status === 'error';
}

// Audio handling
async function initAudio(): Promise<void> {
  if (!audioContext) {
    audioContext = new AudioContext({ sampleRate: DEFAULT_SAMPLE_RATE });
    
    // Create analyser for visualization
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.connect(audioContext.destination);
  }
  
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
}

function playAudioChunk(audioData: Float32Array): void {
  if (!audioContext || !analyser) return;
  
  // Create audio buffer
  const buffer = audioContext.createBuffer(AUDIO_CHANNELS, audioData.length, DEFAULT_SAMPLE_RATE);
  buffer.getChannelData(0).set(audioData);
  
  // Create source and connect to analyser
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(analyser);
  source.start();
}

async function processAudioQueue(): Promise<void> {
  if (isPlaying) return;
  isPlaying = true;
  
  while (audioQueue.length > 0) {
    const chunk = audioQueue.shift()!;
    playAudioChunk(chunk);
    
    // Wait for chunk duration before playing next
    const duration = (chunk.length / DEFAULT_SAMPLE_RATE) * 1000;
    await new Promise(resolve => setTimeout(resolve, duration * 0.9)); // Slight overlap for smooth playback
  }
  
  isPlaying = false;
}

function decodeBase64Audio(base64: string): Float32Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

// Visualizer
function setupVisualizer(): void {
  const canvas = visualizerCanvas;
  const ctx = canvas.getContext('2d')!;
  
  // Set canvas size
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  
  function draw(): void {
    animationFrameId = requestAnimationFrame(draw);
    
    const width = rect.width;
    const height = rect.height;
    
    // Clear canvas
    ctx.fillStyle = '#18181B';
    ctx.fillRect(0, 0, width, height);
    
    if (!analyser) {
      drawIdleLine(ctx, width, height);
      return;
    }
    
    // Get frequency data
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    
    // Check if there's audio activity
    const hasActivity = dataArray.some(v => v > 10);
    
    if (!hasActivity) {
      drawIdleLine(ctx, width, height);
      return;
    }
    
    // Draw frequency bars
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

// WebSocket handling
function getBackendWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/tts`;
}

async function connect(config: TTSConfig): Promise<void> {
  setStatus('connecting', 'Connecting to backend...');
  log(`Connecting to TTS server: ${config.ws_url}`);
  
  return new Promise((resolve, reject) => {
    try {
      websocket = new WebSocket(getBackendWsUrl());
      
      websocket.onopen = () => {
        log('Connected to backend, sending config...', 'info');
        
        // Send config to backend
        websocket!.send(JSON.stringify({
          type: 'config',
          ws_url: config.ws_url,
          api_key: config.api_key || undefined,
          language: config.language,
          sample_rate: config.sample_rate,
        }));
      };
      
      websocket.onmessage = async (event) => {
        try {
          const data: TTSMessage = JSON.parse(event.data);
          handleMessage(data, resolve);
        } catch (e) {
          log(`Failed to parse message: ${e}`, 'error');
        }
      };
      
      websocket.onerror = (event) => {
        log(`WebSocket error`, 'error');
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

function handleMessage(data: TTSMessage, resolveConnect?: (value: void) => void): void {
  switch (data.type) {
    case 'ready':
      log('Backend connected to TTS server', 'success');
      setStatus('connected', 'Connected');
      resolveConnect?.();
      break;
      
    case 'session.created':
      log(`TTS session created (language: ${data.language}, format: ${data.format})`, 'success');
      break;
      
    case 'audio.chunk':
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
      }
      break;
      
    case 'error':
      const errorMsg = data.message as string || 'Unknown error';
      log(`Error: ${errorMsg}`, 'error');
      setStatus('error', 'Error');
      break;
      
    case 'timeout':
      log('Waiting for TTS worker...', 'info');
      break;
      
    default:
      log(`Unknown message type: ${data.type}`, 'info');
  }
}

async function startTTS(): Promise<void> {
  const wsUrl = wsUrlInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  const language = languageInput.value.trim() || 'en';
  const text = textInput.value.trim();
  
  if (!wsUrl) {
    log('Please enter a WebSocket URL', 'error');
    return;
  }
  
  if (!text) {
    log('Please enter text to synthesize', 'error');
    return;
  }
  
  // Initialize audio
  await initAudio();
  
  // Clear audio queue
  audioQueue = [];
  
  // Connect to backend
  const config: TTSConfig = {
    ws_url: wsUrl,
    api_key: apiKey || undefined,
    language,
    sample_rate: DEFAULT_SAMPLE_RATE,
  };
  
  try {
    await connect(config);
    
    // Send TTS commands
    log(`Opening TTS session (language: ${language})`);
    websocket!.send(JSON.stringify({ type: 'open', language }));
    
    log(`Sending text (${text.length} chars)`);
    websocket!.send(JSON.stringify({ type: 'text', text }));
    
    log('Sending end-of-stream');
    websocket!.send(JSON.stringify({ type: 'eos' }));
    
    setStatus('streaming', 'Waiting for audio...');
    
  } catch (e) {
    log(`Failed to start TTS: ${e}`, 'error');
  }
}

function stopTTS(): void {
  if (websocket) {
    websocket.close();
    websocket = null;
  }
  
  audioQueue = [];
  isPlaying = false;
  setStatus('ready');
  log('TTS stopped', 'info');
}

// Event handlers
speakBtn.addEventListener('click', startTTS);
stopBtn.addEventListener('click', stopTTS);

clearLogBtn.addEventListener('click', () => {
  logContainer.innerHTML = '';
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupVisualizer();
  setStatus('ready');
  log('Voice demo ready. Enter a WebSocket URL and text to begin.', 'info');
  
  // Load saved values from localStorage
  const savedUrl = localStorage.getItem('tts_ws_url');
  const savedApiKey = localStorage.getItem('tts_api_key');
  const savedLanguage = localStorage.getItem('tts_language');
  
  if (savedUrl) wsUrlInput.value = savedUrl;
  if (savedApiKey) apiKeyInput.value = savedApiKey;
  if (savedLanguage) languageInput.value = savedLanguage;
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

// Handle window resize for visualizer
window.addEventListener('resize', () => {
  stopVisualizer();
  setupVisualizer();
});
