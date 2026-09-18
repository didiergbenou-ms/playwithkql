"""Keep autocomplete in the visible viewport, including a keyboard-sized window."""
import argparse
import re
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

sys.dont_write_bytecode = True
from testMobileBrowser import enter, interact, tap


def assert_suggestions(page, top, height):
    popup = page.locator(".kql-suggest")
    expect(popup).to_be_visible()
    box = popup.bounding_box()
    width = page.viewport_size["width"]
    assert box and box["x"] >= 0 and box["x"] + box["width"] <= width + 1, box
    assert box["y"] >= top - 1 and box["y"] + box["height"] <= top + height + 1, (
        f"Autocomplete is hidden beyond the visible viewport: {box}; top={top}, height={height}"
    )
    first = page.get_by_role("option").first.bounding_box()
    assert first and first["height"] >= 40, f"Suggestion too small to tap: {first}"
    footer = page.locator(".terminal-touch-actions").bounding_box()
    if footer:
        assert box["y"] + box["height"] <= footer["y"] + 1 or box["y"] >= footer["y"] + footer["height"] - 1, (
            "Autocomplete covers Run/Close"
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173/")
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", headless=True)
        try:
            for width, height in [(393, 700), (844, 390)]:
                context = browser.new_context(
                    viewport={"width": width, "height": height}, is_mobile=True,
                    has_touch=True, reduced_motion="reduce",
                )
                page = context.new_page()
                page.set_default_timeout(15000)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                try:
                    page.goto(args.url, wait_until="networkidle")
                    enter(page)
                    interact(page, "terminal")
                    tap(page, "2 \u00b7 Solve it")
                    editor = page.get_by_role("combobox", name="KQL query editor")
                    editor.fill("Heartbeat\n| wh")
                    assert_suggestions(page, 0, height)
                    page.get_by_role("option", name=re.compile(r"where")).first.tap()
                    expect(editor).to_have_value(re.compile(r"Heartbeat\s*\|\s*where"))
                    # Model a visible rectangle reduced by the native keyboard.
                    # This deliberately does not claim to launch an OS keyboard.
                    visible_height = min(320, height - 60)
                    page.evaluate("""height=>{
                      Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>height});
                      Object.defineProperty(visualViewport,'offsetTop',{configurable:true,get:()=>40});
                      visualViewport.dispatchEvent(new Event('resize'));
                      visualViewport.dispatchEvent(new Event('scroll'));
                    }""", visible_height)
                    editor.fill("Heartbeat\n\n\n\n\n\n\n\n\n| wh")
                    assert_suggestions(page, 40, visible_height)
                    if args.screenshots:
                        page.screenshot(path=str(args.screenshots / f"completion-{width}.png"))
                    page.get_by_role("option", name=re.compile(r"where")).first.tap()
                    expect(editor).to_have_value(re.compile(r"\|\s*where"))
                    editor.fill("Hea")
                    expect(page.get_by_role("listbox", name="Query suggestions")).to_be_visible()
                    before = editor.input_value()
                    listbox = page.get_by_role("listbox", name="Query suggestions")
                    listbox.dispatch_event("pointerdown", {"pointerType": "touch", "clientX": 10, "clientY": 10})
                    listbox.dispatch_event("pointermove", {"pointerType": "touch", "clientX": 10, "clientY": 60})
                    page.get_by_role("option").first.dispatch_event("click")
                    expect(editor).to_have_value(before)
                    editor.focus()
                    editor.press("Escape")
                    expect(page.get_by_role("dialog", name="KQL terminal", exact=True)).to_be_visible()
                    page.evaluate("""()=>{
                      delete visualViewport.height;delete visualViewport.offsetTop;
                      visualViewport.dispatchEvent(new Event('resize'));
                    }""")
                    tap(page, "Close (Esc)")
                    expect(page.get_by_role("listbox", name="Query suggestions")).to_have_count(0)
                    assert not errors, errors
                    print(f"{width}x{height}: visible phone completion, keyboard viewport, tap, scroll and Escape passed.", flush=True)
                except Exception:
                    if args.screenshots:
                        page.screenshot(path=str(args.screenshots / f"completion-{width}-failure.png"))
                    raise
                finally:
                    context.close()
        finally:
            browser.close()


if __name__ == "__main__":
    main()
