#!/usr/bin/env python3
"""
Simple TTS streaming client with TTFB logging.

Usage:
    python tts_stream.py "Hello world" --url wss://your-server/v1/tts/ws
    
    # With API key
    python tts_stream.py "Hello world" --url wss://api.together.ai/v1/deployment-request/xxx/v1/tts/ws --api-key $TOGETHER_API_KEY
    
    # Japanese
    python tts_stream.py "こんにちは" --url wss://... --lang ja

Environment variables:
    TTS_WS_URL      - Default WebSocket URL
    TOGETHER_API_KEY - API key for authentication
"""

import argparse
import asyncio
import base64
import json
import os
import time
from collections import deque

import numpy as np
import sounddevice as sd
import websockets

# Audio settings
SAMPLE_RATE = 24000
CHANNELS = 1


async def stream_tts(text: str, ws_url: str, api_key: str | None, language: str):
    """Stream TTS audio to speaker and log TTFB."""
    
    print(f"Connecting to: {ws_url}")
    print(f"Language: {language}")
    print(f"Text: {text[:50]}{'...' if len(text) > 50 else ''}")
    print()
    
    # Auth headers
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else None
    
    # Audio queue and playback state
    audio_queue: deque = deque()
    stream_done = asyncio.Event()
    
    # Timing
    send_time: float = 0
    first_byte_time: float | None = None
    total_audio_duration: float = 0
    
    def audio_callback(outdata, frames, time_info, status):
        """Fill audio output buffer from queue."""
        output = np.zeros(frames, dtype=np.float32)
        offset = 0
        
        while offset < frames and audio_queue:
            chunk = audio_queue[0]
            to_copy = min(len(chunk), frames - offset)
            output[offset:offset + to_copy] = chunk[:to_copy]
            offset += to_copy
            
            if to_copy < len(chunk):
                audio_queue[0] = chunk[to_copy:]
            else:
                audio_queue.popleft()
        
        outdata[:] = output.reshape(-1, 1)
    
    try:
        async with websockets.connect(ws_url, additional_headers=headers) as ws:
            # Start audio output
            stream = sd.OutputStream(
                samplerate=SAMPLE_RATE,
                channels=CHANNELS,
                callback=audio_callback,
                blocksize=2048,
                dtype=np.float32,
            )
            stream.start()
            
            # Send TTS request
            await ws.send(json.dumps({"type": "open", "language": language}))
            await ws.send(json.dumps({"type": "text", "text": text}))
            await ws.send(json.dumps({"type": "eos"}))
            send_time = time.perf_counter()
            print("Request sent, waiting for audio...")
            
            # Receive audio
            async for msg in ws:
                data = json.loads(msg)
                msg_type = data.get("type", "")
                
                if msg_type == "session.created":
                    print(f"Session: {data.get('format')} @ {data.get('sample_rate')}Hz")
                
                elif msg_type == "audio.chunk":
                    audio_b64 = data.get("audio", "")
                    if audio_b64:
                        # Log TTFB on first chunk
                        if first_byte_time is None:
                            first_byte_time = time.perf_counter()
                            ttfb_ms = (first_byte_time - send_time) * 1000
                            print(f"\n⚡ TTFB: {ttfb_ms:.0f}ms\n")
                        
                        # Decode and queue audio
                        audio_bytes = base64.b64decode(audio_b64)
                        audio_chunk = np.frombuffer(audio_bytes, dtype=np.float32)
                        audio_queue.append(audio_chunk)
                        
                        chunk_duration = len(audio_chunk) / SAMPLE_RATE
                        total_audio_duration += chunk_duration
                        print(f"🔊 +{chunk_duration:.2f}s", end="\r")
                        
                        if data.get("isFinal"):
                            print(f"\n✓ Complete: {total_audio_duration:.2f}s total audio")
                            break
                
                elif msg_type == "error":
                    print(f"❌ Error: {data.get('message')}")
                    break
            
            # Wait for playback to finish
            while audio_queue:
                await asyncio.sleep(0.1)
            await asyncio.sleep(0.3)
            
            stream.stop()
            print("Done.")
            
    except websockets.exceptions.InvalidStatusCode as e:
        print(f"Connection failed: {e}")
    except ConnectionRefusedError:
        print(f"Could not connect to {ws_url}")
    except KeyboardInterrupt:
        print("\nStopped.")


def main():
    parser = argparse.ArgumentParser(
        description="Stream TTS audio to speaker with TTFB logging",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("text", help="Text to synthesize")
    parser.add_argument("--url", "-u", 
                        default=os.environ.get("TTS_WS_URL", ""),
                        help="WebSocket URL (or set TTS_WS_URL)")
    parser.add_argument("--api-key", "-k",
                        default=os.environ.get("TOGETHER_API_KEY", ""),
                        help="API key (or set TOGETHER_API_KEY)")
    parser.add_argument("--lang", "-l", default="en",
                        help="Language code (default: en)")
    
    args = parser.parse_args()
    
    if not args.url:
        parser.error("WebSocket URL required: --url or TTS_WS_URL env var")
    
    asyncio.run(stream_tts(args.text, args.url, args.api_key or None, args.lang))


if __name__ == "__main__":
    main()
