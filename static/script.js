document.addEventListener('DOMContentLoaded', async () => {
    const inputLang = document.getElementById('inputLang');
    const outputLang = document.getElementById('outputLang');
    const recordBtn = document.getElementById('recordBtn');
    const statusText = document.getElementById('statusText');
    const recognizedText = document.getElementById('recognizedText');
    const translatedText = document.getElementById('translatedText');

    let isRecording = false;
    let audioContext = null;
    let mediaStream = null;
    let processor = null;
    let pcmData = [];

    // VAD Variables
    const SILENCE_THRESHOLD = 0.02; 
    const SILENCE_MS = 1200; // 1.2s
    let speaking = false;
    let silenceTimer = null;

    // Playback Queue Variables
    let audioQueue = [];
    let isPlaying = false;

    // Fetch languages
    try {
        const response = await fetch('/api/languages');
        const data = await response.json();
        
        const autoOption = document.createElement('option');
        autoOption.value = 'auto';
        autoOption.textContent = 'Auto Detect';
        inputLang.appendChild(autoOption);

        data.names.forEach(name => {
            const code = data.codes[name];
            
            const opt1 = document.createElement('option');
            opt1.value = code;
            opt1.textContent = name;
            inputLang.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = code;
            opt2.textContent = name;
            outputLang.appendChild(opt2);
        });

        inputLang.value = 'auto';
        outputLang.value = 'en'; 
    } catch (e) {
        console.error("Error fetching languages:", e);
    }

    recordBtn.addEventListener('click', async () => {
        if (!isRecording) {
            await startContinuousRecording();
        } else {
            stopContinuousRecording();
        }
    });

    async function startContinuousRecording() {
        try {
            // Echo cancellation keeps the mic from hearing our own TTS!
            mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { echoCancellation: true, noiseSuppression: true } 
            });
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            const source = audioContext.createMediaStreamSource(mediaStream);
            
            processor = audioContext.createScriptProcessor(4096, 1, 1);
            pcmData = [];
            speaking = false;
            silenceTimer = null;
            
            processor.onaudioprocess = (e) => {
                const channelData = e.inputBuffer.getChannelData(0);
                const float32Array = new Float32Array(channelData);
                
                let maxVol = 0;
                for(let i=0; i<float32Array.length; i++){
                    if(Math.abs(float32Array[i]) > maxVol) maxVol = Math.abs(float32Array[i]);
                }
                
                if (maxVol > SILENCE_THRESHOLD) {
                    if (!speaking) {
                        speaking = true;
                        statusText.textContent = "Listening... (Speaking detected)";
                    }
                    if (silenceTimer) {
                        clearTimeout(silenceTimer);
                        silenceTimer = null;
                    }
                } else {
                    if (speaking && !silenceTimer) {
                        // Wait for 1.2s before flush
                        silenceTimer = setTimeout(() => {
                            speaking = false;
                            silenceTimer = null;
                            statusText.textContent = "Processing... (Listening in background)";
                            flushAudioChunk();
                        }, SILENCE_MS);
                    }
                }
                
                pcmData.push(float32Array);
                
                if (!speaking && pcmData.length > (16000/4096) * 3) {
                    pcmData.shift(); 
                }
            };
            
            source.connect(processor);
            processor.connect(audioContext.destination);

            isRecording = true;
            recordBtn.classList.add('recording');
            statusText.textContent = "Listening continuously... Click to stop.";
            
            // Clear placeholders
            recognizedText.innerHTML = '';
            translatedText.innerHTML = '';
            
        } catch (err) {
            console.error("Error accessing microphone", err);
            statusText.textContent = "Microphone access denied.";
        }
    }

    function stopContinuousRecording() {
        if (!isRecording) return;
        
        // Final flush if anything is left
        if (speaking) flushAudioChunk();

        processor.disconnect();
        mediaStream.getTracks().forEach(track => track.stop());
        if(audioContext.state !== 'closed') audioContext.close();
        
        isRecording = false;
        recordBtn.classList.remove('recording');
        statusText.textContent = "Stopped. Ready to record.";
    }

    function flushAudioChunk() {
        if (pcmData.length === 0) return;
        
        // Deep copy out data
        const dataToEncode = [...pcmData];
        pcmData = []; // Clear immediately to capture next exact frame
        
        const wavBlob = encodeWAV(dataToEncode, 16000);
        sendAudioForProcessing(wavBlob);
    }

    async function sendAudioForProcessing(wavBlob) {
        const formData = new FormData();
        formData.append('audio', wavBlob, 'recording.wav');
        formData.append('input_lang', inputLang.value);
        formData.append('output_lang', outputLang.value);

        try {
            const resp = await fetch('/api/process-audio', {
                method: 'POST',
                body: formData
            });

            const result = await resp.json();
            
            if (result.status === 'success') {
                if (isRecording) statusText.textContent = "Listening continuously... Click to stop.";
                
                appendLog(recognizedText, result.recognized_text, false);
                appendLog(translatedText, result.translated_text, true);

                // Queue Audio
                audioQueue.push(result.audio_base64);
                processAudioQueue();
            } else {
                // UnknownValueError is expected for small noisy meaningless chunks, quietly ignore
                console.log("No valid speech found in chunk");
                if (isRecording) statusText.textContent = "Listening continuously... Click to stop.";
            }
        } catch (e) {
            console.error("API error", e);
        }
    }

    // Playback Queue System
    function processAudioQueue() {
        if (isPlaying || audioQueue.length === 0) return;
        
        isPlaying = true;
        const base64Audio = audioQueue.shift();
        
        const audioObj = new Audio(base64Audio);
        audioObj.onended = () => {
            isPlaying = false;
            processAudioQueue(); // Process next in queue
        };
        audioObj.onerror = () => {
            isPlaying = false;
            processAudioQueue(); // Skip over errors
        };
        audioObj.play().catch(e => {
            console.error("Autoplay prevented or error", e);
            isPlaying = false;
            processAudioQueue();
        });
    }

    // Chat UI Appending
    function appendLog(container, text, isTranslated) {
        const div = document.createElement('div');
        div.className = 'chat-bubble ' + (isTranslated ? "highlighted" : "speaking");
        
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        div.innerHTML = `<span class="timestamp">[${time}]</span> ${text}`;
        
        container.appendChild(div);
        
        // Auto scroll to bottom
        container.scrollTop = container.scrollHeight;
    }

    // --- WAV Encoding Utilities ---
    function encodeWAV(buffers, sampleRate) {
        let totalLength = 0;
        for (let i = 0; i < buffers.length; i++) {
            totalLength += buffers[i].length;
        }
        
        const merged = new Float32Array(totalLength);
        let offset = 0;
        for (let i = 0; i < buffers.length; i++) {
            merged.set(buffers[i], offset);
            offset += buffers[i].length;
        }

        const buffer = new ArrayBuffer(44 + merged.length * 2);
        const view = new DataView(buffer);
        
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + merged.length * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM format
        view.setUint16(22, 1, true); // 1 channel
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true); // byte rate
        view.setUint16(32, 2, true); // block align
        view.setUint16(34, 16, true); // 16-bit
        writeString(view, 36, 'data');
        view.setUint32(40, merged.length * 2, true);
        
        floatTo16BitPCM(view, 44, merged);
        return new Blob([view], { type: 'audio/wav' });
    }

    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    function floatTo16BitPCM(output, offset, input) {
        for (let i = 0; i < input.length; i++, offset += 2) {
            let s = Math.max(-1, Math.min(1, input[i]));
            output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
    }
});
