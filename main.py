import os
import io
import base64
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import speech_recognition as sr
from deep_translator import GoogleTranslator
from google.transliteration import transliterate_text
from gtts import gTTS

app = FastAPI()

# Create dynamic languages dictionary
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

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
async def get_index():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()

@app.get("/api/languages")
async def get_languages():
    return {
        "names": language_names,
        "codes": language_codes
    }

@app.post("/api/process-audio")
async def process_audio(
    audio: UploadFile = File(...),
    input_lang: str = Form("en"),
    output_lang: str = Form("en")
):
    try:
        # Read uploaded audio into memory
        audio_content = await audio.read()
        audio_file = io.BytesIO(audio_content)

        r = sr.Recognizer()
        with sr.AudioFile(audio_file) as source:
            audio_data = r.record(source)

        try:
            # We enforce language to help recognition if not 'auto'
            speech_text = r.recognize_google(audio_data, language=input_lang if input_lang != 'auto' else 'en-US')
        except sr.UnknownValueError:
            return {"status": "error", "message": "Could not recognize audio"}
        except sr.RequestError:
            return {"status": "error", "message": "Google STT service is unavailable"}

        # Transliteration logic matching original main.py
        speech_text_transliteration = speech_text
        if input_lang not in ('auto', 'en', 'en-US'):
            try:
                speech_text_transliteration = transliterate_text(speech_text, lang_code=input_lang)
            except Exception as e:
                # Fallback if transliteration fails
                pass 

        # Translation
        translated_text = GoogleTranslator(source=input_lang, target=output_lang).translate(text=speech_text_transliteration)

        # TTS
        tts = gTTS(translated_text, lang=output_lang)
        tts_fp = io.BytesIO()
        tts.write_to_fp(tts_fp)
        tts_fp.seek(0)
        audio_base64 = base64.b64encode(tts_fp.read()).decode("utf-8")

        return {
            "status": "success",
            "recognized_text": speech_text_transliteration,
            "translated_text": translated_text,
            "audio_base64": f"data:audio/mp3;base64,{audio_base64}"
        }

    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
