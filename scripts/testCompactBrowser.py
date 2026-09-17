"""Enforce useful phone screen density, not merely absence of overflow."""
import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

sys.dont_write_bytecode = True
from testMobileBrowser import controls_fit, fits_screen, no_overflow, ready, tap


SIZES = [(320, 568), (360, 640), (393, 700), (430, 740), (667, 300), (844, 320)]


def first_screen(page, names, screen):
    no_overflow(page, screen)
    assert page.evaluate("scrollY") == 0, f"{screen} inherited page scrolling"
    for name in names:
        fits_screen(page.get_by_role("button", name=name, exact=True), page, f"{screen}: {name}", 44)


def test_size(browser, url, size, screenshots):
    width, height = size
    context = browser.new_context(
        viewport={"width": width, "height": height}, is_mobile=True, has_touch=True,
        device_scale_factor=2, reduced_motion="reduce",
    )
    page = context.new_page()
    page.set_default_timeout(15000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.goto(url, wait_until="networkidle")
        cases = ["Select case 001: Heartbeat Hills", "Select case 002: Signal Harbor", "Select case 003: Relay Ruins"]
        first_screen(page, [*cases, "Open case file"], "case picker")
        menu_height = page.evaluate("document.documentElement.scrollHeight")
        assert menu_height <= height * 1.1, f"Default menu has needless scrolling at {size}: {menu_height}"
        if screenshots:
            page.screenshot(path=str(screenshots / f"cases-{width}x{height}.png"))
        tap(page, cases[1])
        tap(page, "Case details")
        expect(page.locator(".compact-menu-case-details .compact-menu-disclosure-body")).to_contain_text("Signal Harbor")
        tap(page, "Case details")
        tap(page, cases[0])
        tap(page, "Quest record")
        expect(page.get_by_role("button", name="Reset profile", exact=True)).to_be_visible()
        tap(page, "Quest record")
        tap(page, "Open case file")
        first_screen(page, [
            "Select Beginner difficulty", "Select Intermediate difficulty",
            "Select Expert difficulty", "Choose recruit",
        ], "difficulty")
        tap(page, "Select Intermediate difficulty")
        tap(page, "Choose recruit")
        no_overflow(page, "recruits")
        for recruit in ["QUILL", "SPARKY", "VELL", "CIRCUIT"]:
            fits_screen(page.get_by_role("button", name=re.compile("^" + recruit)), page, recruit, 44)
        first_screen(page, ["Deploy QUILL"], "recruit continuation")
        if screenshots:
            page.screenshot(path=str(screenshots / f"recruits-{width}x{height}.png"))
        tap(page, "Deploy QUILL")
        first_screen(page, ["Begin investigation"], "briefing")
        page.get_by_role("button", name="Full briefing & objectives", exact=True).tap()
        expect(page.locator(".briefing .case-difficulty")).to_contain_text("Intermediate")
        expect(page.locator(".briefing .email")).to_be_visible()
        page.get_by_role("button", name="Full briefing & objectives", exact=True).tap()
        tap(page, "Begin investigation")
        ready(page)
        controls_fit(page)
        hud = page.locator(".hud").bounding_box()
        canvas = page.locator("canvas").bounding_box()
        expect(page.get_by_role("button", name="Abandon", exact=True)).to_have_count(0)
        expect(page.get_by_role("button", name="Options (O)", exact=True)).to_have_count(0)
        if screenshots:
            page.screenshot(path=str(screenshots / f"game-{width}x{height}.png"))
        tap(page, "Pause (P)")
        dialog = page.get_by_role("dialog", name="Game paused", exact=True)
        expect(dialog).to_be_visible()
        for name in ["Resume game", "Return to checkpoint", "Notes (0)", "KQL card", "Options (O)", "Abandon"]:
            fits_screen(page.get_by_role("button", name=name, exact=True), page, f"pause: {name}", 44)
        if screenshots:
            page.screenshot(path=str(screenshots / f"pause-{width}x{height}.png"))
        tap(page, "Notes (0)")
        expect(page.get_by_role("dialog", name="Notebook", exact=True)).to_be_visible()
        assert page.evaluate("document.querySelector('[role=dialog]').contains(document.activeElement)")
        page.locator(".notebook-modal").get_by_role("button", name="Esc", exact=True).tap()
        page.wait_for_function("__kql.game.loop.running")
        tap(page, "Pause (P)")
        page.get_by_role("button", name="Abandon", exact=True).focus()
        page.keyboard.press("Tab")
        expect(page.get_by_text("Mission progress", exact=True)).to_be_focused()
        page.get_by_text("Mission progress", exact=True).tap()
        expect(page.locator(".mobile-mission-details")).to_have_attribute("open", "")
        expect(page.locator(".mobile-mission-details")).to_contain_text("Intermediate")
        page.get_by_text("Mission progress", exact=True).tap()
        tap(page, "Resume game")
        page.wait_for_function("__kql.game.loop.running")
        if width > height:
            # Emulate extra notch/home-indicator padding in a toolbar-reduced
            # window. This is a layout fixture, not a claim of native Safari.
            page.add_style_tag(content=".touch-enabled .stage{padding-left:44px;padding-right:44px;padding-bottom:24px}")
            page.wait_for_timeout(100)
            fits_screen(page.locator("canvas"), page, "safe-area canvas")
            for name in ["Move left", "Move right", "Jump", "Interact", "Pause (P)"]:
                fits_screen(page.get_by_role("button", name=name, exact=True), page, f"safe-area {name}", 44)
            no_overflow(page, "safe areas")
        assert not errors, errors
        print(json.dumps({
            "viewport": size, "menuHeight": menu_height,
            "hudHeight": round(hud["height"]), "canvas": [round(canvas["width"]), round(canvas["height"])],
            "firstScreenSelections": True,
        }), flush=True)
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173/")
    parser.add_argument("--channel", default="chromium")
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
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
        browser = p.chromium.launch(channel=args.channel, headless=True)
        try:
            for size in SIZES:
                test_size(browser, args.url, size, args.screenshots)
        finally:
            browser.close()


if __name__ == "__main__":
    main()
