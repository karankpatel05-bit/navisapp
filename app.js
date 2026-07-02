/* ═══════════════════════════════════════════════════════════
   NAVIS AI – Fully Serverless Edition (Direct Groq + ESP32)
   ═══════════════════════════════════════════════════════════ */

const SYSTEM_PROMPT = `You are Navis, an advanced AI assistant developed by Robo Manthan.

Your personality:
- Professional yet friendly and approachable
- Knowledgeable across a wide range of topics
- Clear, concise, and helpful
- Proud of being created by the Robo Manthan team

About you:
- Name: Navis
- Created by: Rahul and the Robo Manthan team
- Capabilities: Text & voice Q&A. You understand English, Hindi, and Kannada.

About Robo Manthan (Robomanthan Pvt. Ltd.):
- An Indian robotech company specializing in robotics, AI, machine learning, and embedded product development
- CEO: Saurav Kumar | CTO: Tanuj Kashyap
- Incubated at IIT Patna, headquartered in Bengaluru (BTM 2nd Stage)
- Incorporated: January 8, 2021
- Motto: 'आपके उन्नति का साथी' (Your partner in progress)
- Products: Humanoid robots, autonomous systems, smart wheelchairs, educational robotics kits
- Services: STEM education, workshops, internships, ATAL Tinkering Labs, 50+ college MoUs

Keep responses concise but thorough. Use markdown formatting when helpful. Your answers will be spoken aloud, so keep them conversational.`;

const LANG_INSTRUCTIONS = {
    'hi-IN': '[RESPOND IN HINDI using Devanagari script (हिन्दी). Keep it conversational and natural.]',
    'kn-IN': '[RESPOND IN KANNADA using Kannada script (ಕನ್ನಡ). Keep it conversational and natural.]',
    'en-IN': '',
};

class NavisApp {
    constructor() {
        // Chatbot UI Elements
        this.els = {
            messages: document.getElementById('messages'),
            userInput: document.getElementById('userInput'),
            sendBtn: document.getElementById('sendBtn'),
            stopBtn: document.getElementById('stopBtn'),
            voiceBtn: document.getElementById('voiceBtn'),
            trainToggle: document.getElementById('trainToggle'),
            trainingPanel: document.getElementById('trainingPanel'),
            closeTraining: document.getElementById('closeTraining'),
            addTraining: document.getElementById('addTraining'),
            trainQuestion: document.getElementById('trainQuestion'),
            trainAnswer: document.getElementById('trainAnswer'),
            trainingList: document.getElementById('trainingList'),
            overlay: document.getElementById('overlay'),
            chatContainer: document.getElementById('chatContainer'),
            welcomeHero: document.getElementById('welcomeHero'),
            resetBtn: document.getElementById('resetBtn'),
            ttsToggle: document.getElementById('ttsToggle'),
            toastContainer: document.getElementById('toastContainer'),
            appContainer: document.getElementById('app-container'),
            
            // Connection UI Elements
            connectionOverlay: document.getElementById('connection-overlay'),
            espIpInput: document.getElementById('esp-ip'),
            connectBtn: document.getElementById('connect-btn'),
            skipBtn: document.getElementById('skip-btn'),
            disconnectBtn: document.getElementById('disconnect-btn'),
            connectionStatus: document.getElementById('connection-status'),
            groqKeyInput: document.getElementById('groq-key'),
            groqKeySaved: document.getElementById('groq-key-saved'),
            groqKeyInputWrap: document.getElementById('groq-key-input-wrap'),
            changeApiKeyBtn: document.getElementById('change-api-key'),
            
            // WiFi Setup Elements
            wifiSetupToggle: document.getElementById('wifi-setup-toggle'),
            wifiSetupBody: document.getElementById('wifiSetupBody'),
            wifiSsidInput: document.getElementById('wifi-ssid'),
            wifiPassInput: document.getElementById('wifi-pass'),
            wifiSendBtn: document.getElementById('wifi-send-btn'),
            wifiSetupStatus: document.getElementById('wifi-setup-status'),
            
            // Test buttons
            testEyesBtn: document.getElementById('test-eyes-btn'),
            testMouthBtn: document.getElementById('test-mouth-btn')
        };

        // State
        this.isRecording = false;
        this.continuousListening = false;
        this.recognition = null;
        this.ttsEnabled = true;
        this.isProcessing = false;
        this.isSpeaking = false;
        this.voicesLoaded = false;
        this.abortController = null;
        this.currentTypingEl = null;
        this.micPermissionGranted = false;
        this._ttsKicker = null;
        this._jawKeepalive = null;
        this._speechPoller = null;   // polls speechSynthesis.speaking to detect true end

        // Persistent Audio Element for Cloud TTS
        this.audioElement = new Audio();
        this.audioUnlocked = false;

        // Hardware State
        this.ws = null;
        this.isConnected = false;
        this.hardwareState = {
            eyes: 1, // 1 = open, 0 = closed
            speaking: 0 // 1 = speaking, 0 = idle
        };
        
        // Serverless Groq State
        this.groqKey = localStorage.getItem('groq_api_key') || '';
        this.conversationHistory = [];

        this.init();
    }

    init() {
        this.loadSavedSettings();
        this.initSpeechRecognition();
        this.initTTS();
        this.bindEvents();
        this.autoResize();
        
        if (this.els.ttsToggle) this.els.ttsToggle.classList.add('active');
        if (typeof marked !== 'undefined') {
            marked.setOptions({ breaks: true, gfm: true });
        }
    }

    loadSavedSettings() {
        const savedIP = localStorage.getItem('esp32_ip');
        if (savedIP) this.els.espIpInput.value = savedIP;

        const savedKey = localStorage.getItem('groq_api_key');
        if (savedKey && this.els.groqKeyInput) {
            this.els.groqKeyInput.value = savedKey;
            // One-time key: hide input, show saved badge
            if (this.els.groqKeySaved) this.els.groqKeySaved.style.display = 'flex';
            if (this.els.groqKeyInputWrap) this.els.groqKeyInputWrap.style.display = 'none';
        }
    }

    saveGroqKey() {
        if (!this.els.groqKeyInput) return;
        const key = this.els.groqKeyInput.value.trim();
        if (key) {
            this.groqKey = key;
            localStorage.setItem('groq_api_key', key);
        }
    }

    toggleApiKeyEdit() {
        if (this.els.groqKeyInputWrap && this.els.groqKeySaved) {
            const isHidden = this.els.groqKeyInputWrap.style.display === 'none';
            this.els.groqKeyInputWrap.style.display = isHidden ? 'block' : 'none';
            this.els.groqKeySaved.style.display = isHidden ? 'none' : 'flex';
            if (isHidden && this.els.groqKeyInput) {
                this.els.groqKeyInput.focus();
            }
        }
    }

    /* ── WiFi Provisioning (AP Mode) ──────────────────────── */
    toggleWifiSetup() {
        if (!this.els.wifiSetupBody) return;
        const isHidden = this.els.wifiSetupBody.style.display === 'none';
        this.els.wifiSetupBody.style.display = isHidden ? 'block' : 'none';
        const chevron = this.els.wifiSetupToggle?.querySelector('.chevron-icon');
        if (chevron) chevron.style.transform = isHidden ? 'rotate(180deg)' : '';
    }

    async sendWifiCredentials() {
        const ssid = this.els.wifiSsidInput?.value.trim();
        const pass = this.els.wifiPassInput?.value || '';
        
        if (!ssid) {
            this.showWifiStatus('Please enter a WiFi SSID', 'error');
            return;
        }

        this.showWifiStatus('Sending credentials to ESP32...', '');
        if (this.els.wifiSendBtn) this.els.wifiSendBtn.disabled = true;

        try {
            // Send to ESP32 AP captive portal at 192.168.4.1
            const url = `http://192.168.4.1/setup?ssid=${encodeURIComponent(ssid)}&pass=${encodeURIComponent(pass)}`;
            const res = await fetch(url, { mode: 'no-cors', cache: 'no-store' });
            
            // no-cors means we can't read the response, but if it didn't throw, it was sent
            this.showWifiStatus('✅ Credentials sent! ESP32 will restart and connect to your WiFi. Reconnect your phone to your home WiFi network.', 'success');
            this.toast('WiFi credentials sent to ESP32!', 'success');
            
            // Clear inputs
            if (this.els.wifiSsidInput) this.els.wifiSsidInput.value = '';
            if (this.els.wifiPassInput) this.els.wifiPassInput.value = '';
        } catch (err) {
            console.error('WiFi setup error:', err);
            this.showWifiStatus('❌ Failed to reach ESP32. Make sure you are connected to the Navis_Setup WiFi network.', 'error');
        } finally {
            if (this.els.wifiSendBtn) this.els.wifiSendBtn.disabled = false;
        }
    }

    showWifiStatus(msg, type) {
        if (!this.els.wifiSetupStatus) return;
        this.els.wifiSetupStatus.textContent = msg;
        this.els.wifiSetupStatus.className = 'wifi-setup-status' + (type ? ` ${type}` : '');
    }

    /* ── WebSocket Connection ────────────────────────────── */
    connectESP32() {
        if (this.isConnected) {
            if (this.ws) this.ws.close();
            return;
        }

        let ip = this.els.espIpInput.value.trim();
        if (!ip) {
            this.showConnectionError('Please enter an ESP32 IP address');
            return;
        }

        // Clean and format IP
        ip = ip.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
        if (!ip.includes(':')) {
            ip = `${ip}:81`;
        }
        ip = `ws://${ip}`;

        localStorage.setItem('esp32_ip', this.els.espIpInput.value.trim());
        this.saveGroqKey();
        
        this.els.connectionStatus.textContent = 'Connecting...';
        this.els.connectionStatus.className = 'status-text';
        this.els.connectBtn.disabled = true;

        try {
            this.ws = new WebSocket(ip);

            this.ws.onopen = () => {
                console.log('WebSocket Connected');
                this.updateConnectionStatus(true);
                this.sendHardwareState(); // Send initial state
                
                // Transition UI
                this.els.connectionOverlay.classList.add('hidden');
                this.els.appContainer.style.display = 'flex';
                // Trigger reflow
                void this.els.appContainer.offsetWidth;
                this.els.appContainer.style.opacity = '1';
                
                this.toast('ESP32 Connected Successfully', 'success');
                this.loadTrainingData();
            };

            this.ws.onclose = () => {
                console.log('WebSocket Disconnected');
                this.updateConnectionStatus(false);
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket Error:', error);
                this.showConnectionError('Connection failed. Check IP & Network.');
            };
        } catch (e) {
            if (e.name === 'SecurityError') {
                // HTTPS blocks ws:// — auto fall back to chat-only mode
                console.warn('HTTPS blocks ws://, switching to chat-only mode');
                this.toast('⚠️ HTTPS blocks ESP32 ws:// — switching to Chat Only mode', 'info');
                setTimeout(() => this.skipESP32(), 1200);
            } else {
                this.showConnectionError('Invalid IP address format.');
            }
            console.error(e);
        }
    }

    skipESP32() {
        this.saveGroqKey();
        this.isConnected = false;
        
        // Transition UI
        this.els.connectionOverlay.classList.add('hidden');
        this.els.appContainer.style.display = 'flex';
        // Trigger reflow
        void this.els.appContainer.offsetWidth;
        this.els.appContainer.style.opacity = '1';
        
        this.toast('Direct Chat Mode Active', 'success');
        this.loadTrainingData();
        
        // Update welcome UI
        if (this.els.welcomeHero) {
            const title = this.els.welcomeHero.querySelector('.welcome-title');
            const sub = this.els.welcomeHero.querySelector('.welcome-sub');
            if (title) title.innerHTML = 'Direct Chat <span class="accent">Active</span>';
            if (sub) sub.textContent = 'Hardware link skipped. Ready for direct chat and voice processing.';
        }
    }

    disconnectESP32() {
        if (this.ws) {
            this.ws.close();
        }
        this.updateConnectionStatus(false);
    }

    updateConnectionStatus(connected) {
        this.isConnected = connected;
        if (!connected) {
            this.els.connectBtn.disabled = false;
            this.els.connectionStatus.textContent = 'Disconnected';
            this.els.connectionStatus.className = 'status-text error';
            
            // Revert UI
            this.els.appContainer.style.opacity = '0';
            setTimeout(() => {
                this.els.appContainer.style.display = 'none';
                this.els.connectionOverlay.classList.remove('hidden');
            }, 500);
            
            this.ws = null;
        }
    }

    showConnectionError(msg) {
        this.els.connectionStatus.textContent = msg;
        this.els.connectionStatus.className = 'status-text error';
        this.els.connectBtn.disabled = false;
    }

    /* ── Hardware Sync ────────────────────────────────────── */
    sendHardwareState() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const payload = `${this.hardwareState.eyes},${this.hardwareState.speaking}`;
            this.ws.send(payload);
            console.log('Sent to ESP32:', payload);
        }
    }

    setMouthState(state) {
        if (this.hardwareState.speaking !== state) {
            this.hardwareState.speaking = state;
            this.sendHardwareState();
        }
    }

    toggleEyes() {
        this.hardwareState.eyes = this.hardwareState.eyes === 1 ? 0 : 1;
        this.sendHardwareState();
        this.toast(this.hardwareState.eyes === 1 ? 'Eyes Opened' : 'Eyes Closed', 'info');
    }

    /* ── TTS Init ────────── */
    initTTS() {
        // Pre-load voices for Web Speech API (async on some Android versions)
        if (window.speechSynthesis) {
            window.speechSynthesis.getVoices();
            window.speechSynthesis.onvoiceschanged = () => {
                this.voicesLoaded = true;
                console.log('TTS voices loaded:', window.speechSynthesis.getVoices().length);
            };
        }
    }

    /* ── Speech Recognition ─────────────────────────────── */
    initSpeechRecognition() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        this.recognition = new SR();
        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        const langSelect = document.getElementById('langSelect');
        this.recognition.lang = langSelect ? langSelect.value : 'en-IN';

        if (langSelect) {
            langSelect.addEventListener('change', (e) => {
                if (this.recognition) this.recognition.lang = e.target.value;
            });
        }

        this.recognition.onresult = (e) => {
            const transcript = Array.from(e.results)
                .map(r => r[0].transcript).join('');
            this.els.userInput.value = transcript;
            this.autoResize();
            if (e.results[0] && e.results[0].isFinal) {
                this.stopRecording();
                setTimeout(() => this.sendMessage(), 50);
            }
        };
        
        this.recognition.onerror = (e) => {
            console.error('Speech error:', e.error);
            this.stopRecording();
            if (e.error === 'not-allowed') {
                this.continuousListening = false;
                this.toast('Microphone access denied', 'error');
            }
        };
        
        this.recognition.onend = () => {
            this.stopRecording();
            if (this.continuousListening && !this.isProcessing && !this.isSpeaking) {
                setTimeout(() => {
                    if (this.continuousListening && !this.isProcessing && !this.isSpeaking && !this.isRecording) {
                        this.startRecording();
                    }
                }, 150);
            }
        };
    }

    /* ── Runtime Mic Permission (Android WebView requires getUserMedia first) ── */
    requestMicPermission() {
        return new Promise((resolve) => {
            if (this.micPermissionGranted) { resolve(true); return; }

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                // Older WebView — just try directly
                this.micPermissionGranted = true;
                resolve(true);
                return;
            }

            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    // Permission granted — immediately release the stream
                    stream.getTracks().forEach(t => t.stop());
                    this.micPermissionGranted = true;
                    console.log('Mic permission granted');
                    resolve(true);
                })
                .catch(err => {
                    console.error('Mic permission denied:', err);
                    this.toast('Microphone permission denied. Please allow it in Settings.', 'error');
                    resolve(false);
                });
        });
    }

    startRecording() {
        if (!this.recognition) { this.toast('Voice not supported in this browser', 'error'); return; }
        if (this.isRecording) return;

        // Android WebView: request mic permission first, then start
        this.requestMicPermission().then(granted => {
            if (!granted) return;
            this.isRecording = true;
            this.els.voiceBtn.classList.add('recording');
            this.els.userInput.placeholder = 'Listening...';
            try { this.recognition.start(); } catch (e) { console.error('recognition.start error:', e); }
        });
    }

    stopRecording() {
        if (!this.isRecording) return;
        this.isRecording = false;
        this.els.voiceBtn.classList.remove('recording');
        this.els.userInput.placeholder = 'Ask Navis anything...';
        try { this.recognition.stop(); } catch (e) { }
    }

    /* ── Text-to-Speech (Web Speech API primary, Google TTS fallback) ── */
    getSelectedLang() {
        const langSelect = document.getElementById('langSelect');
        return langSelect ? langSelect.value : 'en-IN';
    }

    detectLanguage(text) {
        if (/[\u0900-\u097F]/.test(text)) return 'hi-IN';
        if (/[\u0C80-\u0CFF]/.test(text)) return 'kn-IN';
        const hindiWords = /\b(hai|hain|ka|ki|ke|kya|nahi|nahin|aur|mein|yeh|woh|toh|bhi|kaise|kab|kaha|kyun|aap|hum|tum|ji|tha|thi|the|ho|hota|hoti|karo|karte|karna|accha|bahut|baat|bol|dekho|suno|matlab|zaroor|namaste|dhanyavaad|shukriya|kaam|aise|waise|lekin|par|abhi|sabhi)\b/i;
        if (hindiWords.test(text)) return 'hi-IN';
        return 'en-IN';
    }

    cleanTextForSpeech(text) {
        return text
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/#{1,6}\s*/g, '')
            .replace(/[*_~]{1,3}/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/[>[\]()]/g, '')
            .replace(/\n+/g, '. ')
            .replace(/\.\s*\./g, '.')
            .trim();
    }

    speak(text, langHint) {
        if (!this.ttsEnabled) {
            this.onSpeechDone();
            return;
        }

        const clean = this.cleanTextForSpeech(text);
        if (!clean) { this.onSpeechDone(); return; }

        this.isSpeaking = true;
        this.speechStopped = false;
        this.showStopBtn();
        this.setMouthState(1);
        this.startJawKeepalive();   // keep jaw open throughout speech

        const detectedLang = this.detectLanguage(clean);
        const langCode = langHint || detectedLang || this.getSelectedLang();

        // ── Primary: Web Speech API (built-in Android WebView, no network needed) ──
        if (window.speechSynthesis) {
            this.speakWithWebSpeech(clean, langCode);
        } else {
            // ── Fallback: Google Translate TTS (requires network) ──
            console.warn('speechSynthesis not available, falling back to Google TTS');
            let gtLang = langCode;
            if (gtLang.startsWith('hi')) gtLang = 'hi';
            else if (gtLang.startsWith('kn')) gtLang = 'kn';
            else gtLang = 'en';
            const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
            let chunks = [];
            sentences.forEach(s => {
                if (s.length <= 150) {
                    chunks.push(s);
                } else {
                    let words = s.split(' '), currentChunk = '';
                    words.forEach(w => {
                        if ((currentChunk + w).length < 150) { currentChunk += w + ' '; }
                        else { chunks.push(currentChunk.trim()); currentChunk = w + ' '; }
                    });
                    if (currentChunk.trim()) chunks.push(currentChunk.trim());
                }
            });
            this.playCloudAudioChunks(chunks, gtLang);
        }
    }

    speakWithWebSpeech(text, langCode) {
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = langCode;
        utterance.rate = 0.95;  // matches navis-LLM speech speed
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        // Pick a matching voice
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            const match = voices.find(v => v.lang.startsWith(langCode.split('-')[0]))
                       || voices.find(v => v.lang.startsWith('en'))
                       || voices[0];
            if (match) utterance.voice = match;
        }

        // ── Estimate speech duration ──────────────────────────────────────
        // English at rate 0.95: ~11 chars/sec. Hindi/Kannada: ~8 chars/sec.
        // This lets us hold the jaw open for the ENTIRE speech duration,
        // ignoring pauses between sentences completely.
        const isIndic = langCode.startsWith('hi') || langCode.startsWith('kn');
        const charsPerSec = isIndic ? 8 : 11;
        const estimatedMs = Math.max(1500, (text.length / charsPerSec) * 1000);
        console.log(`TTS: ${text.length} chars, estimated ${estimatedMs}ms`);

        let durationTimer = null;
        const scheduleDone = (delay) => {
            if (durationTimer) clearTimeout(durationTimer);
            durationTimer = setTimeout(() => {
                if (!this.speechStopped) this.onSpeechDone();
            }, delay);
        };

        // onstart: clear any premature timer, schedule close at estimated end
        utterance.onstart = () => {
            console.log('TTS onstart');
            scheduleDone(estimatedMs + 400);   // estimated duration + 400ms drain buffer
        };

        // onend: Android fired end event — wait 400ms for audio to drain, then close jaw
        utterance.onend = () => {
            console.log('TTS onend');
            scheduleDone(400);   // override timer: close 400ms after engine says done
        };

        utterance.onerror = (e) => {
            console.error('TTS error:', e.error);
            if (durationTimer) { clearTimeout(durationTimer); durationTimer = null; }
            if (e.error === 'interrupted' || e.error === 'canceled') return;
            this.toast('Native TTS error, trying fallback...', 'info');
            this.stopJawKeepalive();
            let gtLang = langCode.startsWith('hi') ? 'hi' : langCode.startsWith('kn') ? 'kn' : 'en';
            const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
            let chunks = [];
            sentences.forEach(s => {
                if (s.length <= 150) chunks.push(s);
                else {
                    let words = s.split(' '), cur = '';
                    words.forEach(w => { if ((cur + w).length < 150) cur += w + ' '; else { chunks.push(cur.trim()); cur = w + ' '; } });
                    if (cur.trim()) chunks.push(cur.trim());
                }
            });
            this.playCloudAudioChunks(chunks, gtLang);
        };

        // Android 14s pause bug kicker
        this._ttsKicker = setInterval(() => {
            if (!this.isSpeaking) { clearInterval(this._ttsKicker); this._ttsKicker = null; return; }
            if (window.speechSynthesis.speaking && window.speechSynthesis.paused) {
                console.log('TTS paused, resuming...');
                window.speechSynthesis.resume();
            }
        }, 5000);

        // Safety net: if onstart never fires (some Android versions), close jaw
        // after estimated duration + 2s grace period
        scheduleDone(estimatedMs + 2000);

        window.speechSynthesis.speak(utterance);
    }

    stopSpeechPoller() {
        // kept for compatibility (called from stopResponse)
    }

    // ── Jaw Keepalive: force-sends mouth=OPEN every 400ms while isSpeaking ────
    // Uses sendHardwareState() directly (not setMouthState) so the ESP32
    // keeps receiving the signal even during natural sentence pauses where
    // the state hasn't "changed".
    startJawKeepalive() {
        this.stopJawKeepalive();
        this.hardwareState.speaking = 1;  // mark as open immediately
        this._jawKeepalive = setInterval(() => {
            if (!this.isSpeaking || this.speechStopped) {
                this.stopJawKeepalive();
                return;
            }
            // Force-send even if already 1 — ensures ESP32 stays synced during pauses
            this.hardwareState.speaking = 1;
            this.sendHardwareState();
        }, 400);
    }

    stopJawKeepalive() {
        if (this._jawKeepalive) {
            clearInterval(this._jawKeepalive);
            this._jawKeepalive = null;
        }
    }

    playCloudAudioChunks(chunks, lang) {
        let i = 0;
        const playNext = () => {
            if (this.speechStopped || i >= chunks.length) {
                this.onSpeechDone();
                return;
            }
            const chunk = chunks[i].trim();
            if (!chunk) { i++; playNext(); return; }

            const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
            this.audioElement.src = url;
            this.audioElement.onended = () => { i++; playNext(); };
            this.audioElement.onerror = (e) => {
                console.error('Cloud TTS Error:', chunk, e);
                i++;
                playNext();
            };
            this.audioElement.play().catch(e => {
                console.error('Audio playback blocked', e);
                this.onSpeechDone();
            });
        };
        playNext();
    }

    onSpeechDone() {
        if (!this.isSpeaking) return;    // guard: prevent double-fire
        this.isSpeaking = false;
        if (this._ttsKicker) { clearInterval(this._ttsKicker); this._ttsKicker = null; }
        this.stopSpeechPoller();
        this.stopJawKeepalive();
        // Signal ESP32: mouth CLOSE
        this.setMouthState(0);

        if (!this.isProcessing) {
            this.showSendBtn();
            if (this.continuousListening) {
                setTimeout(() => {
                    if (this.continuousListening && !this.isProcessing && !this.isSpeaking && !this.isRecording) {
                        this.startRecording();
                    }
                }, 500);
            }
        }
    }

    showStopBtn() {
        this.els.sendBtn.style.display = 'none';
        this.els.stopBtn.style.display = 'flex';
    }

    showSendBtn() {
        this.els.sendBtn.style.display = 'flex';
        this.els.stopBtn.style.display = 'none';
    }

    /* ── Events ─────────────────────────────────────────── */
    bindEvents() {
        const unlockAudio = () => {
            if (!this.audioUnlocked) {
                // Play a silent 1-second WAV to unlock the audio context on user interaction
                this.audioElement.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
                this.audioElement.play().catch(()=>{});
                this.audioUnlocked = true;
            }
        };

        // Connection Events
        this.els.connectBtn.addEventListener('click', () => { unlockAudio(); this.connectESP32(); });
        if (this.els.skipBtn) this.els.skipBtn.addEventListener('click', () => { unlockAudio(); this.skipESP32(); });
        this.els.disconnectBtn.addEventListener('click', () => this.disconnectESP32());
        this.els.espIpInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { unlockAudio(); this.connectESP32(); }
        });

        // Groq API Key change toggle
        if (this.els.changeApiKeyBtn) {
            this.els.changeApiKeyBtn.addEventListener('click', () => this.toggleApiKeyEdit());
        }

        // WiFi Setup Events
        if (this.els.wifiSetupToggle) {
            this.els.wifiSetupToggle.addEventListener('click', () => this.toggleWifiSetup());
        }
        if (this.els.wifiSendBtn) {
            this.els.wifiSendBtn.addEventListener('click', () => this.sendWifiCredentials());
        }

        // Chat Events
        this.els.sendBtn.addEventListener('click', () => { unlockAudio(); this.sendMessage(); });
        this.els.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); unlockAudio(); this.sendMessage(); }
        });

        // Stop
        this.els.stopBtn.addEventListener('click', () => this.stopResponse());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isProcessing) this.stopResponse();
        });

        // Voice
        this.els.voiceBtn.addEventListener('click', () => {
            unlockAudio();
            if (this.continuousListening) {
                this.continuousListening = false;
                this.stopRecording();
                this.toast('Continuous listening OFF', 'info');
            } else {
                this.continuousListening = true;
                this.startRecording();
                this.toast('Continuous listening ON', 'success');
            }
        });

        // TTS toggle
        this.els.ttsToggle.addEventListener('click', () => {
            this.ttsEnabled = !this.ttsEnabled;
            this.els.ttsToggle.classList.toggle('active', this.ttsEnabled);
            if (!this.ttsEnabled && this.audioElement) {
                this.audioElement.pause();
            }
            this.toast(this.ttsEnabled ? 'Voice replies ON' : 'Voice replies OFF', 'info');
        });

        // Training panel
        this.els.trainToggle.addEventListener('click', () => this.openTraining());
        this.els.closeTraining.addEventListener('click', () => this.closeTraining());
        this.els.overlay.addEventListener('click', () => this.closeTraining());
        this.els.addTraining.addEventListener('click', () => this.addTrainingData());

        // Quick actions & Test Buttons
        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.id === 'test-eyes-btn') {
                    this.toggleEyes();
                } else if (btn.id === 'test-mouth-btn') {
                    this.setMouthState(this.hardwareState.speaking === 1 ? 0 : 1);
                    this.toast(this.hardwareState.speaking === 1 ? 'Mouth Open' : 'Mouth Closed', 'info');
                } else {
                    this.els.userInput.value = btn.dataset.msg;
                    this.sendMessage();
                }
            });
        });

        // Reset
        this.els.resetBtn.addEventListener('click', () => this.resetChat());

        // Auto-resize
        this.els.userInput.addEventListener('input', () => this.autoResize());
    }

    autoResize() {
        const ta = this.els.userInput;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }

    /* ── Direct Serverless Chat ─────────────────────────── */
    getSimilarity(str1, str2) {
        const s1 = str1.toLowerCase().trim();
        const s2 = str2.toLowerCase().trim();
        if (s1 === s2) return 1.0;
        
        const words1 = new Set(s1.split(/\s+/));
        const words2 = new Set(s2.split(/\s+/));
        let intersection = 0;
        for (const w of words1) if (words2.has(w)) intersection++;
        
        return intersection / Math.max(words1.size, words2.size, 1);
    }

    findMatchingTraining(question) {
        const data = JSON.parse(localStorage.getItem('navis_training') || '[]');
        let bestMatch = null;
        let bestScore = 0;

        for (const qa of data) {
            const score = this.getSimilarity(question, qa.question);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = qa;
            }
        }

        // Threshold of 0.6 matches the Python logic roughly
        if (bestScore > 0.6 && bestMatch) {
            return bestMatch.answer;
        }
        return null;
    }

    async sendMessage() {
        const text = this.els.userInput.value.trim();
        if (!text || this.isProcessing) return;

        if (this.els.welcomeHero) {
            this.els.welcomeHero.style.display = 'none';
        }

        const selectedLang = this.getSelectedLang();

        this.addMessage(text, 'user');
        this.els.userInput.value = '';
        this.autoResize();
        this.isProcessing = true;

        this.showStopBtn();
        this.abortController = new AbortController();
        this.currentTypingEl = this.showTyping();

        try {
            // 1. Check local training data
            const trainedAnswer = this.findMatchingTraining(text);
            if (trainedAnswer) {
                if (this.currentTypingEl) this.currentTypingEl.remove();
                this.addMessage(trainedAnswer, 'navis', '🎓 Trained');
                this.isProcessing = false;
                this.speak(trainedAnswer, selectedLang);
                return;
            }

            // 2. Call Groq API Directly
            const langInstruction = LANG_INSTRUCTIONS[selectedLang] || '';
            const fullMessage = langInstruction ? `${langInstruction}\n${text}` : text;

            this.conversationHistory.push({ role: 'user', content: fullMessage });

            // Prepare API messages
            const apiMessages = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...this.conversationHistory
            ];

            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.groqKey}`
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: apiMessages,
                    temperature: 0.7,
                    max_tokens: 2048
                }),
                signal: this.abortController.signal
            });
            
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error?.message || 'API Error');
            }
            
            const data = await res.json();
            if (this.currentTypingEl) this.currentTypingEl.remove();

            const responseText = data.choices[0].message.content;
            this.conversationHistory.push({ role: 'assistant', content: responseText });

            // Keep memory manageable
            if (this.conversationHistory.length > 40) {
                this.conversationHistory = this.conversationHistory.slice(-40);
            }

            this.addMessage(responseText, 'navis', '✨ AI');
            this.isProcessing = false;
            
            this.speak(responseText, selectedLang);
        } catch (err) {
            if (this.currentTypingEl) this.currentTypingEl.remove();
            if (err.name !== 'AbortError') {
                this.addMessage(`Sorry, I encountered an error: ${err.message}`, 'navis', '⚠️ Error');
            }
            this.isProcessing = false;
            this.showSendBtn();
        }

        this.abortController = null;
        this.currentTypingEl = null;
    }

    stopResponse() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }

        this.isSpeaking = false;
        this.speechStopped = true;
        this.setMouthState(0);

        // Stop Web Speech API and all polling intervals
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        if (this._ttsKicker) { clearInterval(this._ttsKicker); this._ttsKicker = null; }
        this.stopSpeechPoller();
        this.stopJawKeepalive();

        // Stop fallback audio element
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.src = '';
        }

        if (this.currentTypingEl) {
            this.currentTypingEl.remove();
            this.currentTypingEl = null;
        }

        this.toast('🛑 Stopped', 'info');
        this.isProcessing = false;
        this.showSendBtn();

        if (this.continuousListening) {
            setTimeout(() => {
                if (this.continuousListening && !this.isProcessing && !this.isSpeaking && !this.isRecording) {
                    this.startRecording();
                }
            }, 500);
        }
    }

    addMessage(text, sender, sourceTag = '') {
        const div = document.createElement('div');
        div.className = `message ${sender}`;

        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        if (sender === 'navis') {
            avatar.innerHTML = '<img src="images/robomanthan_logo.png" onerror="this.outerHTML=\'N\'">';
        } else {
            avatar.textContent = 'You';
        }

        const bubble = document.createElement('div');
        bubble.className = 'bubble';

        if (sender === 'navis' && typeof marked !== 'undefined') {
            bubble.innerHTML = marked.parse(text);
        } else {
            bubble.textContent = text;
        }

        if (sourceTag) {
            const tag = document.createElement('span');
            tag.className = 'source-tag';
            tag.textContent = sourceTag;
            bubble.appendChild(tag);
        }

        div.appendChild(avatar);
        div.appendChild(bubble);
        this.els.messages.appendChild(div);
        this.scrollToBottom();
    }

    showTyping() {
        const div = document.createElement('div');
        div.className = 'message navis';
        div.innerHTML = `
            <div class="avatar"><img src="images/robomanthan_logo.png" onerror="this.outerHTML='N'"></div>
            <div class="bubble"><div class="typing-indicator">
                <div class="dot"></div><div class="dot"></div><div class="dot"></div>
            </div></div>`;
        this.els.messages.appendChild(div);
        this.scrollToBottom();
        return div;
    }

    scrollToBottom() {
        this.els.chatContainer.scrollTop = this.els.chatContainer.scrollHeight;
    }

    resetChat() {
        this.conversationHistory = [];
        this.els.messages.innerHTML = '';
        if (this.els.welcomeHero) {
            this.els.messages.appendChild(this.els.welcomeHero);
            this.els.welcomeHero.style.display = '';
        }
        this.toast('Chat reset', 'info');
    }

    /* ── Local Training Panel ───────────────────────────── */
    openTraining() {
        this.els.trainingPanel.classList.add('open');
        this.els.overlay.classList.add('active');
        this.loadTrainingData();
    }

    closeTraining() {
        this.els.trainingPanel.classList.remove('open');
        this.els.overlay.classList.remove('active');
    }

    loadTrainingData() {
        const data = JSON.parse(localStorage.getItem('navis_training') || '[]');
        this.renderTrainingList(data);
    }

    renderTrainingList(pairs) {
        if (!pairs.length) {
            this.els.trainingList.innerHTML = '<p class="training-empty" style="color:var(--text-3);text-align:center;">No custom training yet.<br>Add Q&A pairs above!</p>';
            return;
        }
        this.els.trainingList.innerHTML = pairs.map(qa => `
            <div class="training-item" style="background: rgba(255,255,255,0.05); padding: 10px; margin-bottom: 10px; border-radius: 8px;">
                <div class="ti-q" style="font-weight:bold; font-size: 0.9rem;">Q: ${this.esc(qa.question)}</div>
                <div class="ti-a" style="font-size: 0.85rem; color: var(--text-2); margin-top: 5px;">A: ${this.esc(qa.answer)}</div>
                <button class="ti-delete" data-id="${qa.id}" style="margin-top: 10px; background: none; border: none; color: var(--red); cursor: pointer; font-size: 0.8rem;">✕ Remove</button>
            </div>
        `).join('');

        this.els.trainingList.querySelectorAll('.ti-delete').forEach(btn => {
            btn.addEventListener('click', () => this.deleteTraining(btn.dataset.id));
        });
    }

    addTrainingData() {
        const q = this.els.trainQuestion.value.trim();
        const a = this.els.trainAnswer.value.trim();
        if (!q || !a) { this.toast('Fill in both fields', 'error'); return; }

        const data = JSON.parse(localStorage.getItem('navis_training') || '[]');
        data.push({ id: Date.now(), question: q, answer: a });
        localStorage.setItem('navis_training', JSON.stringify(data));
        
        this.els.trainQuestion.value = '';
        this.els.trainAnswer.value = '';
        this.toast('Training saved to phone!', 'success');
        this.loadTrainingData();
    }

    deleteTraining(id) {
        let data = JSON.parse(localStorage.getItem('navis_training') || '[]');
        data = data.filter(qa => qa.id != id);
        localStorage.setItem('navis_training', JSON.stringify(data));
        
        this.toast('Removed', 'info');
        this.loadTrainingData();
    }

    /* ── Utilities ──────────────────────────────────────── */
    esc(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    toast(msg, type = 'info') {
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        Object.assign(t.style, {
            padding: '12px 20px',
            background: type === 'error' ? '#ef4444' : type === 'success' ? '#34d399' : '#f7931e',
            color: '#fff',
            borderRadius: '8px',
            marginBottom: '10px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            animation: 'msgIn 0.3s ease-out'
        });
        t.textContent = msg;
        this.els.toastContainer.appendChild(t);
        Object.assign(this.els.toastContainer.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: '9999',
            display: 'flex',
            flexDirection: 'column'
        });
        setTimeout(() => t.remove(), 3200);
    }
}

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => window.navis = new NavisApp());
