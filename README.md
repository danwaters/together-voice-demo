# Together AI Voice Demo

A clean, Together AI-branded web application for testing WebSocket-based text-to-speech backends.

![Voice Demo Screenshot](docs/screenshot.png)

## Overview

This demo provides a simple interface to connect to any WebSocket TTS server and stream synthesized audio back to the browser. It's designed for:

- **Solution Architects** testing TTS deployments
- **Developers** evaluating voice AI capabilities  
- **Customers** exploring Together AI voice features

## Architecture

```
┌─────────────────┐     WebSocket      ┌─────────────────┐     WebSocket     ┌─────────────────┐
│                 │  ◄──────────────►  │                 │  ◄─────────────►  │                 │
│  Browser (UI)   │                    │  Python Backend │                   │   TTS Server    │
│                 │   Audio Chunks     │    (Proxy)      │    TTS Protocol   │                 │
└─────────────────┘                    └─────────────────┘                   └─────────────────┘
```

The backend acts as a WebSocket proxy, allowing the browser to connect to TTS servers that may require different protocols or authentication schemes.

## Quick Start (Cursor)

### Prerequisites

- Python 3.10+
- Node.js 18+
- [uv](https://github.com/astral-sh/uv) (recommended for Python)

### 1. Start the Backend

Open a terminal in Cursor (`Ctrl+`` ` or `Cmd+`` `) and run:

```bash
cd backend
uv venv && source .venv/bin/activate
uv pip install -e .
uvicorn main:app --reload --port 8000
```

You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     🚀 Together AI Voice Demo backend starting...
```

### 2. Start the Frontend

Open a **second terminal** in Cursor (`Cmd+Shift+`` ` or click the `+` in the terminal panel):

```bash
cd frontend
npm install
npm run dev
```

You should see:
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
```

### 3. Open the Demo

`Cmd+Click` the `http://localhost:5173/` link in the terminal, or open it in your browser.

## Usage

1. **WebSocket URL**: Enter the full WebSocket URL of your TTS server
   - Together deployment: `wss://api.together.ai/v1/deployment-request/{deployment-id}/v1/tts/ws`
   - Local server: `ws://localhost:6380/v1/tts/ws`

2. **API Key** (optional): Your Together API key for authenticated endpoints

3. **Language**: Language code for TTS (e.g., `en` for English, `ja` for Japanese)

4. **Text**: Enter the text you want to synthesize

5. Click **Speak** to stream audio!

> **Tip**: Press `Cmd+Enter` (or `Ctrl+Enter`) in the text area to speak without clicking the button.

## WebSocket Protocol

The demo uses a simple JSON message protocol compatible with Together AI TTS deployments:

### Client → Server

```json
{"type": "open", "language": "en"}     // Start session
{"type": "text", "text": "Hello!"}     // Send text  
{"type": "eos"}                         // End of stream
```

### Server → Client

```json
{"type": "session.created", "language": "en", "format": "float32", "sample_rate": 24000}
{"type": "audio.chunk", "audio": "<base64>", "isFinal": false}
{"type": "audio.chunk", "audio": "<base64>", "isFinal": true}
{"type": "error", "message": "Error description"}
```

Audio is base64-encoded float32 PCM at 24kHz mono.

## Development

### Backend (`backend/`)

FastAPI application that proxies WebSocket connections. Edit `main.py` to support different TTS server protocols.

```bash
cd backend
uvicorn main:app --reload --port 8000
```

### Frontend (`frontend/`)

Vanilla TypeScript + Vite. Clean UI with real-time audio visualization.

```bash
cd frontend
npm run dev      # Development with hot reload
npm run build    # Production build → dist/
```

## Project Structure

```
cx-voice-demos/
├── backend/
│   ├── main.py           # FastAPI WebSocket proxy
│   └── pyproject.toml    # Python dependencies
├── frontend/
│   ├── index.html        # Main HTML
│   ├── src/
│   │   ├── main.ts       # WebSocket client & audio
│   │   └── style.css     # Together AI branded styles
│   ├── package.json
│   └── vite.config.ts
├── docs/
│   └── screenshot.png    # Demo screenshot
└── README.md
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `unsupported_language` error | Use ISO 639-1 codes: `en`, `ja`, `es`, etc. (not `jp`) |
| No audio plays | Check browser console; ensure AudioContext is allowed |
| Connection refused | Verify backend is running on port 8000 |
| CORS errors | Use the backend proxy; don't connect directly from browser |

## License

Internal Together AI project. Contact the CX team for usage questions.
