# CLI Tools

Command-line scripts for testing Together AI voice backends — text-to-speech (TTS) and speech-to-text (ASR).

## Setup

```bash
cd cli
pip install -r requirements.txt
```

Set your API key once to avoid passing it every time:

```bash
export TOGETHER_API_KEY="your-key-here"
```

---

## tts_stream.py

Streams TTS audio to your speakers and logs time-to-first-byte (TTFB). Supports both the Together REST API and direct WebSocket connections.

### Together API mode

Provide a `--model` and `--voice` to use the Together AI REST API:

```bash
# Orpheus 3B (streaming)
python tts_stream.py "Hello from Orpheus!" \
  --model canopylabs/orpheus-3b-0.1-ft \
  --voice tara

# Kokoro 82M (streaming)
python tts_stream.py "Hello from Kokoro!" \
  --model hexgrad/Kokoro-82M \
  --voice af_heart

# Cartesia Sonic 3
python tts_stream.py "Hello from Cartesia!" \
  --model cartesia/sonic-3 \
  --voice "sweet lady"

# Cartesia Sonic 2
python tts_stream.py "Hello from Sonic 2!" \
  --model cartesia/sonic-2 \
  --voice "california girl"
```

### WebSocket mode

Provide a `--url` to connect to a TTS WebSocket deployment directly:

```bash
# Together deployment
python tts_stream.py "Hello world" \
  --url wss://api.together.ai/v1/deployment-request/your-deployment/v1/tts/ws \
  --api-key $TOGETHER_API_KEY

# Local server
python tts_stream.py "Hello world" --url ws://localhost:6380/v1/tts/ws

# Japanese
python tts_stream.py "こんにちは" --url wss://... --lang ja
```

### TTS flags

| Flag | Description |
|------|-------------|
| `text` (positional) | Text to synthesize |
| `--model`, `-m` | Together AI model ID (e.g. `canopylabs/orpheus-3b-0.1-ft`) |
| `--voice`, `-v` | Voice name (auto-defaults per model if omitted) |
| `--api-key`, `-k` | Together API key (or `TOGETHER_API_KEY` env var) |
| `--url`, `-u` | WebSocket URL — use instead of `--model` |
| `--lang`, `-l` | Language code for WebSocket mode (default: `en`) |

### Example output

```
Model: canopylabs/orpheus-3b-0.1-ft
Voice: tara
Text: Hello from Orpheus!

Request sent, waiting for audio...

⚡ TTFB: 142ms

🔊 +0.48s (1.23s total)
✓ Complete: 2.56s total audio
Done.
```

---

## asr_stream.py

Streams live microphone audio to a Together AI ASR deployment and prints transcription to the terminal in real time.

### Usage

You'll need a **Deployment ID** for your ASR model.

```bash
# Basic — deployment ID + API key
python asr_stream.py \
  --deployment-id your-deployment-id

# Specify a language
python asr_stream.py \
  --deployment-id your-deployment-id \
  --lang ja

# Direct WebSocket URL (local testing)
python asr_stream.py --url ws://localhost:6380/v1/realtime
```

You can also use environment variables:

```bash
export DEPLOYMENT_ID="your-deployment-id"
export TOGETHER_API_KEY="your-key-here"
python asr_stream.py
```

### ASR flags

| Flag | Description |
|------|-------------|
| `--deployment-id`, `-d` | Together AI deployment ID (or `DEPLOYMENT_ID` env var) |
| `--api-key`, `-k` | Together API key (or `TOGETHER_API_KEY` env var) |
| `--lang`, `-l` | Language code (default: `en`) |
| `--url`, `-u` | Direct WebSocket URL — overrides `--deployment-id` |

### Example output

```
=== Streaming Speech-to-Text ===
Connecting to: wss://api.together.ai/v1/deployment-request/.../v1/realtime
Language: en
Audio: 24000Hz, 1ch, int16 PCM
Speak into your microphone. Press Ctrl+C to stop.

  Recording... (Ctrl+C to stop)

  Ready — listening...

  >> Hello, this is a test of the speech to text system.
  >> It transcribes in real time as you speak.

--- Stopped ---
```

Partial transcriptions appear inline as you speak; finalized segments are printed with `>>` on a new line. Press `Ctrl+C` to stop.
