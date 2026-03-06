"""
Together AI Voice Demo - Backend Server

A FastAPI WebSocket proxy for testing TTS and ASR backends.
The backend acts as a bridge between the browser and various voice API servers,
handling protocol translation as needed. Supports Together REST API mode
for streaming TTS, and a WebSocket proxy for streaming ASR (speech-to-text).
"""

import array
import asyncio
import base64
import json
import logging
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Optional

import httpx
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Models that support streaming via Together API
STREAMING_MODELS = {
    "canopylabs/orpheus-3b-0.1-ft",
    "hexgrad/Kokoro-82M",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("🚀 Together AI Voice Demo backend starting...")
    yield
    logger.info("👋 Shutting down...")


app = FastAPI(
    title="Together AI Voice Demo",
    description="WebSocket proxy for TTS testing",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TTSConfig(BaseModel):
    """TTS connection configuration from client."""
    ws_url: str = ""
    api_key: Optional[str] = None
    language: str = "en"
    sample_rate: int = 24000
    # Together API mode fields
    mode: str = "websocket"  # "websocket" or "together"
    model: str = ""
    voice: str = ""


@dataclass
class SessionState:
    """Tracks the state of a TTS session."""
    config: TTSConfig
    upstream_ws: Optional[websockets.WebSocketClientProtocol] = None
    is_connected: bool = False


# ---------- Audio conversion helpers ----------

def int16_pcm_to_float32_b64(pcm_bytes: bytes) -> str:
    """Convert int16 PCM bytes to base64-encoded float32 PCM."""
    int16_arr = array.array('h')
    int16_arr.frombytes(pcm_bytes)
    float32_arr = array.array('f', (s / 32768.0 for s in int16_arr))
    return base64.b64encode(float32_arr.tobytes()).decode('ascii')


# ---------- Together REST API mode ----------

async def handle_together_mode(websocket: WebSocket, config_msg: dict):
    """Handle TTS via the Together REST API (streaming or non-streaming)."""
    model = config_msg.get("model", "")
    voice = config_msg.get("voice", "tara")
    api_key = config_msg.get("api_key", "")
    sample_rate = config_msg.get("sample_rate", 24000)

    if not model:
        await websocket.send_json({"type": "error", "message": "model is required"})
        return

    if not api_key:
        await websocket.send_json({"type": "error", "message": "API key is required for Together API mode"})
        return

    # Signal ready
    await websocket.send_json({"type": "ready"})
    logger.info(f"Together API mode: model={model}, voice={voice}")

    # Collect text messages until EOS
    text_parts: list[str] = []
    try:
        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type", "")

            if msg_type == "open":
                # Acknowledge the open with a synthetic session.created
                await websocket.send_json({
                    "type": "session.created",
                    "format": "float32",
                    "sample_rate": sample_rate,
                    "language": msg.get("language", "en"),
                })
            elif msg_type == "text":
                text_parts.append(msg.get("text", ""))
            elif msg_type == "eos":
                break
            # Ignore other message types
    except WebSocketDisconnect:
        return

    text = " ".join(text_parts)
    if not text:
        await websocket.send_json({"type": "error", "message": "No text provided"})
        return

    supports_streaming = model in STREAMING_MODELS

    url = "https://api.together.xyz/v1/audio/speech"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload: dict = {
        "model": model,
        "input": text,
        "voice": voice,
        "sample_rate": sample_rate,
    }

    # Always use raw PCM format — avoids WAV header parsing issues
    # (e.g. Cartesia returns IEEE float WAV which Python's wave module can't read)
    payload["response_format"] = "raw"
    payload["response_encoding"] = "pcm_s16le"

    if supports_streaming:
        payload["stream"] = True

    send_time = time.perf_counter()
    first_byte_time: Optional[float] = None

    try:
        timeout = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Together API error ({response.status_code}): "
                                   f"{body.decode('utf-8', errors='replace')[:500]}"
                    })
                    return

                buffer = b""
                min_bytes = 4800 * 2  # ~0.2s at 24 kHz, 16-bit

                async for chunk in response.aiter_bytes():
                    if first_byte_time is None:
                        first_byte_time = time.perf_counter()
                        ttfb_ms = (first_byte_time - send_time) * 1000
                        logger.info(f"⚡ Together API TTFB: {ttfb_ms:.0f}ms")
                        await websocket.send_json({
                            "type": "ttfb",
                            "ttfb_ms": round(ttfb_ms, 1),
                        })

                    buffer += chunk

                    while len(buffer) >= min_bytes:
                        process_bytes = buffer[:min_bytes]
                        buffer = buffer[min_bytes:]
                        audio_b64 = int16_pcm_to_float32_b64(process_bytes)
                        await websocket.send_json({
                            "type": "audio.chunk",
                            "audio": audio_b64,
                            "isFinal": False,
                        })

                # Flush remaining buffer
                if buffer and len(buffer) >= 2:
                    if len(buffer) % 2 != 0:
                        buffer = buffer[:-1]
                    audio_b64 = int16_pcm_to_float32_b64(buffer)
                    await websocket.send_json({
                        "type": "audio.chunk",
                        "audio": audio_b64,
                        "isFinal": True,
                    })
                else:
                    await websocket.send_json({
                        "type": "audio.chunk",
                        "audio": "",
                        "isFinal": True,
                    })

    except httpx.TimeoutException:
        await websocket.send_json({"type": "error", "message": "Together API request timed out"})
    except WebSocketDisconnect:
        logger.info("Client disconnected during Together API streaming")
    except Exception as e:
        logger.error(f"Together API error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": f"Together API error: {e}"})
        except Exception:
            pass


# ---------- WebSocket proxy mode (existing) ----------

async def forward_to_client(
    client_ws: WebSocket,
    upstream_ws: websockets.WebSocketClientProtocol,
    session: SessionState,
):
    """Forward messages from upstream TTS server to the browser client."""
    try:
        async for message in upstream_ws:
            try:
                data = json.loads(message)
                msg_type = data.get("type", "")
                
                # Log message types for debugging
                if msg_type == "session.created":
                    logger.info(f"✓ TTS session created: {data}")
                elif msg_type == "audio.chunk":
                    is_final = data.get("isFinal", False)
                    logger.debug(f"🔊 Audio chunk received (final={is_final})")
                elif msg_type == "error":
                    logger.error(f"❌ TTS error: {data}")
                
                # Forward to client as-is
                await client_ws.send_json(data)
                
                # Check for completion
                if msg_type == "audio.chunk" and data.get("isFinal"):
                    logger.info("✅ TTS stream complete")
                    
            except json.JSONDecodeError:
                # Forward raw message if not JSON
                await client_ws.send_text(message)
                
    except websockets.ConnectionClosed as e:
        logger.info(f"Upstream connection closed: {e}")
        await client_ws.send_json({
            "type": "error",
            "message": f"TTS server disconnected: {e.reason or 'Connection closed'}"
        })
    except Exception as e:
        logger.error(f"Forward error: {e}")
        await client_ws.send_json({
            "type": "error", 
            "message": str(e)
        })


async def forward_to_upstream(
    client_ws: WebSocket,
    upstream_ws: websockets.WebSocketClientProtocol,
    session: SessionState,
):
    """Forward messages from browser client to upstream TTS server."""
    try:
        while True:
            data = await client_ws.receive_json()
            msg_type = data.get("type", "")
            
            if msg_type == "open":
                # Client wants to start TTS session
                logger.info(f"📤 Opening TTS session: language={data.get('language')}")
                await upstream_ws.send(json.dumps(data))
                
            elif msg_type == "text":
                # Forward text to TTS
                text = data.get("text", "")
                logger.info(f"📝 Sending text ({len(text)} chars)")
                await upstream_ws.send(json.dumps(data))
                
            elif msg_type == "eos":
                # End of stream
                logger.info("📤 Sending EOS")
                await upstream_ws.send(json.dumps(data))
                
            else:
                # Forward unknown messages as-is
                await upstream_ws.send(json.dumps(data))
                
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"Forward to upstream error: {e}")


async def handle_websocket_mode(websocket: WebSocket, config_msg: dict):
    """Handle TTS via upstream WebSocket proxy (original behaviour)."""
    config = TTSConfig(
        ws_url=config_msg.get("ws_url", ""),
        api_key=config_msg.get("api_key"),
        language=config_msg.get("language", "en"),
        sample_rate=config_msg.get("sample_rate", 24000),
    )

    if not config.ws_url:
        await websocket.send_json({
            "type": "error",
            "message": "ws_url is required",
        })
        return

    session = SessionState(config=config)
    logger.info(f"📡 Connecting to TTS server: {config.ws_url}")

    headers = {}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"

    upstream_ws = None
    try:
        upstream_ws = await websockets.connect(
            config.ws_url,
            additional_headers=headers if headers else None,
        )
        session.upstream_ws = upstream_ws
        session.is_connected = True

        logger.info("✓ Connected to TTS server")
        await websocket.send_json({"type": "ready"})

        # Start bidirectional forwarding
        forward_task = asyncio.create_task(
            forward_to_client(websocket, upstream_ws, session)
        )

        try:
            await forward_to_upstream(websocket, upstream_ws, session)
        finally:
            forward_task.cancel()
            try:
                await forward_task
            except asyncio.CancelledError:
                pass

    except Exception as e:
        logger.error(f"Failed to connect to TTS server: {e}")
        await websocket.send_json({
            "type": "error",
            "message": f"Failed to connect to TTS server: {e}",
        })
    finally:
        if upstream_ws:
            await upstream_ws.close()


# ---------- Main WebSocket endpoint ----------

@app.websocket("/ws/tts")
async def websocket_tts_proxy(websocket: WebSocket):
    """
    WebSocket endpoint that proxies TTS requests.
    
    Protocol:
    1. Client connects and sends config:
       - WebSocket mode: {"type": "config", "mode": "websocket", "ws_url": "...", ...}
       - Together mode:  {"type": "config", "mode": "together", "model": "...", "voice": "...", "api_key": "...", ...}
    2. Server connects/confirms: {"type": "ready"}
    3. Client sends TTS commands (open, text, eos)
    4. Server streams audio chunks back
    """
    await websocket.accept()
    logger.info("🔌 Client connected")

    try:
        config_msg = await websocket.receive_json()

        if config_msg.get("type") != "config":
            await websocket.send_json({
                "type": "error",
                "message": "First message must be config",
            })
            return

        mode = config_msg.get("mode", "websocket")

        if mode == "together":
            await handle_together_mode(websocket, config_msg)
        else:
            await handle_websocket_mode(websocket, config_msg)

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        logger.info("🔌 Session ended")


# ---------- ASR WebSocket proxy ----------

TOGETHER_REALTIME_URL = "wss://api.together.ai/v1/deployment-request/{deployment_id}/v1/realtime"


async def asr_forward_to_client(client_ws: WebSocket, upstream_ws, language: str):
    """Forward transcription events from upstream ASR to browser."""
    try:
        async for message in upstream_ws:
            if not isinstance(message, str):
                continue
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                continue

            event_type = data.get("type", "")

            if event_type == "transcription_session.created":
                # Auto-configure the session on behalf of the browser
                session_update = {
                    "type": "transcription_session.update",
                    "session": {
                        "input_audio_format": "pcm16",
                        "input_audio_sample_rate": 24000,
                        "input_audio_number_of_channels": 1,
                        "input_audio_transcription": {
                            "language": language,
                            "target_language": language,
                        },
                    },
                }
                await upstream_ws.send(json.dumps(session_update))
                logger.info("📡 ASR session created, sending config...")

            elif event_type == "transcription_session.updated":
                logger.info("✓ ASR session configured")
                await client_ws.send_json({"type": "ready"})

            elif event_type in (
                "conversation.item.input_audio_transcription.delta",
                "conversation.item.input_audio_transcription.completed",
            ):
                await client_ws.send_json(data)

            elif event_type == "error":
                error = data.get("error", {})
                logger.error(f"❌ ASR error: {error}")
                await client_ws.send_json({
                    "type": "error",
                    "message": f"[{error.get('code', '?')}] {error.get('message', str(data))}",
                })

            elif event_type == "timeout":
                await client_ws.send_json({"type": "timeout"})

            # Silently ignore other event types (committed, conversation.item.created, etc.)

    except websockets.ConnectionClosed as e:
        logger.info(f"ASR upstream closed: {e}")
        try:
            await client_ws.send_json({
                "type": "error",
                "message": f"ASR server disconnected: {e.reason or 'Connection closed'}",
            })
        except Exception:
            pass
    except Exception as e:
        logger.error(f"ASR forward error: {e}")


async def asr_forward_to_upstream(client_ws: WebSocket, upstream_ws):
    """Forward audio chunks from browser to upstream ASR."""
    try:
        while True:
            data = await client_ws.receive_json()
            msg_type = data.get("type", "")

            if msg_type == "audio":
                # Repackage as the upstream protocol expects
                await upstream_ws.send(json.dumps({
                    "type": "input_audio_buffer.append",
                    "audio": data.get("audio", ""),
                }))

            elif msg_type == "commit":
                await upstream_ws.send(json.dumps({
                    "type": "input_audio_buffer.commit",
                }))

            elif msg_type == "stop":
                await upstream_ws.send(json.dumps({
                    "type": "input_audio_buffer.commit",
                }))
                break

    except WebSocketDisconnect:
        logger.info("ASR client disconnected")
    except Exception as e:
        logger.error(f"ASR forward to upstream error: {e}")


@app.websocket("/ws/asr")
async def websocket_asr_proxy(websocket: WebSocket):
    """
    WebSocket endpoint that proxies ASR requests.

    Protocol:
    1. Client sends config: {"type": "config", "deployment_id": "...", "api_key": "...", "language": "en"}
    2. Backend connects to upstream, configures session, sends {"type": "ready"}
    3. Client streams audio: {"type": "audio", "audio": "<base64 pcm16>"}
    4. Backend forwards transcription events back to client
    5. Client sends {"type": "stop"} to end
    """
    await websocket.accept()
    logger.info("🎙️ ASR client connected")

    upstream_ws = None
    try:
        config_msg = await websocket.receive_json()

        if config_msg.get("type") != "config":
            await websocket.send_json({
                "type": "error",
                "message": "First message must be config",
            })
            return

        deployment_id = config_msg.get("deployment_id", "")
        api_key = config_msg.get("api_key", "")
        language = config_msg.get("language", "en")

        if not deployment_id:
            await websocket.send_json({
                "type": "error",
                "message": "deployment_id is required",
            })
            return

        ws_url = TOGETHER_REALTIME_URL.format(deployment_id=deployment_id)
        logger.info(f"📡 Connecting to ASR: {ws_url}")

        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            upstream_ws = await websockets.connect(
                ws_url,
                additional_headers=headers if headers else None,
            )
            logger.info("✓ Connected to ASR server")
        except Exception as e:
            logger.error(f"Failed to connect to ASR server: {e}")
            await websocket.send_json({
                "type": "error",
                "message": f"Failed to connect to ASR server: {e}",
            })
            return

        # Bidirectional forwarding
        forward_task = asyncio.create_task(
            asr_forward_to_client(websocket, upstream_ws, language)
        )

        try:
            await asr_forward_to_upstream(websocket, upstream_ws)
        finally:
            forward_task.cancel()
            try:
                await forward_task
            except asyncio.CancelledError:
                pass

    except WebSocketDisconnect:
        logger.info("ASR client disconnected")
    except Exception as e:
        logger.error(f"ASR WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if upstream_ws:
            try:
                await upstream_ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
            except Exception:
                pass
            await upstream_ws.close()
        logger.info("🎙️ ASR session ended")


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "together-voice-demo"}


# Serve frontend static files in production
# Mount at the end so API routes take precedence
try:
    app.mount("/", StaticFiles(directory="../frontend/dist", html=True), name="frontend")
except Exception:
    # Frontend not built yet, that's okay for development
    pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8800)
