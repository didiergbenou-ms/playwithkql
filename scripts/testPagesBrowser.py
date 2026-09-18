"""Smoke the real game and query worker under the GitHub Pages project prefix."""
import argparse
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

sys.dont_write_bytecode = True
from testPhaserBrowser import enter_game, interact


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173/playwithkql/")
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    target = urlsplit(args.url)
    assert target.path != "/" and target.path.endswith("/"), "Use the actual project subpath"
    deadline = time.monotonic() + 20
    while True:
        try:
            with urllib.request.urlopen(args.url, timeout=2):
                break
        except urllib.error.URLError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.25)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", headless=True)
        try:
            context = browser.new_context(
                viewport={"width": 1440, "height": 1080}, reduced_motion="reduce",
            )
            page = context.new_page()
            page.set_default_timeout(15000)
            errors = []
            asset_requests = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            context.on("request", lambda request: asset_requests.append(request.url))
            context.on("response", lambda response: errors.append(f"{response.status}: {response.url}")
                       if response.status >= 400 and urlsplit(response.url).netloc == target.netloc else None)
            try:
                response = page.goto(args.url, wait_until="networkidle")
                assert response.status == 200
                expect(page.get_by_role("button", name="Open case file", exact=True)).to_be_visible()
                enter_game(page, "001", "Heartbeat Hills", "QUILL")
                if args.screenshots:
                    page.screenshot(path=str(args.screenshots / "pages-game.png"))
                interact(page, "terminal")
                query = page.evaluate("__kql.game.scene.getScene('Game').caseDef.challenges[0].solution")
                page.get_by_role("button", name="2 \u00b7 Solve it", exact=True).click()
                page.get_by_role("combobox", name="KQL query editor").fill(query)
                page.get_by_role("button", name=re.compile("^Run query")).click()
                expect(page.locator(".verdict-box.correct")).to_be_visible()
                page.locator(".celebrate").wait_for(state="detached")
                expect(page.locator(".result-block table")).to_be_visible()
                if args.screenshots:
                    page.screenshot(path=str(args.screenshots / "pages-query.png"))
                local_assets = [urlsplit(url).path for url in asset_requests
                                if urlsplit(url).netloc == target.netloc and "/assets/" in urlsplit(url).path]
                assert any("PhaserGame-" in path for path in local_assets), "Lazy game was never loaded"
                assert any("query.worker-" in path for path in local_assets), "Query worker was never loaded"
                assert all(path.startswith(target.path + "assets/") for path in local_assets), local_assets
                page.get_by_role("button", name="Back to the field", exact=True).click()
                page.get_by_role("button", name="Abandon", exact=True).click()
                page.reload(wait_until="networkidle")
                expect(page.get_by_role("button", name="Open case file", exact=True)).to_be_visible()
                assert not errors, errors
                print(f"Pages {target.path}: menu, lazy Phaser, real worker query and reload passed.")
            except Exception:
                if args.screenshots:
                    page.screenshot(path=str(args.screenshots / "pages-failure.png"))
                    (args.screenshots / "errors.txt").write_text("\n".join(errors), encoding="utf-8")
                raise
            finally:
                context.close()
        finally:
            browser.close()


if __name__ == "__main__":
    main()
