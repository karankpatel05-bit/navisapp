document.addEventListener('DOMContentLoaded', () => {
  const ipInput = document.getElementById('esp-ip');
  const connectBtn = document.getElementById('connect-btn');
  const statusBadge = document.getElementById('status-badge');
  const toggleEyesBtn = document.getElementById('toggle-eyes-btn');
  const ttsInput = document.getElementById('tts-input');
  const speakBtn = document.getElementById('speak-btn');
  const mouthStateLabel = document.getElementById('mouth-state-label');

  let ws = null;
  let isConnected = false;

  // Bot State
  let state = {
    eyes: 1, // 1 = open, 0 = closed
    speaking: 0 // 1 = speaking, 0 = idle
  };

  // Check saved IP
  const savedIP = localStorage.getItem('esp32_ip');
  if (savedIP) {
    ipInput.value = savedIP;
  }

  function updateStatus(connected) {
    isConnected = connected;
    if (connected) {
      statusBadge.textContent = 'Connected';
      statusBadge.className = 'badge connected';
      connectBtn.textContent = 'Disconnect';
      connectBtn.classList.replace('primary', 'danger');
      speakBtn.disabled = false;
    } else {
      statusBadge.textContent = 'Disconnected';
      statusBadge.className = 'badge disconnected';
      connectBtn.textContent = 'Connect';
      connectBtn.classList.replace('danger', 'primary');
      speakBtn.disabled = true;
    }
  }

  function sendState() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const payload = `${state.eyes},${state.speaking}`;
      ws.send(payload);
      console.log('Sent:', payload);
    }
  }

  connectBtn.addEventListener('click', () => {
    if (isConnected) {
      if (ws) ws.close();
      return;
    }

    let ip = ipInput.value.trim();
    if (!ip) {
      alert('Please enter a valid IP address');
      return;
    }

    // Auto-prefix ws:// if missing
    if (!ip.startsWith('ws://')) {
      ip = `ws://${ip}:81/`;
    }

    localStorage.setItem('esp32_ip', ipInput.value.trim());
    statusBadge.textContent = 'Connecting...';
    
    ws = new WebSocket(ip);

    ws.onopen = () => {
      console.log('WebSocket Connected');
      updateStatus(true);
      sendState(); // send initial state
    };

    ws.onclose = () => {
      console.log('WebSocket Disconnected');
      updateStatus(false);
      ws = null;
    };

    ws.onerror = (error) => {
      console.error('WebSocket Error:', error);
      updateStatus(false);
    };
  });

  // Toggle Eyes
  toggleEyesBtn.addEventListener('click', () => {
    state.eyes = state.eyes === 1 ? 0 : 1;
    toggleEyesBtn.textContent = state.eyes === 1 ? 'Close Eyes' : 'Open Eyes';
    toggleEyesBtn.style.background = state.eyes === 1 ? 'rgba(255, 255, 255, 0.1)' : 'rgba(59, 130, 246, 0.2)';
    sendState();
  });

  // Text to Speech
  const synth = window.speechSynthesis;

  speakBtn.addEventListener('click', () => {
    const text = ttsInput.value.trim();
    if (!text) return;

    if (synth.speaking) {
      console.error('speechSynthesis.speaking');
      return;
    }

    const utterThis = new SpeechSynthesisUtterance(text);
    
    // Set state to speaking when TTS starts
    utterThis.onstart = () => {
      state.speaking = 1;
      sendState();
      mouthStateLabel.textContent = 'Talking...';
      mouthStateLabel.classList.add('pulse');
      speakBtn.disabled = true;
    };

    // Set state to idle when TTS ends
    utterThis.onend = () => {
      state.speaking = 0;
      sendState();
      mouthStateLabel.textContent = 'Idle';
      mouthStateLabel.classList.remove('pulse');
      speakBtn.disabled = false;
    };

    utterThis.onerror = (event) => {
      console.error('SpeechSynthesisUtterance.onerror', event);
      state.speaking = 0;
      sendState();
      mouthStateLabel.textContent = 'Error';
      mouthStateLabel.classList.remove('pulse');
      speakBtn.disabled = false;
    };

    synth.speak(utterThis);
  });

  // Ensure eyes button is in sync on load
  toggleEyesBtn.textContent = state.eyes === 1 ? 'Close Eyes' : 'Open Eyes';
});
