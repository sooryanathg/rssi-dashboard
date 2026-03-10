#!/usr/bin/env python3
"""
Indoor Human Activity Estimator — Training Pipeline

Runs the complete pipeline:
  1. Load raw RSSI data from ESP32 capture files
  2. Extract sliding-window features
  3. Train and evaluate ML models (Leave-One-File-Out CV)
  4. Generate all visualization plots
  5. Save the best model for deployment

Usage (run from the src/ directory):
    python train.py --data-dir ../data
    python train.py --data-dir ../data --window-size 7
    python train.py --data-dir ../data --no-plots
    python train.py --data-dir ../data --output-dir ../output
"""

import argparse
import time
from pathlib import Path

from model.data_loader import load_all_data
from model.feature_extraction import build_feature_dataset
from model.model import train_and_evaluate, save_model
from model.visualize import generate_all_plots


def parse_args():
    parser = argparse.ArgumentParser(
        description="Wi-Fi RSSI Indoor Activity Estimator — Training Pipeline"
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        default="data",
        help="Directory containing .txt RSSI capture files (default: data)",
    )
    parser.add_argument(
        "--window-size",
        type=int,
        default=5,
        help="Number of RSSI samples per sliding window (default: 5)",
    )
    parser.add_argument(
        "--step-size",
        type=int,
        default=2,
        help="Step size between sliding windows (default: 2)",
    )
    parser.add_argument(
        "--cv-mode",
        type=str,
        choices=["group", "stratified"],
        default="group",
        help="Cross-validation strategy (default: group = leave-one-file-out)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="../output",
        help="Directory for plots and feature CSV (default: ../output)",
    )
    parser.add_argument(
        "--model-dir",
        type=str,
        default="model",
        help="Directory to save trained model artifacts (default: model — same dir live_predict.py loads from)",
    )
    parser.add_argument(
        "--no-plots",
        action="store_true",
        help="Skip generating visualization plots",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    start_time = time.time()

    plot_dir = str(Path(args.output_dir) / "plots")

    # ── Step 1: Load Raw Data ─────────────────────────────────────────
    print("=" * 60)
    print("  STEP 1: Loading Raw RSSI Data")
    print(f"  Source: {Path(args.data_dir).resolve()}")
    print("=" * 60)
    full_df = load_all_data(args.data_dir)

    # ── Step 2: Feature Extraction ────────────────────────────────────
    print("\n" + "=" * 60)
    print("  STEP 2: Sliding-Window Feature Extraction")
    print(f"  Window size: {args.window_size} samples, Step: {args.step_size} samples")
    print("=" * 60)
    feature_df = build_feature_dataset(
        full_df,
        window_size=args.window_size,
        step_size=args.step_size,
    )

    feature_csv = Path(args.output_dir) / "features.csv"
    feature_csv.parent.mkdir(parents=True, exist_ok=True)
    feature_df.to_csv(feature_csv, index=False)
    print(f"\nFeature dataset saved to {feature_csv}")

    # ── Step 3: Model Training & Evaluation ───────────────────────────
    print("\n" + "=" * 60)
    print("  STEP 3: Model Training & Cross-Validation")
    print(f"  CV mode: {args.cv_mode}")
    print("=" * 60)
    model_output = train_and_evaluate(feature_df, cv_mode=args.cv_mode)

    # ── Step 4: Visualizations ────────────────────────────────────────
    if not args.no_plots:
        print("\n" + "=" * 60)
        print("  STEP 4: Generating Visualizations")
        print("=" * 60)
        generate_all_plots(full_df, model_output, output_dir=plot_dir)

    # ── Step 5: Save Best Model ───────────────────────────────────────
    print("\n" + "=" * 60)
    print("  STEP 5: Saving Best Model")
    print("=" * 60)
    save_model(model_output, save_dir=args.model_dir)

    # ── Summary ───────────────────────────────────────────────────────
    elapsed = time.time() - start_time
    best_name = max(
        model_output["results"],
        key=lambda k: model_output["results"][k]["f1_weighted"],
    )
    best_result = model_output["results"][best_name]

    print("\n" + "=" * 60)
    print("  PIPELINE COMPLETE")
    print("=" * 60)
    print(f"  Time elapsed:  {elapsed:.1f}s")
    print(f"  Data samples:  {len(full_df)}")
    print(f"  Windows:       {len(feature_df)}")
    print(f"  Features:      {feature_df.shape[1] - 3} per window")
    print(f"  Best model:    {best_name}")
    print(f"  Accuracy:      {best_result['accuracy']:.2%}")
    print(f"  F1 (weighted): {best_result['f1_weighted']:.2%}")
    print(f"  Model saved:   {Path(args.model_dir).resolve()}")
    print("=" * 60)


if __name__ == "__main__":
    main()
