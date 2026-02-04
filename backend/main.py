"""
Together AI Voice Demo - Backend Server

A FastAPI WebSocket proxy for testing TTS backends.
The backend acts as a bridge between the browser and various TTS WebSocket servers,
handling protocol translation as needed.
"""

import asyncio
import base64
import json
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Optional

import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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
    ws_url: str
    api_key: Optional[str] = None
    language: str = "en"
    sample_rate: int = 24000


@dataclass
class SessionState:
    """Tracks the state of a TTS session."""
    config: TTSConfig
    upstream_ws: Optional[websockets.WebSocketClientProtocol] = None
    is_connected: bool = False


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


@app.websocket("/ws/tts")
async def websocket_tts_proxy(websocket: WebSocket):
    """
    WebSocket endpoint that proxies TTS requests.
    
    Protocol:
    1. Client connects and sends config: {"type": "config", "ws_url": "...", "api_key": "...", "language": "..."}
    2. Server connects to upstream TTS and confirms: {"type": "ready"}
    3. Client sends TTS commands which are forwarded to upstream
    4. Server forwards audio chunks back to client
    """
    await websocket.accept()
    logger.info("🔌 Client connected")
    
    session: Optional[SessionState] = None
    upstream_ws = None
    
    try:
        # Wait for config message
        config_msg = await websocket.receive_json()
        
        if config_msg.get("type") != "config":
            await websocket.send_json({
                "type": "error",
                "message": "First message must be config"
            })
            return
        
        # Parse config
        config = TTSConfig(
            ws_url=config_msg.get("ws_url", ""),
            api_key=config_msg.get("api_key"),
            language=config_msg.get("language", "en"),
            sample_rate=config_msg.get("sample_rate", 24000),
        )
        
        if not config.ws_url:
            await websocket.send_json({
                "type": "error",
                "message": "ws_url is required"
            })
            return
        
        session = SessionState(config=config)
        logger.info(f"📡 Connecting to TTS server: {config.ws_url}")
        
        # Build headers for upstream connection
        headers = {}
        if config.api_key:
            headers["Authorization"] = f"Bearer {config.api_key}"
        
        # Connect to upstream TTS server
        try:
            upstream_ws = await websockets.connect(
                config.ws_url,
                additional_headers=headers if headers else None,
            )
            session.upstream_ws = upstream_ws
            session.is_connected = True
            
            logger.info("✓ Connected to TTS server")
            await websocket.send_json({"type": "ready"})
            
        except Exception as e:
            logger.error(f"Failed to connect to TTS server: {e}")
            await websocket.send_json({
                "type": "error",
                "message": f"Failed to connect to TTS server: {e}"
            })
            return
        
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
                
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except:
            pass
    finally:
        if upstream_ws:
            await upstream_ws.close()
        logger.info("🔌 Session ended")


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
    uvicorn.run(app, host="0.0.0.0", port=8000)
