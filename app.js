/* ═══════════════════════════════════════════════════════════
   NAVIS AI – Unified ESP32 Controller & Chatbot
   ═══════════════════════════════════════════════════════════ */

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
            llmUrlInput: document.getElementById('llm-url'),
            connectBtn: document.getElementById('connect-btn'),
            disconnectBtn: document.getElementById('disconnect-btn'),
            connectionStatus: document.getElementById('connection-status'),
            
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

        // Hardware State
        this.ws = null;
        this.isConnected = false;
        this.hardwareState = {
            eyes: 1, // 1 = open, 0 = closed
            speaking: 0 // 1 = speaking, 0 = idle
        };
        this.llmUrl = 'http://127.0.0.1:5000/api/chat';

        this.init();
    }

    init() {
        this.loadSavedSettings();
        this.initSpeechRecognition();
        this.initTTS();
        this.bindEvents();
        // Load training data will happen after LLM URL is confirmed or lazily
        this.autoResize();
        
        if (this.els.ttsToggle) this.els.ttsToggle.classList.add('active');
        if (typeof marked !== 'undefined') {
            marked.setOptions({ breaks: true, gfm: true });
        }
    }

    loadSavedSettings() {
        const savedIP = localStorage.getItem('esp32_ip');
        if (savedIP) this.els.espIpInput.value = savedIP;

        const savedLLM = localStorage.getItem('llm_url');
        if (savedLLM) this.els.llmUrlInput.value = savedLLM;
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

        let llm = this.els.llmUrlInput.value.trim();
        if (llm) {
            this.llmUrl = llm;
            localStorage.setItem('llm_url', llm);
        }

        localStorage.setItem('esp32_ip', this.els.espIpInput.value.trim());
        
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
            this.showConnectionError('Invalid IP address format.');
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

    /* ── TTS Init (cross-platform voice loading) ────────── */
    initTTS() {
        if (!window.speechSynthesis) return;
        const loadVoices = () => {
            this.voices = window.speechSynthesis.getVoices();
            if (this.voices.length) this.voicesLoaded = true;
        };
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;
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

    startRecording() {
        if (!this.recognition) { this.toast('Voice not supported in this browser', 'error'); return; }
        if (this.isRecording) return;
        this.isRecording = true;
        this.els.voiceBtn.classList.add('recording');
        this.els.userInput.placeholder = 'Listening...';
        try { this.recognition.start(); } catch (e) { }
    }

    stopRecording() {
        if (!this.isRecording) return;
        this.isRecording = false;
        this.els.voiceBtn.classList.remove('recording');
        this.els.userInput.placeholder = 'Ask Navis anything...';
        try { this.recognition.stop(); } catch (e) { }
    }

    /* ── Text-to-Speech (always on, cross-platform) ────── */
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

    speak(text, langHint) {
        if (!this.ttsEnabled || !window.speechSynthesis) {
            this.onSpeechDone();
            return;
        }
        window.speechSynthesis.cancel();
        
        const clean = text
            .replace(/```[\s\S]*?```/g, ' code block ')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/#{1,6}\s*/g, '')
            .replace(/[*_~]{1,3}/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/[>[\]()]/g, '')
            .replace(/\n+/g, '. ')
            .replace(/\.\s*\./g, '.')
            .trim();

        if (!clean) { this.onSpeechDone(); return; }

        this.isSpeaking = true;
        this.speechStopped = false;
        this.showStopBtn();
        
        // Signal ESP32: mouth OPEN
        this.setMouthState(1);

        const utt = new SpeechSynthesisUtterance(clean);
        utt.rate = 0.95;
        utt.pitch = 1;

        const detectedLang = this.detectLanguage(clean);
        const lang = langHint || detectedLang || this.getSelectedLang();
        const isHindi = lang.startsWith('hi');
        const isKannada = lang.startsWith('kn');

        const voices = this.voices || window.speechSynthesis.getVoices();
        const isFemale = (v) => /Female|Samantha|Zira|Veena|Heera|Neerja|Victoria|Karen|Moira|Tessa|Luciana|Monica|Lekha|Flo|Grandma|Kathy/i.test(v.name);

        let preferred;
        if (isHindi) {
            preferred = voices.find(v => v.name.includes('Google हिन्दी'))
                || voices.find(v => v.name.includes('Microsoft Hemant'))
                || voices.find(v => v.lang.startsWith('hi') && !isFemale(v))
                || voices.find(v => v.lang.startsWith('hi'))
                || voices.find(v => v.name.includes('Rishi'))
                || voices[0];
            utt.lang = 'hi-IN';
        } else if (isKannada) {
            preferred = voices.find(v => v.name.includes('Soumya'))
                || voices.find(v => v.lang.startsWith('kn'))
                || voices[0];
            utt.lang = 'kn-IN';
        } else {
            preferred = voices.find(v => v.name === 'Rishi')
                || voices.find(v => v.name === 'Ravi')
                || voices.find(v => v.name === 'Microsoft Ravi')
                || voices.find(v => v.name === 'Google UK English Male')
                || voices.find(v => v.name === 'Daniel')
                || voices.find(v => v.lang === 'en-IN' && !isFemale(v))
                || voices.find(v => v.lang.startsWith('en') && !isFemale(v))
                || voices[0];
            utt.lang = 'en-IN';
        }

        if (preferred) utt.voice = preferred;

        if (clean.length > 200) {
            this.speakChunked(clean, utt.rate, utt.pitch, preferred, utt.lang);
        } else {
            utt.onend = () => this.onSpeechDone();
            utt.onerror = () => this.onSpeechDone();
            window.speechSynthesis.speak(utt);
        }
    }

    speakChunked(text, rate, pitch, voice, lang) {
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        let i = 0;
        const speakNext = () => {
            if (this.speechStopped || i >= sentences.length) { this.onSpeechDone(); return; }
            const utt = new SpeechSynthesisUtterance(sentences[i].trim());
            utt.rate = rate;
            utt.pitch = pitch;
            if (voice) utt.voice = voice;
            if (lang) utt.lang = lang;
            utt.onend = () => { i++; speakNext(); };
            utt.onerror = () => { i++; speakNext(); };
            window.speechSynthesis.speak(utt);
        };
        speakNext();
    }

    onSpeechDone() {
        this.isSpeaking = false;
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
        // Connection Events
        this.els.connectBtn.addEventListener('click', () => this.connectESP32());
        this.els.disconnectBtn.addEventListener('click', () => this.disconnectESP32());
        this.els.espIpInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.connectESP32();
        });

        // Chat Events
        this.els.sendBtn.addEventListener('click', () => this.sendMessage());
        this.els.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
        });

        // Stop
        this.els.stopBtn.addEventListener('click', () => this.stopResponse());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isProcessing) this.stopResponse();
        });

        // Voice
        this.els.voiceBtn.addEventListener('click', () => {
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
            if (!this.ttsEnabled) window.speechSynthesis?.cancel();
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

    /* ── Chat ───────────────────────────────────────────── */
    getApiUrl(endpoint) {
        // Build URL ensuring no double slashes
        const base = this.llmUrl.replace(/\/api\/chat\/?$/, '').replace(/\/$/, '');
        return `${base}${endpoint}`;
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
            const res = await fetch(this.llmUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, lang: selectedLang }),
                signal: this.abortController.signal
            });
            
            if (!res.ok) throw new Error('API Error');
            
            const data = await res.json();
            if (this.currentTypingEl) this.currentTypingEl.remove();

            const sourceLabel = data.source === 'trained' ? '🎓 Trained' : data.source === 'ai' ? '✨ AI' : '';
            this.addMessage(data.response, 'navis', sourceLabel);
            this.isProcessing = false;
            
            this.speak(data.response, data.lang || selectedLang);
        } catch (err) {
            if (this.currentTypingEl) this.currentTypingEl.remove();
            if (err.name !== 'AbortError') {
                this.addMessage('Sorry, I couldn\'t process that. Check if the LLM backend is running and CORS is enabled.', 'navis', '⚠️ Error');
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

        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
            window.speechSynthesis.cancel();
            setTimeout(() => {
                if (window.speechSynthesis.speaking) {
                    window.speechSynthesis.cancel();
                }
            }, 100);
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

    async resetChat() {
        try { await fetch(this.getApiUrl('/api/reset'), { method: 'POST' }); } catch (e) { }
        this.els.messages.innerHTML = '';
        if (this.els.welcomeHero) {
            this.els.messages.appendChild(this.els.welcomeHero);
            this.els.welcomeHero.style.display = '';
        }
        this.toast('Chat reset', 'info');
    }

    /* ── Training Panel ─────────────────────────────────── */
    openTraining() {
        this.els.trainingPanel.classList.add('open');
        this.els.overlay.classList.add('active');
        this.loadTrainingData();
    }

    closeTraining() {
        this.els.trainingPanel.classList.remove('open');
        this.els.overlay.classList.remove('active');
    }

    async loadTrainingData() {
        try {
            const res = await fetch(this.getApiUrl('/api/training-data'));
            if (!res.ok) throw new Error('API Error');
            const data = await res.json();
            this.renderTrainingList(data.qa_pairs || []);
        } catch (e) {
            this.els.trainingList.innerHTML = '<p class="training-empty" style="color:var(--text-3);text-align:center;">Could not load data from LLM backend</p>';
        }
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

    async addTrainingData() {
        const q = this.els.trainQuestion.value.trim();
        const a = this.els.trainAnswer.value.trim();
        if (!q || !a) { this.toast('Fill in both fields', 'error'); return; }

        try {
            const res = await fetch(this.getApiUrl('/api/train'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: q, answer: a })
            });
            if (res.ok) {
                this.els.trainQuestion.value = '';
                this.els.trainAnswer.value = '';
                this.toast('Training added!', 'success');
                this.loadTrainingData();
            }
        } catch (e) { this.toast('Failed to add. Check backend.', 'error'); }
    }

    async deleteTraining(id) {
        try {
            await fetch(this.getApiUrl(`/api/training-data/${id}`), { method: 'DELETE' });
            this.toast('Removed', 'info');
            this.loadTrainingData();
        } catch (e) { }
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
        // Simple inline styles for toast since we might not have all navis CSS ported perfectly
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
        // Ensure container is styled and positioned
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
