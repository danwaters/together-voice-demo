#!/usr/bin/env python3
"""
Simple TTS streaming client with TTFB logging.

Supports two modes:

  WebSocket mode (original):
    python tts_stream.py "Hello world" --url wss://your-server/v1/tts/ws
    
    # With API key
    python tts_stream.py "Hello world" --url wss://api.together.ai/v1/deployment-request/xxx/v1/tts/ws --api-key $TOGETHER_API_KEY
    
    # Japanese
    python tts_stream.py "こんにちは" --url wss://... --lang ja

  Together API mode:
    python tts_stream.py "Hello world" --model canopylabs/orpheus-3b-0.1-ft --voice tara --api-key $TOGETHER_API_KEY
    python tts_stream.py "Hello world" --model hexgrad/Kokoro-82M --voice af_heart --api-key $TOGETHER_API_KEY
    python tts_stream.py "Hello world" --model cartesia/sonic-2 --voice "sweet lady" --api-key $TOGETHER_API_KEY
    python tts_stream.py "Hello world" --model cartesia/sonic-3 --voice "german conversational woman" --api-key $TOGETHER_API_KEY

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

# Audio settings
SAMPLE_RATE = 24000
CHANNELS = 1

# Models that support streaming via Together API
STREAMING_MODELS = {
    "canopylabs/orpheus-3b-0.1-ft",
    "hexgrad/Kokoro-82M",
}

# Default voices per model family
DEFAULT_VOICES = {
    "canopylabs/orpheus-3b-0.1-ft": "tara",
    "hexgrad/Kokoro-82M": "af_heart",
}
CARTESIA_DEFAULT_VOICE = "sweet lady"


def _make_audio_callback(audio_queue: deque):
    """Create a sounddevice output callback that drains audio_queue."""
    def audio_callback(outdata, frames, time_info, status):
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
    return audio_callback


# ---------- WebSocket mode ----------

async def stream_tts_ws(text: str, ws_url: str, api_key: str | None, language: str):
    """Stream TTS audio over a WebSocket and log TTFB."""
    import websockets

    print(f"Connecting to: {ws_url}")
    print(f"Language: {language}")
    print(f"Text: {text[:50]}{'...' if len(text) > 50 else ''}")
    print()

    headers = {"Authorization": f"Bearer {api_key}"} if api_key else None
    audio_queue: deque = deque()

    send_time: float = 0
    first_byte_time: float | None = None
    total_audio_duration: float = 0

    try:
        async with websockets.connect(ws_url, additional_headers=headers) as ws:
            stream = sd.OutputStream(
                samplerate=SAMPLE_RATE,
                channels=CHANNELS,
                callback=_make_audio_callback(audio_queue),
                blocksize=2048,
                dtype=np.float32,
            )
            stream.start()

            await ws.send(json.dumps({"type": "open", "language": language}))
            await ws.send(json.dumps({"type": "text", "text": text}))
            await ws.send(json.dumps({"type": "eos"}))
            send_time = time.perf_counter()
            print("Request sent, waiting for audio...")

            async for msg in ws:
                data = json.loads(msg)
                msg_type = data.get("type", "")

                if msg_type == "session.created":
                    print(f"Session: {data.get('format')} @ {data.get('sample_rate')}Hz")

                elif msg_type == "audio.chunk":
                    audio_b64 = data.get("audio", "")
                    if audio_b64:
                        if first_byte_time is None:
                            first_byte_time = time.perf_counter()
                            ttfb_ms = (first_byte_time - send_time) * 1000
                            print(f"\n⚡ TTFB: {ttfb_ms:.0f}ms\n")

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

            while audio_queue:
                await asyncio.sleep(0.1)
            await asyncio.sleep(0.3)

            stream.stop()
            print("Done.")

    except Exception as e:
        if "InvalidStatusCode" in type(e).__name__:
            print(f"Connection failed: {e}")
        elif isinstance(e, ConnectionRefusedError):
            print(f"Could not connect to {ws_url}")
        else:
            raise
    except KeyboardInterrupt:
        print("\nStopped.")


# ---------- Together REST API mode ----------

async def stream_tts_together(text: str, model: str, voice: str, api_key: str):
    """Stream TTS audio via the Together REST API and log TTFB."""
    import httpx

    print(f"Model: {model}")
    print(f"Voice: {voice}")
    print(f"Text: {text[:50]}{'...' if len(text) > 50 else ''}")
    print()

    audio_queue: deque = deque()
    total_audio_duration: float = 0

    supports_streaming = model in STREAMING_MODELS

    url = "https://api.together.xyz/v1/audio/speech"
    req_headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload: dict = {
        "model": model,
        "input": text,
        "voice": voice,
        "sample_rate": SAMPLE_RATE,
    }

    # Always use raw PCM format — avoids WAV header parsing issues
    # (e.g. Cartesia returns IEEE float WAV which Python's wave module can't read)
    payload["response_format"] = "raw"
    payload["response_encoding"] = "pcm_s16le"

    if supports_streaming:
        payload["stream"] = True

    try:
        stream = sd.OutputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            callback=_make_audio_callback(audio_queue),
            blocksize=2048,
            dtype=np.float32,
        )
        stream.start()

        timeout = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            send_time = time.perf_counter()
            print("Request sent, waiting for audio...")

            first_byte_time: float | None = None
            buffer = b""

            async with client.stream("POST", url, json=payload, headers=req_headers) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    print(f"❌ API error ({response.status_code}): {body.decode('utf-8', errors='replace')}")
                    stream.stop()
                    return

                async for chunk in response.aiter_bytes():
                    if first_byte_time is None:
                        first_byte_time = time.perf_counter()
                        ttfb_ms = (first_byte_time - send_time) * 1000
                        print(f"\n⚡ TTFB: {ttfb_ms:.0f}ms\n")

                    buffer += chunk
                    # Process complete int16 samples (2 bytes each)
                    n_complete = (len(buffer) // 2) * 2
                    if n_complete == 0:
                        continue

                    process_bytes = buffer[:n_complete]
                    buffer = buffer[n_complete:]

                    audio_int16 = np.frombuffer(process_bytes, dtype=np.int16)
                    audio_float32 = audio_int16.astype(np.float32) / 32768.0
                    audio_queue.append(audio_float32)

                    chunk_duration = len(audio_float32) / SAMPLE_RATE
                    total_audio_duration += chunk_duration
                    print(f"🔊 +{chunk_duration:.2f}s ({total_audio_duration:.2f}s total)", end="\r")

            print(f"\n✓ Complete: {total_audio_duration:.2f}s total audio")

            # Wait for playback to finish
            while audio_queue:
                await asyncio.sleep(0.1)
            await asyncio.sleep(0.3)

        stream.stop()
        print("Done.")

    except httpx.TimeoutException:
        print("❌ Request timed out")
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception as e:
        print(f"❌ Error: {e}")


# ---------- CLI entry point ----------

def main():
    parser = argparse.ArgumentParser(
        description="Stream TTS audio to speaker with TTFB logging",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("text", help="Text to synthesize")

    # WebSocket mode
    parser.add_argument("--url", "-u",
                        default=os.environ.get("TTS_WS_URL", ""),
                        help="WebSocket URL (or set TTS_WS_URL). Use for WebSocket mode.")

    # Together API mode
    parser.add_argument("--model", "-m",
                        default="",
                        help="Together AI model name (e.g. canopylabs/orpheus-3b-0.1-ft). "
                             "Use for Together API mode.")
    parser.add_argument("--voice", "-v",
                        default="",
                        help="Voice name for Together API mode (default depends on model)")

    # Shared
    parser.add_argument("--api-key", "-k",
                        default=os.environ.get("TOGETHER_API_KEY", ""),
                        help="API key (or set TOGETHER_API_KEY)")
    parser.add_argument("--lang", "-l", default="en",
                        help="Language code for WebSocket mode (default: en)")

    args = parser.parse_args()

    if args.model:
        # Together API mode
        if not args.api_key:
            parser.error("API key required for Together API mode: --api-key or TOGETHER_API_KEY env var")

        voice = args.voice
        if not voice:
            if args.model in DEFAULT_VOICES:
                voice = DEFAULT_VOICES[args.model]
            elif args.model.startswith("cartesia/"):
                voice = CARTESIA_DEFAULT_VOICE
            else:
                voice = "tara"

        asyncio.run(stream_tts_together(args.text, args.model, voice, args.api_key))

    elif args.url:
        # WebSocket mode
        asyncio.run(stream_tts_ws(args.text, args.url, args.api_key or None, args.lang))

    else:
        parser.error("Provide either --url (WebSocket mode) or --model (Together API mode)")


if __name__ == "__main__":
    main()
