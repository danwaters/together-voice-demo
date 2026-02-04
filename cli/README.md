# CLI Tools

Simple command-line scripts for testing TTS backends.

## tts_stream.py

Streams TTS audio to your Mac speakers and logs time-to-first-byte (TTFB).

### Setup

```bash
cd cli
pip install -r requirements.txt
```

### Usage

```bash
# Basic
python tts_stream.py "Hello world" --url wss://your-server/v1/tts/ws

# With Together API
python tts_stream.py "Hello world" \
  --url wss://api.together.ai/v1/deployment-request/your-deployment/v1/tts/ws \
  --api-key $TOGETHER_API_KEY

# Japanese
python tts_stream.py "こんにちは" --url wss://... --lang ja
```

### Environment Variables

You can set these instead of passing flags:

```bash
export TTS_WS_URL="wss://..."
export TOGETHER_API_KEY="your-key"
python tts_stream.py "Hello world"
```

### Output

```
Connecting to: wss://api.together.ai/v1/deployment-request/xxx/v1/tts/ws
Language: en
Text: Hello world

Request sent, waiting for audio...
Session: float32 @ 24000Hz

⚡ TTFB: 142ms

🔊 +0.48s
✓ Complete: 1.23s total audio
Done.
```
