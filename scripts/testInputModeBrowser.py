"""Phone versus hybrid-desktop presentation and explicit control-mode switching."""
import argparse
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def enter(page):
    for name in ["Open case file", "Choose recruit", "Deploy QUILL", "Begin investigation"]:
        page.get_by_role("button", name=name, exact=True).click()
    page.wait_for_function("window.__kql?.game.scene.getScene('Game')?.player?.body?.blocked.down")


def primary_pointer(context, coarse):
    context.add_init_script("""(()=>{
      const coarse=__COARSE__;
      const real=window.matchMedia.bind(window);
      window.matchMedia=query=>{
        const values={'(pointer: coarse)':coarse,'(pointer: fine)':!coarse,
          '(hover: hover)':!coarse,'(any-pointer: coarse)':true};
        const media=real(query);
        return query in values ? new Proxy(media,{get:(target,key)=>{
          if(key==='matches')return values[query];
          const value=Reflect.get(target,key,target);
          return typeof value==='function'?value.bind(target):value;
        }}) : media;
      };
    })();""".replace("__COARSE__", "true" if coarse else "false"))


def assert_mode(page, touch):
    if touch:
        expect(page.locator(".hud-compact")).to_be_visible()
        expect(page.get_by_role("button", name="Move right", exact=True)).to_be_visible()
        expect(page.locator(".stage-hint")).to_be_hidden()
    else:
        expect(page.locator(".hud-compact")).to_have_count(0)
        expect(page.locator(".touch-controls")).to_have_count(0)
        for name in ["Pause (P)", "Options (O)", "KQL card (K)", "Notes (0) (Tab)", "Abandon"]:
            expect(page.get_by_role("button", name=name, exact=True)).to_be_visible()
        expect(page.locator(".stage-hint")).to_be_visible()
        page.wait_for_function("__kql.game.canvas.width===640 && __kql.game.canvas.height===360")


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
            for name, size, coarse in [
                ("hybrid-desktop", (1440, 1080), False),
                ("small-desktop", (600, 800), False),
                ("phone", (393, 700), True),
                ("tablet", (1366, 1024), True),
            ]:
                context = browser.new_context(
                    viewport={"width": size[0], "height": size[1]}, has_touch=True,
                    is_mobile=coarse, reduced_motion="reduce",
                )
                primary_pointer(context, coarse)
                page = context.new_page()
                page.set_default_timeout(15000)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                try:
                    page.goto(args.url, wait_until="networkidle")
                    enter(page)
                    assert_mode(page, coarse)
                    page.evaluate("window.modeGame=__kql.game;window.modeScene=__kql.game.scene.getScene('Game')")
                    # A real touchscreen tap must not convert a fine-primary
                    # desktop into the mobile layout permanently.
                    page.get_by_role("button", name="Pause (P)", exact=True).tap()
                    page.get_by_role("button", name="Resume game", exact=True).tap()
                    page.wait_for_function("__kql.game.loop.running")
                    assert_mode(page, coarse)
                    if coarse:
                        page.get_by_role("button", name="Pause (P)", exact=True).tap()
                    page.get_by_role("button", name="Options (O)", exact=True).click()
                    for label, expected in [("Keyboard & mouse", False), ("Touch", True), ("Auto", coarse)]:
                        page.get_by_role("button", name=label, exact=True).click()
                        expect(page.get_by_role("button", name=label, exact=True)).to_have_attribute("aria-pressed", "true")
                        assert page.evaluate("__kql.game===modeGame && __kql.game.scene.getScene('Game')===modeScene")
                        page.wait_for_function("expected=>document.querySelector('.app').classList.contains('touch-enabled')===expected",
                                               arg=expected)
                    page.get_by_role("button", name="Close (Esc)", exact=True).click()
                    page.wait_for_function("__kql.game.loop.running")
                    assert_mode(page, coarse)
                    if name == "phone":
                        page.set_viewport_size({"width": 844, "height": 390})
                        assert_mode(page, True)
                    if args.screenshots:
                        page.screenshot(path=str(args.screenshots / f"{name}.png"))
                    assert not errors, errors
                    print(f"{name}: automatic layout, real touch and non-resetting overrides passed.", flush=True)
                except Exception:
                    if args.screenshots:
                        page.screenshot(path=str(args.screenshots / f"{name}-failure.png"))
                    raise
                finally:
                    context.close()
        finally:
            browser.close()


if __name__ == "__main__":
    main()
