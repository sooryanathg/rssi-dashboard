#!/usr/bin/env python3
"""
Live Activity Prediction via MQTT

Two-stage prediction system:
  Stage 1: Sliding-window ML classifier (Random Forest)
  Stage 2: Spike detector for brief movements
  + Temporal voting to stabilize empty vs idle
  + Publishes predictions to MQTT for the web dashboard

Usage:
    python live_predict.py
    python live_predict.py --broker broker.hivemq.com --topic esp32/rssi/data
    python live_predict.py --window-size 10 --vote-window 5
"""

import argparse
import json
import time
import threading
from collections import deque, Counter
from datetime import datetime

import numpy as np
import paho.mqtt.client as mqtt

from model.model import load_model
from model.feature_extraction import extract_window_features

ACTIVITY_DISPLAY = {
    "empty":  "🟢 EMPTY      — No one detected",
    "idle":   "🟡 IDLE       — Person present, stationary",
    "moving": "🔴 MOVING     — Active movement detected",
}

PREDICTION_TOPIC = "esp32/rssi/prediction"


class SpikeDetector:
    """
    Catches brief RSSI disturbances between consecutive samples.
    If the RSSI jumps by more than spike_threshold between two
    readings, overrides the prediction to 'moving' for holdoff_count
    prediction cycles.
    """

    def __init__(self, threshold: float = 8.0, holdoff: int = 3):
        self.threshold = threshold
        self.holdoff = holdoff
        self.prev_rssi = None
        self.remaining = 0
        self.spike_count = 0

    def check(self, rssi: int) -> bool:
        if self.prev_rssi is not None:
            if abs(rssi - self.prev_rssi) >= self.threshold:
                self.remaining = self.holdoff
                self.spike_count += 1
        self.prev_rssi = rssi

        if self.remaining > 0:
            self.remaining -= 1
            return True
        return False


class TemporalVoter:
    """
    Stabilizes predictions using majority vote over a rolling window.
    Prevents rapid flickering between empty and idle.
    """

    def __init__(self, vote_window: int = 5):
        self.history = deque(maxlen=vote_window)

    def vote(self, raw_label: str) -> str:
        self.history.append(raw_label)

        if len(self.history) < 2:
            return raw_label

        counts = Counter(self.history)
        winner = counts.most_common(1)[0][0]

        if raw_label == "moving":
            return "moving"

        return winner


class LivePredictor:
    """Real-time RSSI activity classifier with spike detection and temporal voting."""

    def __init__(
        self,
        model_dir: str,
        mqtt_client: mqtt.Client,
        window_size: int = 10,
        step_size: int = 1,
        spike_threshold: float = 8.0,
        spike_holdoff: int = 3,
        vote_window: int = 5,
    ):
        print(f"Loading model from {model_dir}...")
        self.artifacts = load_model(model_dir)
        self.mqtt_client = mqtt_client
        self.window_size = window_size
        self.step_size = step_size

        self.rssi_buffer = deque(maxlen=window_size * 3)
        self.time_buffer = deque(maxlen=window_size * 3)
        self.samples_since_predict = 0
        self.prediction_count = 0
        self.total_samples = 0
        self.lock = threading.Lock()

        self.spike = SpikeDetector(spike_threshold, spike_holdoff)
        self.voter = TemporalVoter(vote_window)

        self.last_prediction = None
        self.last_confidence = None
        self.start_time = time.time()

        print(f"Model loaded. Window: {window_size}, Step: {step_size}")
        print(f"Spike detector: threshold={spike_threshold} dBm, holdoff={spike_holdoff}")
        print(f"Temporal voter: window={vote_window} predictions")
        print(f"Publishing predictions to: {PREDICTION_TOPIC}")
        print(f"Features: {len(self.artifacts['feature_columns'])}")
        print(f"Classes: {list(self.artifacts['label_encoder'].classes_)}")

    def add_sample(self, timestamp_ms: int, rssi: int):
        spike_active = self.spike.check(rssi)
        self.total_samples += 1

        with self.lock:
            self.rssi_buffer.append(rssi)
            self.time_buffer.append(timestamp_ms / 1000.0)
            self.samples_since_predict += 1

        if len(self.rssi_buffer) >= self.window_size and \
           self.samples_since_predict >= self.step_size:
            self._predict(spike_active)
            self.samples_since_predict = 0

    def _predict(self, spike_active: bool = False):
        with self.lock:
            rssi_arr = np.array(list(self.rssi_buffer))[-self.window_size:]
            time_arr = np.array(list(self.time_buffer))[-self.window_size:]
            time_arr = time_arr - time_arr[0]

        features = extract_window_features(rssi_arr, time_arr)

        X = np.array([[features[col] for col in self.artifacts["feature_columns"]]])
        X_scaled = self.artifacts["scaler"].transform(X)

        prediction = self.artifacts["model"].predict(X_scaled)[0]
        raw_label = self.artifacts["label_encoder"].inverse_transform([prediction])[0]

        probabilities = None
        if hasattr(self.artifacts["model"], "predict_proba"):
            proba = self.artifacts["model"].predict_proba(X_scaled)[0]
            probabilities = dict(zip(
                [str(c) for c in self.artifacts["label_encoder"].classes_],
                [float(p) for p in proba],
            ))

        override_reason = None

        if spike_active and raw_label != "moving":
            raw_label = "moving"
            override_reason = "spike"

        final_label = self.voter.vote(raw_label)

        if override_reason is None and final_label != raw_label:
            override_reason = "vote"

        conf_pct = 0
        if probabilities and final_label in probabilities:
            conf_pct = round(probabilities[final_label] * 100)

        self.last_prediction = final_label
        self.last_confidence = probabilities
        self.prediction_count += 1

        elapsed = time.time() - self.start_time
        spike_rate = self.spike.spike_count / elapsed if elapsed > 0 else 0

        self._publish(final_label, conf_pct, rssi_arr, features, spike_rate)
        self._display(final_label, raw_label, probabilities, rssi_arr, override_reason)

    def _publish(
        self,
        label: str,
        confidence: int,
        rssi_window: np.ndarray,
        features: dict,
        spike_rate: float,
    ):
        """Publish prediction to MQTT for the web dashboard."""
        payload = {
            "prediction": label.upper(),
            "confidence": confidence,
            "features": {
                "mean_rssi": round(float(np.mean(rssi_window)), 1),
                "std_rssi": round(float(np.std(rssi_window)), 2),
                "min_rssi": int(np.min(rssi_window)),
                "max_rssi": int(np.max(rssi_window)),
                "range_rssi": int(np.ptp(rssi_window)),
                "spike_count": self.spike.spike_count,
                "spike_rate": f"{spike_rate:.2f}",
            },
        }
        self.mqtt_client.publish(PREDICTION_TOPIC, json.dumps(payload))

    def _display(
        self,
        final_label: str,
        raw_label: str,
        probabilities: dict,
        rssi_window: np.ndarray,
        override_reason: str,
    ):
        now = datetime.now().strftime("%H:%M:%S")
        display = ACTIVITY_DISPLAY.get(final_label, final_label)

        print(f"\n{'─' * 56}")
        print(f"  [{now}]  Prediction #{self.prediction_count}")
        print(f"  {display}")

        if override_reason == "spike":
            print(f"  ⚡ SPIKE — sudden RSSI jump detected")
        elif override_reason == "vote":
            print(f"  🗳️  VOTED — model said '{raw_label}', majority says '{final_label}'")

        print(f"  RSSI: mean={np.mean(rssi_window):.1f}  std={np.std(rssi_window):.1f}  "
              f"range={np.ptp(rssi_window)}")

        if probabilities:
            print(f"  Confidence (model):")
            for cls in ["empty", "idle", "moving"]:
                if cls in probabilities:
                    bar_len = int(probabilities[cls] * 30)
                    bar = "█" * bar_len + "░" * (30 - bar_len)
                    print(f"    {cls:>7s}: {bar} {probabilities[cls]:.1%}")

        vote_hist = list(self.voter.history)
        if len(vote_hist) > 1:
            counts = Counter(vote_hist)
            summary = ", ".join(f"{k}:{v}" for k, v in counts.most_common())
            print(f"  Vote history [{len(vote_hist)}]: {summary}")

        print(f"  → Published to {PREDICTION_TOPIC}")


def on_connect(client, userdata, flags, reason_code, properties):
    topic = userdata["topic"]
    print(f"\nConnected to MQTT broker (rc={reason_code})")
    print(f"Subscribing to: {topic}")
    print(f"Publishing to:  {PREDICTION_TOPIC}")
    client.subscribe(topic)
    print("\nWaiting for ESP32 data...\n")


def on_message(client, userdata, msg):
    predictor = userdata["predictor"]
    try:
        payload = json.loads(msg.payload.decode())
        timestamp_ms = int(payload.get("timestamp", 0))
        rssi = int(payload.get("rssi", -100))
        predictor.add_sample(timestamp_ms, rssi)
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        raw = msg.payload.decode().strip()
        parts = raw.split(",")
        if len(parts) == 2:
            try:
                timestamp_ms = int(parts[0])
                rssi = int(parts[1])
                predictor.add_sample(timestamp_ms, rssi)
                return
            except ValueError:
                pass
        print(f"  [WARN] Could not parse: {raw} ({e})")


def parse_args():
    p = argparse.ArgumentParser(description="Live Wi-Fi Activity Prediction")
    p.add_argument("--broker", default="broker.hivemq.com")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--topic", default="esp32/rssi/data")
    p.add_argument("--model-dir", default="model")
    p.add_argument("--window-size", type=int, default=10,
                   help="Samples per sliding window (default: 10)")
    p.add_argument("--step-size", type=int, default=1,
                   help="Samples between predictions (default: 1)")
    p.add_argument("--spike-threshold", type=float, default=8.0,
                   help="RSSI dBm jump to trigger spike (default: 8.0)")
    p.add_argument("--spike-holdoff", type=int, default=3,
                   help="Predictions to hold moving after spike (default: 3)")
    p.add_argument("--vote-window", type=int, default=5,
                   help="Rolling vote window size (default: 5)")
    return p.parse_args()


def main():
    args = parse_args()

    print("=" * 56)
    print("  Wi-Fi Indoor Activity — Live Prediction")
    print("=" * 56)
    print(f"  Broker:  {args.broker}:{args.port}")
    print(f"  Subscribe: {args.topic}")
    print(f"  Publish:   {PREDICTION_TOPIC}")
    print(f"  Model:   {args.model_dir}")
    print(f"  Window:  {args.window_size} samples, step {args.step_size}")
    print(f"  Vote:    {args.vote_window} predictions")
    print(f"  Spike:   {args.spike_threshold} dBm, holdoff {args.spike_holdoff}")
    print("=" * 56)

    mqttc = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"wifi_sense_{int(time.time())}",
    )

    predictor = LivePredictor(
        model_dir=args.model_dir,
        mqtt_client=mqttc,
        window_size=args.window_size,
        step_size=args.step_size,
        spike_threshold=args.spike_threshold,
        spike_holdoff=args.spike_holdoff,
        vote_window=args.vote_window,
    )

    mqttc.user_data_set({"predictor": predictor, "topic": args.topic})
    mqttc.on_connect = on_connect
    mqttc.on_message = on_message

    print(f"\nConnecting to {args.broker}:{args.port}...")
    mqttc.connect(args.broker, args.port, keepalive=60)

    try:
        mqttc.loop_forever()
    except KeyboardInterrupt:
        print(f"\n\nStopped. Total predictions: {predictor.prediction_count}")
        mqttc.disconnect()


if __name__ == "__main__":
    main()
