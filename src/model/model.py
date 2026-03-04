"""
Machine learning models for Wi-Fi activity classification.

Trains and evaluates Logistic Regression and Random Forest classifiers
on sliding-window RSSI features.
"""

import numpy as np
import pandas as pd
import joblib
from pathlib import Path

from sklearn.model_selection import (
    StratifiedKFold,
    cross_val_predict,
    GroupKFold,
    LeaveOneGroupOut,
)
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)


FEATURE_COLUMNS = [
    "rssi_mean", "rssi_std", "rssi_min", "rssi_max", "rssi_range",
    "rssi_median", "rssi_iqr", "rssi_skewness", "rssi_kurtosis",
    "rssi_mean_abs_diff", "rssi_rate_mean", "rssi_rate_std", "rssi_rate_max",
    "rssi_energy", "rssi_zero_crossing_rate", "n_samples",
    "fft_peak", "fft_energy", "fft_entropy",
]

LABEL_ORDER = ["empty", "idle", "moving"]


def prepare_data(feature_df: pd.DataFrame):
    """
    Split feature DataFrame into X, y, and groups.

    Returns
    -------
    X : ndarray of shape (n_windows, n_features)
    y : ndarray of encoded labels
    groups : ndarray of source file names (for group-aware CV)
    label_encoder : fitted LabelEncoder
    scaler : fitted StandardScaler
    """
    X = feature_df[FEATURE_COLUMNS].values.astype(np.float64)
    le = LabelEncoder()
    le.fit(LABEL_ORDER)
    y = le.transform(feature_df["label"].values)
    groups = feature_df["source_file"].values

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    return X_scaled, y, groups, le, scaler


def train_and_evaluate(
    feature_df: pd.DataFrame,
    cv_mode: str = "group",
) -> dict:
    """
    Train models and evaluate using cross-validation.

    Parameters
    ----------
    feature_df : DataFrame from build_feature_dataset()
    cv_mode : 'group' for leave-one-file-out CV, 'stratified' for stratified k-fold

    Returns
    -------
    dict with keys: results, models, label_encoder, scaler, feature_df
    """
    X, y, groups, le, scaler = prepare_data(feature_df)

    models = {
        "Logistic Regression": LogisticRegression(
            max_iter=2000,
            solver="lbfgs",
            C=1.0,
            class_weight="balanced",
            random_state=42,
        ),
        "Random Forest": RandomForestClassifier(
            n_estimators=200,
            max_depth=None,
            min_samples_split=3,
            min_samples_leaf=1,
            class_weight="balanced",
            random_state=42,
            n_jobs=-1,
        ),
    }

    if cv_mode == "group":
        unique_groups = np.unique(groups)
        if len(unique_groups) >= 3:
            cv = LeaveOneGroupOut()
        else:
            cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
            groups = None
    else:
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        groups = None

    results = {}

    for name, model in models.items():
        print(f"\n{'='*60}")
        print(f"  Model: {name}")
        print(f"{'='*60}")

        if groups is not None:
            y_pred = cross_val_predict(model, X, y, cv=cv, groups=groups)
        else:
            y_pred = cross_val_predict(model, X, y, cv=cv)

        acc = accuracy_score(y, y_pred)
        f1 = f1_score(y, y_pred, average="weighted")
        cm = confusion_matrix(y, y_pred)
        report = classification_report(
            y, y_pred, target_names=le.classes_, output_dict=True
        )
        report_str = classification_report(y, y_pred, target_names=le.classes_)

        print(f"\n  Accuracy:    {acc:.4f}")
        print(f"  F1 (weighted): {f1:.4f}")
        print(f"\n{report_str}")

        results[name] = {
            "accuracy": acc,
            "f1_weighted": f1,
            "confusion_matrix": cm,
            "classification_report": report,
            "y_true": y,
            "y_pred": y_pred,
        }

    final_models = {}
    for name, model in models.items():
        model.fit(X, y)
        final_models[name] = model

    return {
        "results": results,
        "models": final_models,
        "label_encoder": le,
        "scaler": scaler,
        "feature_columns": FEATURE_COLUMNS,
        "feature_df": feature_df,
    }


def save_model(output: dict, save_dir: str = "saved_model"):
    """Save the best trained model, scaler, and label encoder."""
    save_path = Path(save_dir)
    save_path.mkdir(parents=True, exist_ok=True)

    best_name = max(
        output["results"],
        key=lambda k: output["results"][k]["f1_weighted"],
    )
    print(f"\nBest model: {best_name}")

    joblib.dump(output["models"][best_name], save_path / "model.joblib")
    joblib.dump(output["scaler"], save_path / "scaler.joblib")
    joblib.dump(output["label_encoder"], save_path / "label_encoder.joblib")
    joblib.dump(output["feature_columns"], save_path / "feature_columns.joblib")

    print(f"Model artifacts saved to {save_path}/")
    return save_path


def load_model(save_dir: str = "saved_model"):
    """Load a saved model for inference."""
    save_path = Path(save_dir)
    return {
        "model": joblib.load(save_path / "model.joblib"),
        "scaler": joblib.load(save_path / "scaler.joblib"),
        "label_encoder": joblib.load(save_path / "label_encoder.joblib"),
        "feature_columns": joblib.load(save_path / "feature_columns.joblib"),
    }


def predict_single_window(artifacts: dict, feature_dict: dict) -> str:
    """Run inference on a single feature vector."""
    X = np.array([[feature_dict[col] for col in artifacts["feature_columns"]]])
    X_scaled = artifacts["scaler"].transform(X)
    y_pred = artifacts["model"].predict(X_scaled)
    return artifacts["label_encoder"].inverse_transform(y_pred)[0]
