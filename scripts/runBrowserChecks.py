"""Run the existing browser suites remotely and retain every result for review."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173/")
    parser.add_argument("--reports", type=Path, default=Path("browser-reports"))
    args = parser.parse_args()
    args.reports.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + 20
    while True:
        try:
            with urllib.request.urlopen(args.url, timeout=2):
                break
        except urllib.error.URLError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.25)

    suites = [
        ("viewport-webgl", "testViewportBrowser.py", ["--screenshots", str(args.reports / "viewport-webgl")]),
        ("viewport-canvas", "testViewportBrowser.py", ["--canvas", "--screenshots", str(args.reports / "viewport-canvas")]),
        ("compact-layouts", "testCompactBrowser.py", ["--screenshots", str(args.reports / "compact")]),
        ("mobile-play", "testMobileBrowser.py", ["--screenshots", str(args.reports / "mobile")]),
        ("desktop-webgl", "testPhaserBrowser.py", []),
        ("desktop-canvas", "testPhaserBrowser.py", ["--canvas"]),
        ("query-workers", "testKqlBrowser.py", []),
        ("difficulty-cases", "testDifficultiesBrowser.py", []),
        ("pause-lifecycle", "testPauseBrowser.py", []),
    ]
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    failures = []
    for name, script, extra in suites:
        print(f"::group::{name}", flush=True)
        with (args.reports / f"{name}.log").open("w", encoding="utf-8") as log:
            result = subprocess.run(
                [sys.executable, "-u", str(Path(__file__).parent / script), "--url", args.url, *extra],
                stdout=log, stderr=subprocess.STDOUT, env=env, check=False,
            )
        print((args.reports / f"{name}.log").read_text(encoding="utf-8"), flush=True)
        print("::endgroup::", flush=True)
        if result.returncode:
            failures.append(name)
    summary = "\n".join(f"{name}: {'FAILED' if name in failures else 'passed'}" for name, _, _ in suites)
    (args.reports / "summary.txt").write_text(summary + "\n", encoding="utf-8")
    print(summary, flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
