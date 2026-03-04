"""
Sliding-window feature extraction for RSSI time-series data.

Extracts statistical features from fixed-length windows of RSSI values
to create feature vectors suitable for machine learning classifiers.
"""

import numpy as np
import pandas as pd


def extract_window_features(rssi_values: np.ndarray, elapsed: np.ndarray) -> dict:
    """
    Extract features from a single window of RSSI samples.

    Parameters
    ----------
    rssi_values : array of RSSI (dBm) values in the window
    elapsed : array of elapsed time (seconds) for each sample

    Returns
    -------
    dict of feature name -> value
    """
    n = len(rssi_values)
    if n == 0:
        return {}

    dt = np.diff(elapsed)
    d_rssi = np.diff(rssi_values)

    rates = d_rssi / np.where(dt > 0, dt, 1e-6)

    features = {
        "rssi_mean": np.mean(rssi_values),
        "rssi_std": np.std(rssi_values),
        "rssi_min": np.min(rssi_values),
        "rssi_max": np.max(rssi_values),
        "rssi_range": np.ptp(rssi_values),
        "rssi_median": np.median(rssi_values),
        "rssi_iqr": np.percentile(rssi_values, 75) - np.percentile(rssi_values, 25),
        "rssi_skewness": _safe_skewness(rssi_values),
        "rssi_kurtosis": _safe_kurtosis(rssi_values),
        "rssi_mean_abs_diff": np.mean(np.abs(d_rssi)) if len(d_rssi) > 0 else 0,
        "rssi_rate_mean": np.mean(rates) if len(rates) > 0 else 0,
        "rssi_rate_std": np.std(rates) if len(rates) > 0 else 0,
        "rssi_rate_max": np.max(np.abs(rates)) if len(rates) > 0 else 0,
        "rssi_energy": np.sum(rssi_values ** 2) / n,
        "rssi_zero_crossing_rate": _zero_crossing_rate(rssi_values - np.mean(rssi_values)),
        "n_samples": n,
    }

    if n >= 4:
        fft_vals = np.abs(np.fft.rfft(rssi_values - np.mean(rssi_values)))
        features["fft_peak"] = np.max(fft_vals[1:]) if len(fft_vals) > 1 else 0
        features["fft_energy"] = np.sum(fft_vals[1:] ** 2) if len(fft_vals) > 1 else 0
        features["fft_entropy"] = _spectral_entropy(fft_vals[1:]) if len(fft_vals) > 1 else 0
    else:
        features["fft_peak"] = 0
        features["fft_energy"] = 0
        features["fft_entropy"] = 0

    return features


def _safe_skewness(x: np.ndarray) -> float:
    n = len(x)
    if n < 3:
        return 0.0
    mean = np.mean(x)
    std = np.std(x)
    if std == 0:
        return 0.0
    return np.mean(((x - mean) / std) ** 3)


def _safe_kurtosis(x: np.ndarray) -> float:
    n = len(x)
    if n < 4:
        return 0.0
    mean = np.mean(x)
    std = np.std(x)
    if std == 0:
        return 0.0
    return np.mean(((x - mean) / std) ** 4) - 3.0


def _zero_crossing_rate(x: np.ndarray) -> float:
    if len(x) < 2:
        return 0.0
    signs = np.sign(x)
    signs[signs == 0] = 1
    crossings = np.sum(np.abs(np.diff(signs)) > 0)
    return crossings / (len(x) - 1)


def _spectral_entropy(magnitudes: np.ndarray) -> float:
    power = magnitudes ** 2
    total = np.sum(power)
    if total == 0:
        return 0.0
    prob = power / total
    prob = prob[prob > 0]
    return -np.sum(prob * np.log2(prob))


def create_sliding_windows(
    df: pd.DataFrame,
    window_size: int = 5,
    step_size: int = 2,
) -> pd.DataFrame:
    """
    Apply sliding-window feature extraction to a single file/session.

    Parameters
    ----------
    df : DataFrame with columns [rssi, elapsed_sec, label]
    window_size : number of samples per window
    step_size : number of samples to advance between windows

    Returns
    -------
    DataFrame where each row is a feature vector with its label
    """
    rssi = df["rssi"].values
    elapsed = df["elapsed_sec"].values
    label = df["label"].iloc[0]
    source_file = df["file"].iloc[0] if "file" in df.columns else "unknown"

    feature_rows = []
    n = len(rssi)

    for start in range(0, n - window_size + 1, step_size):
        end = start + window_size
        window_rssi = rssi[start:end]
        window_elapsed = elapsed[start:end]

        features = extract_window_features(window_rssi, window_elapsed)
        features["label"] = label
        features["source_file"] = source_file
        features["window_start_idx"] = start
        features["window_center_time"] = np.mean(window_elapsed)
        feature_rows.append(features)

    return pd.DataFrame(feature_rows)


def build_feature_dataset(
    full_df: pd.DataFrame,
    window_size: int = 5,
    step_size: int = 2,
) -> pd.DataFrame:
    """
    Build the complete feature dataset from all loaded sessions.

    Groups data by source file, applies sliding windows to each,
    then concatenates all feature vectors.
    """
    all_features = []

    for filename, group_df in full_df.groupby("file"):
        group_df = group_df.sort_values("elapsed_sec").reset_index(drop=True)
        feat_df = create_sliding_windows(group_df, window_size, step_size)
        all_features.append(feat_df)
        print(f"  {filename}: {len(feat_df)} windows")

    dataset = pd.concat(all_features, ignore_index=True)
    print(f"\nTotal feature vectors: {len(dataset)}")
    print(f"Label distribution:\n{dataset['label'].value_counts().to_string()}")
    return dataset
