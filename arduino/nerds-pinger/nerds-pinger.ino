#include <WiFiS3.h>
#include <WiFiSSLClient.h>
#include <ArduinoHttpClient.h>
#include "arduino_secrets.h"

// Arduino UNO R4 WiFi: check adi.rest every 60 seconds and report to Nerds.
// Keep arduino_secrets.h local. Never commit Wi-Fi credentials or the device token.

const char TARGET_HOST[] = "adi.rest";
const char TARGET_PATH[] = "/";
const char REPORT_HOST[] = "ping.adi.rest";
const char REPORT_PATH[] = "/api/arduino";
const unsigned long CHECK_INTERVAL_MS = 60000;
const unsigned long REQUEST_TIMEOUT_MS = 10000;

unsigned long lastCheckAt = 0;

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.print("Connecting to Wi-Fi: ");
  Serial.println(SECRET_SSID);

  WiFi.begin(SECRET_SSID, SECRET_PASS);
  const unsigned long started = millis();

  while (WiFi.status() != WL_CONNECTED &&
         millis() - started < 15000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\nWi-Fi connection failed. Will retry.");
    return false;
  }

  Serial.println("\nWi-Fi connected.");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
  return true;
}

bool checkWebsite(int &statusCode, unsigned long &responseTimeMs) {
  WiFiSSLClient tlsClient;
  HttpClient http(tlsClient, TARGET_HOST, 443);
  http.setHttpResponseTimeout(REQUEST_TIMEOUT_MS);

  const unsigned long started = millis();
  const int requestResult = http.get(TARGET_PATH);

  int receivedStatus = 0;
  if (requestResult == HTTP_SUCCESS) {
    const int result = http.responseStatusCode();
    if (result > 0) receivedStatus = result;
  }

  responseTimeMs = millis() - started;
  http.stop();

  statusCode = receivedStatus;

  // Treat redirects as reachable. 4xx/5xx mean the endpoint responded,
  // but the monitored site is not considered healthy.
  return receivedStatus >= 200 && receivedStatus < 400;
}

bool reportToNerds(int statusCode, unsigned long responseTimeMs, bool success) {
  WiFiSSLClient tlsClient;
  HttpClient http(tlsClient, REPORT_HOST, 443);
  http.setHttpResponseTimeout(REQUEST_TIMEOUT_MS);

  String payload = "{\"statusCode\":";
  payload += String(statusCode);
  payload += ",\"responseTimeMs\":";
  payload += String(responseTimeMs);
  payload += ",\"success\":";
  payload += success ? "true" : "false";
  payload += "}";

  http.beginRequest();
  http.post(REPORT_PATH);
  http.sendHeader("X-Device-Token", SECRET_DEVICE_TOKEN);
  http.sendHeader("Content-Type", "application/json");
  http.sendHeader("Content-Length", payload.length());
  http.beginBody();
  http.print(payload);
  http.endRequest();

  const int responseCode = http.responseStatusCode();
  const String responseBody = responseCode > 0 ? http.responseBody() : "";
  http.stop();

  Serial.print("Nerds report HTTP: ");
  Serial.println(responseCode);

  if (responseBody.length()) {
    Serial.print("Nerds response: ");
    Serial.println(responseBody);
  }

  return responseCode >= 200 && responseCode < 300;
}

void runMonitoringCycle() {
  int statusCode = 0;
  unsigned long responseTimeMs = 0;

  const bool siteUp = checkWebsite(statusCode, responseTimeMs);

  Serial.print("adi.rest HTTP: ");
  Serial.println(statusCode);
  Serial.print("Response time: ");
  Serial.print(responseTimeMs);
  Serial.println(" ms");
  Serial.print("Website status: ");
  Serial.println(siteUp ? "UP" : "DOWN");

  if (!reportToNerds(statusCode, responseTimeMs, siteUp)) {
    Serial.println("Could not report to Nerds. It will retry next cycle.");
  }
}

void setup() {
  Serial.begin(115200);
  const unsigned long serialStarted = millis();
  while (!Serial && millis() - serialStarted < 3000) {
    delay(10);
  }

  Serial.println("\nNerds Arduino R4 WiFi pinger");
  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    delay(100);
    return;
  }

  const unsigned long now = millis();
  if (lastCheckAt == 0 || now - lastCheckAt >= CHECK_INTERVAL_MS) {
    lastCheckAt = now;
    runMonitoringCycle();
  }

  delay(50);
}
