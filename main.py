# import os
# import io
# import base64
# from fastapi import FastAPI, UploadFile, File, Form, HTTPException
# from fastapi.staticfiles import StaticFiles
# from fastapi.responses import HTMLResponse
# import speech_recognition as sr
# from deep_translator import GoogleTranslator
# from google.transliteration import transliterate_text
# from gtts import gTTS

# app = FastAPI()

# # Create dynamic languages dictionary
# language_codes = {
#     "English": "en",
#     "Hindi": "hi",
#     "Bengali": "bn",
#     "Spanish": "es",
#     "Chinese (Simplified)": "zh-CN",
#     "Russian": "ru",
#     "Japanese": "ja",
#     "Korean": "ko",
#     "German": "de",
#     "French": "fr",
#     "Tamil": "ta",
#     "Telugu": "te",
#     "Kannada": "kn",
#     "Gujarati": "gu",
#     "Punjabi": "pa"
# }
# language_names = list(language_codes.keys())

# # Mount static files
# app.mount("/static", StaticFiles(directory="static"), name="static")

# @app.get("/", response_class=HTMLResponse)
# async def get_index():
#     with open("static/index.html", "r", encoding="utf-8") as f:
#         return f.read()

# @app.get("/api/languages")
# async def get_languages():
#     return {
#         "names": language_names,
#         "codes": language_codes
#     }

# @app.post("/api/process-audio")
# async def process_audio(
#     audio: UploadFile = File(...),
#     input_lang: str = Form("en"),
#     output_lang: str = Form("en")
# ):
#     try:
#         # Read uploaded audio into memory
#         audio_content = await audio.read()
#         audio_file = io.BytesIO(audio_content)

#         r = sr.Recognizer()
#         with sr.AudioFile(audio_file) as source:
#             audio_data = r.record(source)

#         try:
#             # We enforce language to help recognition if not 'auto'
#             speech_text = r.recognize_google(audio_data, language=input_lang if input_lang != 'auto' else 'en-US')
#         except sr.UnknownValueError:
#             return {"status": "error", "message": "Could not recognize audio"}
#         except sr.RequestError:
#             return {"status": "error", "message": "Google STT service is unavailable"}

#         # Transliteration logic matching original main.py
#         speech_text_transliteration = speech_text
#         if input_lang not in ('auto', 'en', 'en-US'):
#             try:
#                 speech_text_transliteration = transliterate_text(speech_text, lang_code=input_lang)
#             except Exception as e:
#                 # Fallback if transliteration fails
#                 pass 

#         # Translation
#         translated_text = GoogleTranslator(source=input_lang, target=output_lang).translate(text=speech_text_transliteration)

#         # TTS
#         tts = gTTS(translated_text, lang=output_lang)
#         tts_fp = io.BytesIO()
#         tts.write_to_fp(tts_fp)
#         tts_fp.seek(0)
#         audio_base64 = base64.b64encode(tts_fp.read()).decode("utf-8")

#         return {
#             "status": "success",
#             "recognized_text": speech_text_transliteration,
#             "translated_text": translated_text,
#             "audio_base64": f"data:audio/mp3;base64,{audio_base64}"
#         }

#     except Exception as e:
#         return {"status": "error", "message": str(e)}

# if __name__ == "__main__":
#     import uvicorn
#     uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)



























































import os
import io
import base64
import json
import struct
import asyncio
from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import speech_recognition as sr
from deep_translator import GoogleTranslator
from google.transliteration import transliterate_text
from gtts import gTTS

app = FastAPI()

language_codes = {
    "English": "en",
    "Hindi": "hi",
    "Bengali": "bn",
    "Spanish": "es",
    "Chinese (Simplified)": "zh-CN",
    "Russian": "ru",
    "Japanese": "ja",
    "Korean": "ko",
    "German": "de",
    "French": "fr",
    "Tamil": "ta",
    "Telugu": "te",
    "Kannada": "kn",
    "Gujarati": "gu",
    "Punjabi": "pa"
}
language_names = list(language_codes.keys())

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def get_index():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()


@app.get("/api/languages")
async def get_languages():
    return {"names": language_names, "codes": language_codes}


# ─── Helpers ────────────────────────────────────────────────────────────────

def pcm_to_wav(pcm_bytes: bytes, sample_rate: int = 16000) -> io.BytesIO:
    """Wrap raw 16-bit mono PCM bytes in a WAV container."""
    buf = io.BytesIO()
    data_size = len(pcm_bytes)
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))          # chunk size
    buf.write(struct.pack("<H", 1))           # PCM
    buf.write(struct.pack("<H", 1))           # mono
    buf.write(struct.pack("<I", sample_rate))
    buf.write(struct.pack("<I", sample_rate * 2))  # byte rate
    buf.write(struct.pack("<H", 2))           # block align
    buf.write(struct.pack("<H", 16))          # bits per sample
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(pcm_bytes)
    buf.seek(0)
    return buf


def _run_stt_translate_tts(wav_buffer: io.BytesIO,
                             input_lang: str,
                             output_lang: str) -> dict | None:
    """
    Blocking function: STT → transliteration → translation → TTS.
    Returns a result dict on success, None when nothing was heard.
    """
    r = sr.Recognizer()
    try:
        with sr.AudioFile(wav_buffer) as source:
            audio_data = r.record(source)
        recognize_lang = input_lang if input_lang != "auto" else "en-US"
        speech_text = r.recognize_google(audio_data, language=recognize_lang)
    except sr.UnknownValueError:
        return None          # silence / unrecognisable
    except sr.RequestError:
        return {"status": "error", "message": "STT service unavailable"}

    # Transliteration (non-English only)
    transliterated = speech_text
    if input_lang not in ("auto", "en", "en-US"):
        try:
            transliterated = transliterate_text(speech_text, lang_code=input_lang)
        except Exception:
            pass

    # Translation
    src = input_lang if input_lang != "auto" else "auto"
    translated = GoogleTranslator(source=src, target=output_lang).translate(
        text=transliterated
    )

    # Text-to-speech
    tts = gTTS(translated, lang=output_lang)
    tts_fp = io.BytesIO()
    tts.write_to_fp(tts_fp)
    tts_fp.seek(0)
    audio_b64 = base64.b64encode(tts_fp.read()).decode("utf-8")

    return {
        "status": "success",
        "recognized_text": transliterated,
        "translated_text": translated,
        "audio_base64": f"data:audio/mp3;base64,{audio_b64}",
    }


# ─── WebSocket: continuous streaming translation ────────────────────────────
# Protocol:
#   Client → text  {"type":"config", "input_lang":"...", "output_lang":"..."}
#   Client → text  {"type":"flush"}   (force-process remainder before stop)
#   Client → bytes  raw Int16 PCM frames (16 kHz, mono)
#   Server → text  {"status":"success", "recognized_text":"...",
#                   "translated_text":"...", "audio_base64":"data:audio/mp3;..."}
#
# Server auto-flushes every CHUNK_BYTES (≈ 2 s) and on timeout.

CHUNK_BYTES   = 64_000   # 2 s × 16 000 samples × 2 bytes
OVERLAP_BYTES = 8_000    # 0.25 s overlap carried forward
MIN_BYTES     = 8_000    # ignore chunks shorter than ~0.25 s

@app.websocket("/ws/translate")
async def websocket_translate(websocket: WebSocket):
    await websocket.accept()

    input_lang  = "en"
    output_lang = "en"
    pcm_buf     = bytearray()
    loop        = asyncio.get_event_loop()

    async def flush(buf: bytes) -> None:
        """Process a PCM buffer and push result to the client."""
        if len(buf) < MIN_BYTES:
            return
        wav = pcm_to_wav(buf)
        result = await loop.run_in_executor(
            None, _run_stt_translate_tts, wav, input_lang, output_lang
        )
        if result and result.get("status") == "success":
            await websocket.send_text(json.dumps(result))

    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive(), timeout=3.0)

                if data.get("type") == "websocket.disconnect":
                    break

                if "text" in data:
                    msg = json.loads(data["text"])
                    if msg.get("type") == "config":
                        input_lang  = msg.get("input_lang",  "en")
                        output_lang = msg.get("output_lang", "en")
                        await websocket.send_text(json.dumps({"type": "config_ack"}))

                    elif msg.get("type") == "flush":
                        # Client signals it is about to stop; drain buffer
                        await flush(bytes(pcm_buf))
                        pcm_buf = bytearray()

                elif "bytes" in data:
                    pcm_buf.extend(data["bytes"])

                    # Auto-flush when we have enough for a 2-second window
                    while len(pcm_buf) >= CHUNK_BYTES:
                        chunk = bytes(pcm_buf[:CHUNK_BYTES])
                        # Keep a short overlap so words on the boundary are not cut
                        pcm_buf = bytearray(pcm_buf[CHUNK_BYTES - OVERLAP_BYTES:])
                        asyncio.ensure_future(flush(chunk))

            except asyncio.TimeoutError:
                # No new audio for 3 s — drain whatever remains
                if len(pcm_buf) >= MIN_BYTES:
                    await flush(bytes(pcm_buf))
                    pcm_buf = bytearray()

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await websocket.send_text(
                json.dumps({"status": "error", "message": str(exc)})
            )
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ─── REST fallback (kept for compatibility) ─────────────────────────────────

@app.post("/api/process-audio")
async def process_audio(
    audio: UploadFile = File(...),
    input_lang: str = Form("en"),
    output_lang: str = Form("en"),
):
    try:
        content = await audio.read()
        wav_buf = io.BytesIO(content)
        result  = _run_stt_translate_tts(wav_buf, input_lang, output_lang)
        if result is None:
            return {"status": "error", "message": "Could not recognise audio"}
        return result
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)