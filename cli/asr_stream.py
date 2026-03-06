#!/usr/bin/env python3
"""
Streaming Speech-to-Text client for Together AI ASR deployments.

Captures microphone audio and streams it to a Together AI ASR WebSocket
endpoint, printing live transcription results to the console.

Usage:
    # Using a deployment ID (connects to Together AI):
    python asr_stream.py --deployment-id your-deployment-id --api-key $TOGETHER_API_KEY

    # With a specific language:
    python asr_stream.py --deployment-id your-deployment-id --lang ja

    # Direct WebSocket URL (for local testing):
    python asr_stream.py --url ws://localhost:6380/v1/realtime

Environment variables:
    DEPLOYMENT_ID    - Default deployment ID
    TOGETHER_API_KEY - API key for authentication
    STT_LANGUAGE     - Language code (default: en)
"""

import argparse
import asyncio
import base64
import json
import os
import sys

import numpy as np
import sounddevice as sd
import websockets

SAMPLE_RATE = 24000
CHANNELS = 1
CHUNK_DURATION_MS = 80
CHUNK_SIZE = int(SAMPLE_RATE * CHUNK_DURATION_MS / 1000)  # 1920 samples


class StreamingSTTClient:
    def __init__(self):
        self.audio_queue: asyncio.Queue = asyncio.Queue()
        self.running = True
        self.loop = None
        self.session_ready = asyncio.Event()

    def audio_callback(self, indata, frames, time_info, status):
        if status:
            print(f"Audio status: {status}", file=sys.stderr)
        if self.running and self.loop:
            audio_int16 = (indata * 32767).astype(np.int16)
            self.loop.call_soon_threadsafe(
                self.audio_queue.put_nowait, audio_int16.tobytes()
            )

    async def send_audio(self, ws):
        await self.session_ready.wait()
        chunks_sent = 0
        try:
            while self.running:
                try:
                    audio_bytes = await asyncio.wait_for(
                        self.audio_queue.get(), timeout=0.1
                    )
                    event = {
                        "type": "input_audio_buffer.append",
                        "audio": base64.b64encode(audio_bytes).decode("ascii"),
                    }
                    await ws.send(json.dumps(event))
                    chunks_sent += 1
                    if chunks_sent == 1:
                        print("  (audio streaming to server)", file=sys.stderr)
                except asyncio.TimeoutError:
                    continue
        except websockets.ConnectionClosed:
            pass
        except Exception as e:
            print(f"Send error: {e}", file=sys.stderr)

    async def receive_transcriptions(self, ws):
        current_text = ""
        spinner = "|/-\\"
        spin_idx = 0
        try:
            async for message in ws:
                if not isinstance(message, str):
                    continue
                try:
                    data = json.loads(message)
                except json.JSONDecodeError:
                    continue

                event_type = data.get("type", "")

                if event_type == "transcription_session.created":
                    session_update = {
                        "type": "transcription_session.update",
                        "session": {
                            "input_audio_format": "pcm16",
                            "input_audio_sample_rate": SAMPLE_RATE,
                            "input_audio_number_of_channels": CHANNELS,
                            "input_audio_transcription": {
                                "language": self.language,
                                "target_language": self.language,
                            },
                        },
                    }
                    await ws.send(json.dumps(session_update))

                elif event_type == "transcription_session.updated":
                    print("  Ready — listening...\n")
                    self.session_ready.set()

                elif event_type == "conversation.item.created":
                    pass

                elif event_type == "conversation.item.input_audio_transcription.delta":
                    delta_text = data.get("delta", "")
                    if delta_text:
                        current_text += delta_text
                        display = current_text[-78:] if len(current_text) > 78 else current_text
                        print(f"\r  {display:<78}", end="", flush=True)
                    else:
                        c = spinner[spin_idx % len(spinner)]
                        spin_idx += 1
                        if current_text:
                            display = current_text[-78:] if len(current_text) > 78 else current_text
                            print(f"\r  {display} {c}", end="", flush=True)
                        else:
                            print(f"\r  {c} listening...", end="", flush=True)

                elif event_type == "conversation.item.input_audio_transcription.completed":
                    transcript = data.get("transcript", current_text)
                    if transcript:
                        print(f"\r  >> {transcript:<78}")
                    current_text = ""

                elif event_type == "input_audio_buffer.committed":
                    pass

                elif event_type == "error":
                    error = data.get("error", {})
                    print(
                        f"\n  Server error [{error.get('code', '?')}]: "
                        f"{error.get('message', data)}",
                        file=sys.stderr,
                    )

                elif event_type == "timeout":
                    print("  Waiting for worker...")

                else:
                    print(f"\n  [debug] {json.dumps(data, ensure_ascii=False)}")

        except websockets.ConnectionClosed as e:
            print(f"\nConnection closed: {e}")
        except Exception as e:
            print(f"\nReceive error: {e}", file=sys.stderr)

    async def run(self, ws_url: str, language: str):
        self.loop = asyncio.get_running_loop()
        self.language = language

        print("=== Streaming Speech-to-Text ===")
        print(f"Connecting to: {ws_url}")
        print(f"Language: {language}")
        print(f"Audio: {SAMPLE_RATE}Hz, {CHANNELS}ch, int16 PCM")
        print("Speak into your microphone. Press Ctrl+C to stop.\n")

        headers = {}
        api_key = os.environ.get("TOGETHER_API_KEY", "")
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        try:
            async with websockets.connect(
                ws_url,
                additional_headers=headers if headers else None,
            ) as ws:
                with sd.InputStream(
                    samplerate=SAMPLE_RATE,
                    channels=CHANNELS,
                    callback=self.audio_callback,
                    blocksize=CHUNK_SIZE,
                    dtype=np.float32,
                ):
                    print("  Recording... (Ctrl+C to stop)\n")

                    send_task = asyncio.create_task(self.send_audio(ws))
                    receive_task = asyncio.create_task(
                        self.receive_transcriptions(ws)
                    )

                    try:
                        await asyncio.gather(send_task, receive_task)
                    except asyncio.CancelledError:
                        pass
                    finally:
                        self.running = False
                        try:
                            await ws.send(
                                json.dumps({"type": "input_audio_buffer.commit"})
                            )
                        except Exception:
                            pass

        except websockets.exceptions.InvalidStatus as e:
            print(f"Connection failed: HTTP {e.response.status_code}", file=sys.stderr)
            body = e.response.body
            if body:
                print(f"  {body.decode('utf-8', errors='replace')}", file=sys.stderr)
        except ConnectionRefusedError:
            print(f"Could not connect to {ws_url}", file=sys.stderr)
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(
        description="Stream microphone audio to a Together AI ASR deployment",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--deployment-id", "-d",
        default=os.environ.get("DEPLOYMENT_ID", ""),
        help="Together AI deployment ID (or set DEPLOYMENT_ID env var)",
    )
    parser.add_argument(
        "--url", "-u",
        default="",
        help="Direct WebSocket URL (overrides --deployment-id)",
    )
    parser.add_argument(
        "--api-key", "-k",
        default=os.environ.get("TOGETHER_API_KEY", ""),
        help="API key (or set TOGETHER_API_KEY)",
    )
    parser.add_argument(
        "--lang", "-l",
        default=os.environ.get("STT_LANGUAGE", "en"),
        help="Language code (default: en)",
    )

    args = parser.parse_args()

    if args.api_key:
        os.environ["TOGETHER_API_KEY"] = args.api_key

    if args.url:
        ws_url = args.url
    elif args.deployment_id:
        ws_url = (
            f"wss://api.together.ai/v1/deployment-request/"
            f"{args.deployment_id}/v1/realtime"
        )
    else:
        parser.error(
            "Provide either --deployment-id or --url. "
            "You can also set DEPLOYMENT_ID env var."
        )

    client = StreamingSTTClient()
    try:
        asyncio.run(client.run(ws_url, args.lang))
    except KeyboardInterrupt:
        print("\n\n--- Stopped ---")


if __name__ == "__main__":
    main()
