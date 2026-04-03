// document.addEventListener('DOMContentLoaded', async () => {
//     const inputLang = document.getElementById('inputLang');
//     const outputLang = document.getElementById('outputLang');
//     const recordBtn = document.getElementById('recordBtn');
//     const statusText = document.getElementById('statusText');
//     const recognizedText = document.getElementById('recognizedText');
//     const translatedText = document.getElementById('translatedText');

//     let isRecording = false;
//     let audioContext = null;
//     let mediaStream = null;
//     let processor = null;
//     let pcmData = [];

//     // VAD Variables
//     const SILENCE_THRESHOLD = 0.02; 
//     const SILENCE_MS = 1200; // 1.2s
//     let speaking = false;
//     let silenceTimer = null;

//     // Playback Queue Variables
//     let audioQueue = [];
//     let isPlaying = false;

//     // Fetch languages
//     try {
//         const response = await fetch('/api/languages');
//         const data = await response.json();

//         const autoOption = document.createElement('option');
//         autoOption.value = 'auto';
//         autoOption.textContent = 'Auto Detect';
//         inputLang.appendChild(autoOption);

//         data.names.forEach(name => {
//             const code = data.codes[name];

//             const opt1 = document.createElement('option');
//             opt1.value = code;
//             opt1.textContent = name;
//             inputLang.appendChild(opt1);

//             const opt2 = document.createElement('option');
//             opt2.value = code;
//             opt2.textContent = name;
//             outputLang.appendChild(opt2);
//         });

//         inputLang.value = 'auto';
//         outputLang.value = 'en'; 
//     } catch (e) {
//         console.error("Error fetching languages:", e);
//     }

//     recordBtn.addEventListener('click', async () => {
//         if (!isRecording) {
//             await startContinuousRecording();
//         } else {
//             stopContinuousRecording();
//         }
//     });

//     async function startContinuousRecording() {
//         try {
//             // Echo cancellation keeps the mic from hearing our own TTS!
//             mediaStream = await navigator.mediaDevices.getUserMedia({ 
//                 audio: { echoCancellation: true, noiseSuppression: true } 
//             });
//             audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
//             const source = audioContext.createMediaStreamSource(mediaStream);

//             processor = audioContext.createScriptProcessor(4096, 1, 1);
//             pcmData = [];
//             speaking = false;
//             silenceTimer = null;

//             processor.onaudioprocess = (e) => {
//                 const channelData = e.inputBuffer.getChannelData(0);
//                 const float32Array = new Float32Array(channelData);

//                 let maxVol = 0;
//                 for(let i=0; i<float32Array.length; i++){
//                     if(Math.abs(float32Array[i]) > maxVol) maxVol = Math.abs(float32Array[i]);
//                 }

//                 if (maxVol > SILENCE_THRESHOLD) {
//                     if (!speaking) {
//                         speaking = true;
//                         statusText.textContent = "Listening... (Speaking detected)";
//                     }
//                     if (silenceTimer) {
//                         clearTimeout(silenceTimer);
//                         silenceTimer = null;
//                     }
//                 } else {
//                     if (speaking && !silenceTimer) {
//                         // Wait for 1.2s before flush
//                         silenceTimer = setTimeout(() => {
//                             speaking = false;
//                             silenceTimer = null;
//                             statusText.textContent = "Processing... (Listening in background)";
//                             flushAudioChunk();
//                         }, SILENCE_MS);
//                     }
//                 }

//                 pcmData.push(float32Array);

//                 if (!speaking && pcmData.length > (16000/4096) * 3) {
//                     pcmData.shift(); 
//                 }
//             };

//             source.connect(processor);
//             processor.connect(audioContext.destination);

//             isRecording = true;
//             recordBtn.classList.add('recording');
//             statusText.textContent = "Listening continuously... Click to stop.";

//             // Clear placeholders
//             recognizedText.innerHTML = '';
//             translatedText.innerHTML = '';

//         } catch (err) {
//             console.error("Error accessing microphone", err);
//             statusText.textContent = "Microphone access denied.";
//         }
//     }

//     function stopContinuousRecording() {
//         if (!isRecording) return;

//         // Final flush if anything is left
//         if (speaking) flushAudioChunk();

//         processor.disconnect();
//         mediaStream.getTracks().forEach(track => track.stop());
//         if(audioContext.state !== 'closed') audioContext.close();

//         isRecording = false;
//         recordBtn.classList.remove('recording');
//         statusText.textContent = "Stopped. Ready to record.";
//     }

//     function flushAudioChunk() {
//         if (pcmData.length === 0) return;

//         // Deep copy out data
//         const dataToEncode = [...pcmData];
//         pcmData = []; // Clear immediately to capture next exact frame

//         const wavBlob = encodeWAV(dataToEncode, 16000);
//         sendAudioForProcessing(wavBlob);
//     }

//     async function sendAudioForProcessing(wavBlob) {
//         const formData = new FormData();
//         formData.append('audio', wavBlob, 'recording.wav');
//         formData.append('input_lang', inputLang.value);
//         formData.append('output_lang', outputLang.value);

//         try {
//             const resp = await fetch('/api/process-audio', {
//                 method: 'POST',
//                 body: formData
//             });

//             const result = await resp.json();

//             if (result.status === 'success') {
//                 if (isRecording) statusText.textContent = "Listening continuously... Click to stop.";

//                 appendLog(recognizedText, result.recognized_text, false);
//                 appendLog(translatedText, result.translated_text, true);

//                 // Queue Audio
//                 audioQueue.push(result.audio_base64);
//                 processAudioQueue();
//             } else {
//                 // UnknownValueError is expected for small noisy meaningless chunks, quietly ignore
//                 console.log("No valid speech found in chunk");
//                 if (isRecording) statusText.textContent = "Listening continuously... Click to stop.";
//             }
//         } catch (e) {
//             console.error("API error", e);
//         }
//     }

//     // Playback Queue System
//     function processAudioQueue() {
//         if (isPlaying || audioQueue.length === 0) return;

//         isPlaying = true;
//         const base64Audio = audioQueue.shift();

//         const audioObj = new Audio(base64Audio);
//         audioObj.onended = () => {
//             isPlaying = false;
//             processAudioQueue(); // Process next in queue
//         };
//         audioObj.onerror = () => {
//             isPlaying = false;
//             processAudioQueue(); // Skip over errors
//         };
//         audioObj.play().catch(e => {
//             console.error("Autoplay prevented or error", e);
//             isPlaying = false;
//             processAudioQueue();
//         });
//     }

//     // Chat UI Appending
//     function appendLog(container, text, isTranslated) {
//         const div = document.createElement('div');
//         div.className = 'chat-bubble ' + (isTranslated ? "highlighted" : "speaking");

//         const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
//         div.innerHTML = `<span class="timestamp">[${time}]</span> ${text}`;

//         container.appendChild(div);

//         // Auto scroll to bottom
//         container.scrollTop = container.scrollHeight;
//     }

//     // --- WAV Encoding Utilities ---
//     function encodeWAV(buffers, sampleRate) {
//         let totalLength = 0;
//         for (let i = 0; i < buffers.length; i++) {
//             totalLength += buffers[i].length;
//         }

//         const merged = new Float32Array(totalLength);
//         let offset = 0;
//         for (let i = 0; i < buffers.length; i++) {
//             merged.set(buffers[i], offset);
//             offset += buffers[i].length;
//         }

//         const buffer = new ArrayBuffer(44 + merged.length * 2);
//         const view = new DataView(buffer);

//         writeString(view, 0, 'RIFF');
//         view.setUint32(4, 36 + merged.length * 2, true);
//         writeString(view, 8, 'WAVE');
//         writeString(view, 12, 'fmt ');
//         view.setUint32(16, 16, true);
//         view.setUint16(20, 1, true); // PCM format
//         view.setUint16(22, 1, true); // 1 channel
//         view.setUint32(24, sampleRate, true);
//         view.setUint32(28, sampleRate * 2, true); // byte rate
//         view.setUint16(32, 2, true); // block align
//         view.setUint16(34, 16, true); // 16-bit
//         writeString(view, 36, 'data');
//         view.setUint32(40, merged.length * 2, true);

//         floatTo16BitPCM(view, 44, merged);
//         return new Blob([view], { type: 'audio/wav' });
//     }

//     function writeString(view, offset, string) {
//         for (let i = 0; i < string.length; i++) {
//             view.setUint8(offset + i, string.charCodeAt(i));
//         }
//     }

//     function floatTo16BitPCM(output, offset, input) {
//         for (let i = 0; i < input.length; i++, offset += 2) {
//             let s = Math.max(-1, Math.min(1, input[i]));
//             output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
//         }
//     }
// });


































































































































































/* ═══════════════════════════════════════════════════════════════════════════
   LinguaSync — Continuous Voice Translator
   Architecture:
     • AudioContext (16 kHz) → ScriptProcessor → Int16 PCM
     • WebSocket streams raw PCM bytes to /ws/translate
     • Server accumulates 2-second windows → STT → translate → TTS
     • Results stream back; audio plays in FIFO queue
   ═══════════════════════════════════════════════════════════════════════════ */

(async () => {

    // ── DOM ───────────────────────────────────────────────────────────────────
    const inputLang = document.getElementById('inputLang');
    const outputLang = document.getElementById('outputLang');
    const swapBtn = document.getElementById('swapBtn');
    const recordBtn = document.getElementById('recordBtn');
    const micRingOuter = document.getElementById('micRingOuter');
    const statusText = document.getElementById('statusText');
    const liveDot = document.getElementById('liveDot');
    const queueBadge = document.getElementById('queueBadge');
    const playbackTag = document.getElementById('playbackTag');
    const recognisedLog = document.getElementById('recognisedLog');
    const translatedLog = document.getElementById('translatedLog');
    const waveCanvas = document.getElementById('waveCanvas');
    const bgCanvas = document.getElementById('bgCanvas');
    const waveCtx = waveCanvas.getContext('2d');
    const bgCtx = bgCanvas.getContext('2d');

    // ── State ──────────────────────────────────────────────────────────────────
    let isRecording = false;
    let audioCtx = null;
    let mediaStream = null;
    let processor = null;
    let analyser = null;
    let ws = null;
    let animFrameId = null;
    let pendingJobs = 0;          // chunks sent but not yet returned
    let audioQueue = [];
    let isPlaying = false;
    let isSpeaking = false;

    // VAD
    const VAD_THRESHOLD = 0.018;

    // ── Language dropdown population ───────────────────────────────────────────
    try {
        const res = await fetch('/api/languages');
        const data = await res.json();

        const autoOpt = new Option('Auto Detect', 'auto');
        inputLang.appendChild(autoOpt);

        data.names.forEach(name => {
            const code = data.codes[name];
            inputLang.appendChild(new Option(name, code));
            outputLang.appendChild(new Option(name, code));
        });

        inputLang.value = 'auto';
        outputLang.value = 'hi';   // sensible default for Indian users
    } catch (e) {
        console.error('Language fetch failed:', e);
    }

    // ── Swap languages ─────────────────────────────────────────────────────────
    swapBtn.addEventListener('click', () => {
        const a = inputLang.value;
        const b = outputLang.value;
        // auto can't be an output; skip swap if either is auto
        if (a === 'auto' || b === 'auto') return;
        inputLang.value = b;
        outputLang.value = a;
        sendConfig();
    });

    // ── Config helpers ─────────────────────────────────────────────────────────
    function sendConfig() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'config',
                input_lang: inputLang.value,
                output_lang: outputLang.value
            }));
        }
    }
    inputLang.addEventListener('change', sendConfig);
    outputLang.addEventListener('change', sendConfig);

    // ── Clear buttons ──────────────────────────────────────────────────────────
    document.querySelectorAll('.clear-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = document.getElementById(btn.dataset.target);
            if (target) target.innerHTML = '';
        });
    });

    // ── Main toggle ────────────────────────────────────────────────────────────
    recordBtn.addEventListener('click', () => {
        if (!isRecording) startSession();
        else stopSession();
    });

    // ══════════════════════════════════════════════════════════════════════════
    //  START SESSION
    // ══════════════════════════════════════════════════════════════════════════
    async function startSession() {
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                    sampleRate: 16000
                }
            });
        } catch (err) {
            setStatus('❌ Mic access denied — check browser permissions');
            return;
        }

        // AudioContext at 16 kHz
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const src = audioCtx.createMediaStreamSource(mediaStream);

        // Analyser for waveform visualisation
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);

        // ScriptProcessor for raw PCM capture (4096 frames ≈ 256 ms at 16 kHz)
        processor = audioCtx.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;

            const f32 = e.inputBuffer.getChannelData(0);

            // Simple peak VAD
            let peak = 0;
            for (let i = 0; i < f32.length; i++) {
                const v = Math.abs(f32[i]);
                if (v > peak) peak = v;
            }
            isSpeaking = peak > VAD_THRESHOLD;

            // Visual mic ring intensity
            micRingOuter.style.setProperty('--peak', peak);
            liveDot.className = isSpeaking ? 'live-dot speaking' : 'live-dot active';

            // Convert Float32 → Int16 and stream via WebSocket
            const i16 = float32ToInt16(f32);
            ws.send(i16.buffer);
        };

        src.connect(processor);
        processor.connect(audioCtx.destination);   // connect to destination (required for onaudioprocess to fire)

        isRecording = true;
        recordBtn.classList.add('recording');
        micRingOuter.classList.add('active');

        recognisedLog.innerHTML = '';
        translatedLog.innerHTML = '';
        pendingJobs = 0;
        audioQueue = [];
        isPlaying = false;

        connectWebSocket();
        startWaveformDraw();
        startBgAnimation();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  STOP SESSION
    // ══════════════════════════════════════════════════════════════════════════
    function stopSession() {
        if (!isRecording) return;

        // Flush remaining buffer on server before closing
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'flush' }));
            setTimeout(() => { if (ws) ws.close(); }, 600);
        }

        if (processor) { processor.disconnect(); processor = null; }
        if (analyser) { analyser.disconnect(); analyser = null; }
        if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); }
        if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();

        isRecording = false;
        isSpeaking = false;
        ws = null;

        recordBtn.classList.remove('recording');
        micRingOuter.classList.remove('active');
        liveDot.className = 'live-dot';

        setStatus('⏹ Stopped — click mic to start again');
        updateQueueBadge();
        cancelAnimationFrame(animFrameId);
        clearWaveform();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  WEBSOCKET
    // ══════════════════════════════════════════════════════════════════════════
    function connectWebSocket() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${proto}//${location.host}/ws/translate`);

        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
            sendConfig();
            setStatus('🔴 Live — speak now');
            liveDot.className = 'live-dot active';
        };

        ws.onmessage = (event) => {
            let result;
            try { result = JSON.parse(event.data); } catch { return; }

            if (result.type === 'config_ack') return;   // handshake

            if (result.status === 'success') {
                pendingJobs = Math.max(0, pendingJobs - 1);
                updateQueueBadge();

                appendBubble(recognisedLog, result.recognized_text, 'src');
                appendBubble(translatedLog, result.translated_text, 'tgt');

                audioQueue.push(result.audio_base64);
                drainAudioQueue();
            } else if (result.status === 'error') {
                console.warn('Server error:', result.message);
            }
        };

        ws.onerror = () => {
            setStatus('⚠ Connection error — retrying…');
        };

        ws.onclose = () => {
            liveDot.className = 'live-dot';
            if (isRecording) {
                // Auto-reconnect
                setTimeout(connectWebSocket, 1200);
                setStatus('Reconnecting…');
            }
        };
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  AUDIO PLAYBACK QUEUE  (FIFO, no overlap)
    // ══════════════════════════════════════════════════════════════════════════
    function drainAudioQueue() {
        if (isPlaying || audioQueue.length === 0) return;
        isPlaying = true;

        playbackTag.classList.add('visible');

        const audio = new Audio(audioQueue.shift());
        audio.onended = () => {
            isPlaying = false;
            if (audioQueue.length === 0) playbackTag.classList.remove('visible');
            drainAudioQueue();
        };
        audio.onerror = () => {
            isPlaying = false;
            drainAudioQueue();
        };
        audio.play().catch(() => {
            isPlaying = false;
            drainAudioQueue();
        });
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  WAVEFORM VISUALISER
    // ══════════════════════════════════════════════════════════════════════════
    function startWaveformDraw() {
        const W = waveCanvas.width = waveCanvas.offsetWidth * devicePixelRatio;
        const H = waveCanvas.height = waveCanvas.offsetHeight * devicePixelRatio;
        waveCtx.scale(devicePixelRatio, devicePixelRatio);

        const bufLen = analyser ? analyser.frequencyBinCount : 128;
        const dataArr = new Uint8Array(bufLen);

        function draw() {
            animFrameId = requestAnimationFrame(draw);
            if (!analyser) return;

            analyser.getByteTimeDomainData(dataArr);

            const w = waveCanvas.offsetWidth;
            const h = waveCanvas.offsetHeight;

            waveCtx.clearRect(0, 0, w, h);

            // Glow when speaking
            const accent = isSpeaking ? '#00ffa0' : '#2d3748';
            const glow = isSpeaking ? 0.9 : 0.3;

            waveCtx.save();
            waveCtx.shadowBlur = isSpeaking ? 10 : 0;
            waveCtx.shadowColor = accent;
            waveCtx.globalAlpha = glow;
            waveCtx.strokeStyle = accent;
            waveCtx.lineWidth = 2;
            waveCtx.beginPath();

            const sliceW = w / bufLen;
            let x = 0;
            for (let i = 0; i < bufLen; i++) {
                const v = dataArr[i] / 128.0;
                const y = (v * h) / 2;
                if (i === 0) waveCtx.moveTo(x, y);
                else waveCtx.lineTo(x, y);
                x += sliceW;
            }
            waveCtx.stroke();
            waveCtx.restore();
        }
        draw();
    }

    function clearWaveform() {
        waveCtx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  BACKGROUND GRID ANIMATION
    // ══════════════════════════════════════════════════════════════════════════
    function startBgAnimation() {
        bgCanvas.width = window.innerWidth;
        bgCanvas.height = window.innerHeight;

        const cols = Math.ceil(bgCanvas.width / 48);
        const rows = Math.ceil(bgCanvas.height / 48);
        let t = 0;

        function drawBg() {
            if (!isRecording) return;
            requestAnimationFrame(drawBg);
            bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
            t += 0.008;

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const wave = Math.sin(t + c * 0.3 + r * 0.4) * 0.5 + 0.5;
                    const alpha = wave * 0.06;
                    bgCtx.strokeStyle = `rgba(0,255,160,${alpha})`;
                    bgCtx.lineWidth = 0.5;
                    bgCtx.strokeRect(c * 48, r * 48, 47, 47);
                }
            }
        }
        drawBg();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ══════════════════════════════════════════════════════════════════════════
    function float32ToInt16(f32) {
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
            const s = Math.max(-1, Math.min(1, f32[i]));
            i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return i16;
    }

    function appendBubble(container, text, kind) {
        // Remove empty hint on first entry
        const hint = container.querySelector('.empty-hint');
        if (hint) hint.remove();

        const div = document.createElement('div');
        div.className = `bubble bubble--${kind}`;

        const ts = new Date().toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        div.innerHTML = `<span class="ts">${ts}</span>${escHtml(text)}`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    function escHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function setStatus(msg) {
        statusText.textContent = msg;
    }

    function updateQueueBadge() {
        if (pendingJobs > 0) {
            queueBadge.textContent = `${pendingJobs} processing…`;
            queueBadge.style.display = 'inline';
        } else {
            queueBadge.style.display = 'none';
        }
    }

    window.addEventListener('resize', () => {
        bgCanvas.width = window.innerWidth;
        bgCanvas.height = window.innerHeight;
        waveCanvas.width = waveCanvas.offsetWidth * devicePixelRatio;
        waveCanvas.height = waveCanvas.offsetHeight * devicePixelRatio;
    });

})();