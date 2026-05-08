/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          NAVIS — Direct ESP32 WebSocket Controller           ║
 * ║          Robo Manthan Pvt. Ltd.                              ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Receives commands from Web App via WebSockets (Port 81)     ║
 * ║  Format:  eyes,speaking                                      ║
 * ║  Each value is 0 (closed/idle) or 1 (open/active)            ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

#include <ESP32Servo.h>
#include <WiFi.h>
#include <WebSocketsServer.h> // Install via Library Manager: "WebSockets" by Markus Sattler

// ── Linker Fix for ESP32 Core 3.x ─────────────────────────────
extern "C" bool btInUse() { return false; }

// ── WiFi Credentials ──────────────────────────────────────────
const char *ssid = "ACT_2.4G";
const char *password = "18001723";

WebSocketsServer webSocket = WebSocketsServer(81);

// ── Pin Definitions ───────────────────────────────────────────
#define PIN_MOUTH 18
#define PIN_EYES 12
#define PIN_LED 2

// ── Servo Angle Config ────────────────────────────────────────
#define MOUTH_OPEN 50  // degrees — jaw down
#define MOUTH_CLOSED 0 // degrees — jaw up / resting
#define EYES_OPEN 90   // degrees — eyelids raised
#define EYES_CLOSED 40 // degrees — eyelids lowered (blink/idle)

#define TIMEOUT_MS 5000

Servo mouthServo;
Servo eyesServo;

int lastEyes = -1;
int lastSpeaking = -1;
unsigned long lastPacketTime = 0;
bool connected = false;

// ── Animation Variables ───────────────────────────────────────
unsigned long talkStartTime = 0;
unsigned long lastMouthUpdate = 0;
bool mouthIsOpen = false;

void applyState(int eyes, int speaking) {
  if (speaking != lastSpeaking) {
    if (speaking == 1) {
      talkStartTime = millis();
    } else {
      mouthServo.write(MOUTH_CLOSED);
    }
    lastSpeaking = speaking;
  }
  if (eyes != lastEyes) {
    eyesServo.write(eyes ? EYES_OPEN : EYES_CLOSED);
    lastEyes = eyes;
  }
}

void resetServos() {
  mouthServo.write(MOUTH_CLOSED);
  eyesServo.write(EYES_OPEN);
  lastEyes = 1;
  lastSpeaking = 0;
}

int parseField(const String &str, int fieldIndex) {
  int commaCount = 0;
  int start = 0;
  for (int i = 0; i <= str.length(); i++) {
    if (i == str.length() || str[i] == ',') {
      if (commaCount == fieldIndex) {
        return str.substring(start, i).toInt();
      }
      commaCount++;
      start = i + 1;
    }
  }
  return -1;
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.printf("[%u] Disconnected!\n", num);
      break;
    case WStype_CONNECTED:
      {
        IPAddress ip = webSocket.remoteIP(num);
        Serial.printf("[%u] Connected from %d.%d.%d.%d\n", num, ip[0], ip[1], ip[2], ip[3]);
        connected = true;
        digitalWrite(PIN_LED, HIGH);
      }
      break;
    case WStype_TEXT:
      {
        String line = String((char *)payload);
        line.trim();
        Serial.printf("[%u] Received text: %s\n", num, line.c_str());
        
        int eyes = parseField(line, 0);
        int speaking = parseField(line, 1);
        
        if ((eyes == 0 || eyes == 1) && (speaking == 0 || speaking == 1)) {
          applyState(eyes, speaking);
          lastPacketTime = millis();
          if (!connected) {
            connected = true;
            digitalWrite(PIN_LED, HIGH);
          }
        }
      }
      break;
    case WStype_BIN:
    case WStype_ERROR:      
    case WStype_FRAGMENT_TEXT_START:
    case WStype_FRAGMENT_BIN_START:
    case WStype_FRAGMENT:
    case WStype_FRAGMENT_FIN:
      break;
  }
}

void setup() {
  Serial.begin(115200);

  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.printf("Connected! IP address: %s\n", WiFi.localIP().toString().c_str());

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.println("WebSocket server started on port 81");

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  mouthServo.attach(PIN_MOUTH, 500, 2400);
  eyesServo.attach(PIN_EYES, 500, 2400);
  resetServos();
  Serial.println("NAVIS ESP32 Ready — waiting for Web App...");
}

void loop() {
  webSocket.loop();

  if (connected && (millis() - lastPacketTime > TIMEOUT_MS)) {
    connected = false;
    digitalWrite(PIN_LED, LOW);
    resetServos();
    Serial.println("📡 Timeout: No commands received. Resetting to idle.");
  }

  // ── Mouth Animation Logic ─────────────────────────────────────
  if (lastSpeaking == 1) {
    if (millis() - lastMouthUpdate > 200) { // Toggle every 200ms
      lastMouthUpdate = millis();
      mouthIsOpen = !mouthIsOpen;
      mouthServo.write(mouthIsOpen ? MOUTH_OPEN : MOUTH_CLOSED);
    }
  }
}
