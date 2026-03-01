import paho.mqtt.client as mqtt
import json
import time
from collections import deque
import numpy as np
import joblib
import pandas as pd

# ================= CONFIG =================
MQTT_BROKER   = "broker.hivemq.com"
MQTT_PORT     = 1883
MQTT_TOPIC_IN  = "esp32/rssi/data"               # Raw RSSI from ESP32
MQTT_TOPIC_OUT = "esp32/rssi/prediction"          # Prediction output for dashboard

MODEL_FILE    = "activity_classifier_rf.joblib"
SCALER_FILE   = "rssi_feature_scaler.joblib"

WINDOW_SEC    = 8.0                             # Same window size as training
SCAN_HZ       = 1.0                             # Your scan interval is ~1 Hz
BUFFER_SIZE   = int(WINDOW_SEC * SCAN_HZ) + 5   # Safety margin

# Load saved model & scaler
print("Loading model and scaler...")
clf   = joblib.load(MODEL_FILE)
scaler = joblib.load(SCALER_FILE)
print("Model loaded successfully")

# Rolling buffer: last N RSSI values
rssi_buffer = deque(maxlen=BUFFER_SIZE * 2)

def extract_features():
    if len(rssi_buffer) < BUFFER_SIZE:
        return None, None

    # Use last BUFFER_SIZE values
    recent = list(rssi_buffer)[-BUFFER_SIZE:]
    rssi_series = pd.Series(recent)

    feats = {
        'mean_rssi':   float(rssi_series.mean()),
        'std_rssi':    float(rssi_series.std()),
        'min_rssi':    float(rssi_series.min()),
        'max_rssi':    float(rssi_series.max()),
        'range_rssi':  float(rssi_series.max() - rssi_series.min()),
        'spike_count': int((abs(rssi_series - rssi_series.mean()) > 5).sum()),
        'spike_rate':  float((abs(rssi_series - rssi_series.mean()) > 5).mean() * 100),
    }
    return np.array([list(feats.values())]), feats

# MQTT callbacks
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"Connected to broker (rc={rc})")
        client.subscribe(MQTT_TOPIC_IN)
        print(f"Subscribed to topic: {MQTT_TOPIC_IN}")
        print(f"Publishing predictions to: {MQTT_TOPIC_OUT}")
    else:
        print(f"Connection failed with code {rc}")

def on_message(client, userdata, msg):
    try:
        payload = msg.payload.decode('utf-8')
        data = json.loads(payload)
        timestamp = data.get('timestamp', time.time() * 1000)
        rssi = data.get('rssi', -100)

        rssi_buffer.append(rssi)

        print(f"[{time.strftime('%H:%M:%S')}] RSSI: {rssi:4d} dBm | Buffer: {len(rssi_buffer)}/{BUFFER_SIZE}", end='\r')

        # Predict when we have enough data
        features, feats_dict = extract_features()
        if features is not None:
            features_scaled = scaler.transform(features)
            pred = clf.predict(features_scaled)[0]
            prob = clf.predict_proba(features_scaled)[0].max() * 100

            # Publish prediction to MQTT for the dashboard
            prediction_msg = json.dumps({
                "prediction": pred.upper(),
                "confidence": round(prob, 1),
                "features": {
                    "mean_rssi":   round(feats_dict['mean_rssi'], 1),
                    "std_rssi":    round(feats_dict['std_rssi'], 2),
                    "min_rssi":    round(feats_dict['min_rssi'], 1),
                    "max_rssi":    round(feats_dict['max_rssi'], 1),
                    "range_rssi":  round(feats_dict['range_rssi'], 1),
                    "spike_count": feats_dict['spike_count'],
                    "spike_rate":  round(feats_dict['spike_rate'], 1),
                }
            })
            client.publish(MQTT_TOPIC_OUT, prediction_msg)

            print(f"\n[{time.strftime('%H:%M:%S')}] Prediction: {pred.upper():8}  (confidence: {prob:5.1f}%)  [published]")

    except Exception as e:
        print(f"\nError processing message: {e}")

# Create client
client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

print("Connecting to MQTT broker...")
client.connect(MQTT_BROKER, MQTT_PORT, 60)

# Start loop
client.loop_forever()