"""
Data loader for ESP32 Wi-Fi RSSI capture files.

Parses Arduino Serial Monitor output with format:
    HH:MM:SS.mmm -> counter,RSSI
"""

import os
import re
from pathlib import Path
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

LINE_PATTERN = re.compile(
    r"(\d{2}:\d{2}:\d{2}\.\d{3})\s*->\s*(-?\d+),\s*(-?\d+)"
)

LABEL_MAP = {
    "empty": "empty",
    "empty2": "empty",
    "empty3": "empty",
    "emptyx": "empty",
    "idle": "idle",
    "idle 1": "idle",
    "idle 2": "idle",
    "idlex": "idle",
    "moving": "moving",
    "moving 1": "moving",
    "moving 2": "moving",
    "moving 3": "moving",
    "movingx": "moving",
}


def _parse_timestamp(ts_str: str) -> float:
    """Convert HH:MM:SS.mmm to seconds since midnight."""
    h, m, rest = ts_str.split(":")
    s, ms = rest.split(".")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


def parse_file(filepath: str) -> pd.DataFrame:
    """Parse a single ESP32 capture file into a DataFrame."""
    rows = []
    with open(filepath, "r") as f:
        for line in f:
            match = LINE_PATTERN.match(line.strip())
            if match:
                ts_str, counter, rssi = match.groups()
                rows.append({
                    "timestamp_str": ts_str,
                    "time_sec": _parse_timestamp(ts_str),
                    "counter": int(counter),
                    "rssi": int(rssi),
                })

    df = pd.DataFrame(rows)
    if not df.empty:
        df["elapsed_sec"] = df["time_sec"] - df["time_sec"].iloc[0]
    return df


def load_all_data(data_dir: str) -> pd.DataFrame:
    """
    Load all .txt capture files from a directory.

    Returns a DataFrame with columns:
        [timestamp_str, time_sec, counter, rssi, elapsed_sec, file, label]
    """
    all_frames = []

    for filename in sorted(os.listdir(data_dir)):
        if not filename.endswith(".txt"):
            continue

        stem = Path(filename).stem
        label = LABEL_MAP.get(stem)
        if label is None:
            continue

        filepath = os.path.join(data_dir, filename)
        df = parse_file(filepath)

        if df.empty:
            print(f"  [WARN] No valid data in {filename}")
            continue

        df["file"] = filename
        df["label"] = label
        all_frames.append(df)
        print(f"  Loaded {filename}: {len(df)} samples, label='{label}'")

    if not all_frames:
        raise ValueError(f"No valid data files found in {data_dir}")

    combined = pd.concat(all_frames, ignore_index=True)
    print(f"\nTotal samples loaded: {len(combined)}")
    print(f"Label distribution:\n{combined['label'].value_counts().to_string()}")
    return combined


def get_file_groups(df: pd.DataFrame) -> dict:
    """Group data by source file for per-session processing."""
    return {name: group.reset_index(drop=True) for name, group in df.groupby("file")}
