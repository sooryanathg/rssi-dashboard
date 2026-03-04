"""
Visualization module for Wi-Fi sensing analysis.

Generates plots for raw RSSI signals, feature distributions,
confusion matrices, and model comparison charts.
"""

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path

COLOR_MAP = {"empty": "#2196F3", "idle": "#FF9800", "moving": "#F44336"}
LABEL_ORDER = ["empty", "idle", "moving"]


def setup_style():
    plt.rcParams.update({
        "figure.figsize": (12, 6),
        "figure.dpi": 120,
        "axes.grid": True,
        "grid.alpha": 0.3,
        "font.size": 11,
    })
    sns.set_palette("Set2")


def plot_raw_rssi(full_df: pd.DataFrame, output_dir: str = "plots"):
    """Plot raw RSSI time-series for each file, colored by label."""
    setup_style()
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    fig, axes = plt.subplots(2, 1, figsize=(14, 8))

    for label in LABEL_ORDER:
        subset = full_df[full_df["label"] == label]
        for filename, file_df in subset.groupby("file"):
            axes[0].plot(
                file_df["elapsed_sec"],
                file_df["rssi"],
                alpha=0.6,
                label=f"{filename}",
                linewidth=0.8,
            )

    axes[0].set_xlabel("Elapsed Time (s)")
    axes[0].set_ylabel("RSSI (dBm)")
    axes[0].set_title("Raw RSSI Time-Series by File")
    axes[0].legend(fontsize=7, ncol=3, loc="lower left")

    for label in LABEL_ORDER:
        subset = full_df[full_df["label"] == label]
        axes[1].hist(
            subset["rssi"],
            bins=30,
            alpha=0.5,
            label=label,
            color=COLOR_MAP[label],
            density=True,
        )
    axes[1].set_xlabel("RSSI (dBm)")
    axes[1].set_ylabel("Density")
    axes[1].set_title("RSSI Distribution by Activity Class")
    axes[1].legend()

    plt.tight_layout()
    fig.savefig(f"{output_dir}/01_raw_rssi.png", bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved {output_dir}/01_raw_rssi.png")


def plot_feature_distributions(feature_df: pd.DataFrame, output_dir: str = "plots"):
    """Box plots of key features grouped by label."""
    setup_style()
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    key_features = [
        "rssi_mean", "rssi_std", "rssi_range", "rssi_mean_abs_diff",
        "rssi_rate_std", "fft_energy",
    ]

    available = [f for f in key_features if f in feature_df.columns]
    n = len(available)
    cols = 3
    rows = (n + cols - 1) // cols

    fig, axes = plt.subplots(rows, cols, figsize=(14, 4 * rows))
    axes = axes.flatten()

    for i, feat in enumerate(available):
        sns.boxplot(
            data=feature_df,
            x="label",
            y=feat,
            hue="label",
            order=LABEL_ORDER,
            hue_order=LABEL_ORDER,
            palette=COLOR_MAP,
            legend=False,
            ax=axes[i],
        )
        axes[i].set_title(feat)
        axes[i].set_xlabel("")

    for j in range(i + 1, len(axes)):
        axes[j].set_visible(False)

    plt.suptitle("Feature Distributions by Activity Class", fontsize=14, y=1.02)
    plt.tight_layout()
    fig.savefig(f"{output_dir}/02_feature_distributions.png", bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved {output_dir}/02_feature_distributions.png")


def plot_confusion_matrices(results: dict, label_names: list, output_dir: str = "plots"):
    """Plot confusion matrices for all evaluated models."""
    setup_style()
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    n_models = len(results)
    fig, axes = plt.subplots(1, n_models, figsize=(7 * n_models, 5))
    if n_models == 1:
        axes = [axes]

    for ax, (name, res) in zip(axes, results.items()):
        cm = res["confusion_matrix"]
        cm_pct = cm.astype(float) / cm.sum(axis=1, keepdims=True) * 100

        sns.heatmap(
            cm_pct,
            annot=True,
            fmt=".1f",
            cmap="Blues",
            xticklabels=label_names,
            yticklabels=label_names,
            ax=ax,
            vmin=0,
            vmax=100,
            cbar_kws={"label": "% of True Class"},
        )
        ax.set_xlabel("Predicted")
        ax.set_ylabel("True")
        ax.set_title(f"{name}\nAccuracy: {res['accuracy']:.2%}")

        for i in range(len(cm)):
            for j in range(len(cm)):
                ax.text(
                    j + 0.5, i + 0.72,
                    f"(n={cm[i, j]})",
                    ha="center", va="center",
                    fontsize=8, color="gray",
                )

    plt.suptitle("Confusion Matrices (% of True Class)", fontsize=14)
    plt.tight_layout()
    fig.savefig(f"{output_dir}/03_confusion_matrices.png", bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved {output_dir}/03_confusion_matrices.png")


def plot_model_comparison(results: dict, output_dir: str = "plots"):
    """Bar chart comparing model accuracy and F1 scores."""
    setup_style()
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    model_names = list(results.keys())
    accuracies = [results[n]["accuracy"] for n in model_names]
    f1_scores = [results[n]["f1_weighted"] for n in model_names]

    x = np.arange(len(model_names))
    width = 0.3

    fig, ax = plt.subplots(figsize=(8, 5))
    bars1 = ax.bar(x - width / 2, accuracies, width, label="Accuracy", color="#2196F3")
    bars2 = ax.bar(x + width / 2, f1_scores, width, label="F1 (weighted)", color="#FF9800")

    for bars in [bars1, bars2]:
        for bar in bars:
            height = bar.get_height()
            ax.annotate(
                f"{height:.2%}",
                xy=(bar.get_x() + bar.get_width() / 2, height),
                xytext=(0, 4),
                textcoords="offset points",
                ha="center", fontsize=10,
            )

    ax.set_ylabel("Score")
    ax.set_title("Model Performance Comparison")
    ax.set_xticks(x)
    ax.set_xticklabels(model_names)
    ax.set_ylim(0, 1.15)
    ax.legend()

    plt.tight_layout()
    fig.savefig(f"{output_dir}/04_model_comparison.png", bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved {output_dir}/04_model_comparison.png")


def plot_feature_importance(model_output: dict, output_dir: str = "plots"):
    """Plot feature importance from the Random Forest model."""
    setup_style()
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    rf_model = model_output["models"].get("Random Forest")
    if rf_model is None:
        print("  [SKIP] No Random Forest model found")
        return

    importances = rf_model.feature_importances_
    feature_names = model_output["feature_columns"]
    indices = np.argsort(importances)[::-1]

    fig, ax = plt.subplots(figsize=(10, 6))
    ax.barh(
        range(len(indices)),
        importances[indices[::-1]],
        color="#4CAF50",
        alpha=0.85,
    )
    ax.set_yticks(range(len(indices)))
    ax.set_yticklabels([feature_names[i] for i in indices[::-1]])
    ax.set_xlabel("Feature Importance (Gini)")
    ax.set_title("Random Forest Feature Importance")

    plt.tight_layout()
    fig.savefig(f"{output_dir}/05_feature_importance.png", bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved {output_dir}/05_feature_importance.png")


def plot_per_class_metrics(results: dict, label_names: list, output_dir: str = "plots"):
    """Bar chart of precision, recall, F1 per class for each model."""
    setup_style()
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    n_models = len(results)
    fig, axes = plt.subplots(1, n_models, figsize=(7 * n_models, 5))
    if n_models == 1:
        axes = [axes]

    for ax, (name, res) in zip(axes, results.items()):
        report = res["classification_report"]
        metrics = ["precision", "recall", "f1-score"]
        x = np.arange(len(label_names))
        width = 0.25

        for i, metric in enumerate(metrics):
            values = [report[label][metric] for label in label_names]
            ax.bar(x + i * width, values, width, label=metric.capitalize())

        ax.set_xticks(x + width)
        ax.set_xticklabels(label_names)
        ax.set_ylim(0, 1.15)
        ax.set_ylabel("Score")
        ax.set_title(f"{name} — Per-Class Metrics")
        ax.legend()

    plt.tight_layout()
    fig.savefig(f"{output_dir}/06_per_class_metrics.png", bbox_inches="tight")
    plt.close(fig)
    print(f"  Saved {output_dir}/06_per_class_metrics.png")


def generate_all_plots(full_df: pd.DataFrame, model_output: dict, output_dir: str = "plots"):
    """Generate all visualization plots."""
    print("\nGenerating plots...")
    plot_raw_rssi(full_df, output_dir)
    plot_feature_distributions(model_output["feature_df"], output_dir)
    plot_confusion_matrices(
        model_output["results"],
        list(model_output["label_encoder"].classes_),
        output_dir,
    )
    plot_model_comparison(model_output["results"], output_dir)
    plot_feature_importance(model_output, output_dir)
    plot_per_class_metrics(
        model_output["results"],
        list(model_output["label_encoder"].classes_),
        output_dir,
    )
    print(f"\nAll plots saved to {output_dir}/")
