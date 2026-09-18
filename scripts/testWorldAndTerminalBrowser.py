"""Focused regression for the single world view and terminal pane scroll reset."""
import argparse
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

sys.dont_write_bytecode = True
from testMobileBrowser import enter, interact, tap


def check_camera(page, mobile):
    page.wait_for_function("window.__kql?.game.scene.getScene('Game')?.viewportLayout")
    state = page.evaluate("""()=>{
      const s=__kql.game.scene.getScene('Game'),c=s.cameras.main,g=__kql.game;
      return {count:s.cameras.cameras.length,mode:s.viewportLayout.mode,
        width:c.width/c.zoomX,height:c.height/c.zoomY,canvas:[g.canvas.width,g.canvas.height],
        routeText:s.children.list.some(o=>o.text==='ROUTE VIEW')};
    }""")
    assert state["count"] == 1 and not state["routeText"], state
    if not mobile:
        assert state["canvas"] == [640, 360] and abs(state["width"] - 320) < .01, state
    elif state["mode"] == "portrait":
        assert abs(state["width"] - 288) < .01 and state["height"] <= 208.01, state
        canvas = page.locator(".phaser-host canvas").bounding_box()
        hud = page.locator(".hud").bounding_box()
        controls = page.locator(".touch-controls").bounding_box()
        assert canvas and hud and controls
        assert canvas["height"] >= canvas["width"] * 208 / 288 - 2, "Portrait retained a previous, smaller height"
        assert canvas["y"] - (hud["y"] + hud["height"]) <= 14, "Old overview gap remains above the world"
        assert controls["y"] - (canvas["y"] + canvas["height"]) <= 12, "Controls detached from the world"
    else:
        assert abs(state["height"] - 180) < .01, state
    return state


def check_scroll(page):
    interact(page, "terminal")
    expect(page.get_by_role("dialog", name="KQL terminal", exact=True)).to_be_visible()
    scroller = page.locator(".terminal-scroll")
    editor = page.get_by_role("combobox", name="KQL query editor")
    page.get_by_role("button", name="Got it \u2014 show me the task", exact=True).scroll_into_view_if_needed()
    assert scroller.evaluate("el=>el.scrollTop") > 40, "Fixture did not scroll through the lesson"
    tap(page, "Got it \u2014 show me the task")
    expect(editor).to_be_attached()
    page.wait_for_function("document.querySelector('.terminal-scroll').scrollTop===0")
    expect(page.locator(".terminal-modal .modal-head")).to_be_in_viewport()

    # Both the tab and the call-to-action need the same committed-pane reset.
    tap(page, "1 \u00b7 Learn")
    page.get_by_role("button", name="Try this example myself", exact=True).scroll_into_view_if_needed()
    assert scroller.evaluate("el=>el.scrollTop") > 40
    tap(page, "Try this example myself")
    page.wait_for_function("document.querySelector('.terminal-scroll').scrollTop===0")
    example = editor.input_value()
    assert example.strip()

    editor.fill("Heartbeat\n| take 3")
    tap(page, "1 \u00b7 Learn")
    page.wait_for_function("document.querySelector('.terminal-scroll').scrollTop===0")
    tap(page, "2 \u00b7 Solve it")
    page.wait_for_function("document.querySelector('.terminal-scroll').scrollTop===0")
    expect(editor).to_have_value("Heartbeat\n| take 3")
    assert page.evaluate("document.activeElement?.tagName!=='TEXTAREA'"), "Pane switch opened the phone keyboard"
    tap(page, "Close terminal")
    page.wait_for_function("__kql.game.loop.running")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173/")
    parser.add_argument("--channel", default="chromium")
    parser.add_argument("--canvas", action="store_true")
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=args.channel, headless=True)
        try:
            for width, height, mobile in [(393, 700, True), (844, 390, True), (1440, 1080, False)]:
                context = browser.new_context(
                    viewport={"width": width, "height": height}, has_touch=mobile,
                    is_mobile=mobile, reduced_motion="reduce",
                )
                if not mobile:
                    context.add_init_script("Object.defineProperty(navigator,'maxTouchPoints',{get:()=>0})")
                if args.canvas:
                    context.add_init_script("""const original=HTMLCanvasElement.prototype.getContext;
                      HTMLCanvasElement.prototype.getContext=function(type,...rest){
                        if(type==='webgl'||type==='experimental-webgl'||type==='webgl2')return null;
                        return original.call(this,type,...rest);
                      };""")
                page = context.new_page()
                page.set_default_timeout(15000)
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                try:
                    page.goto(args.url, wait_until="networkidle")
                    enter(page)
                    state = check_camera(page, mobile)
                    if mobile and width < height:
                        for portrait_width in [320, 360, 430, 393]:
                            page.set_viewport_size({"width": portrait_width, "height": height})
                            page.wait_for_timeout(150)
                            check_camera(page, True)
                    if args.screenshots:
                        page.screenshot(path=str(args.screenshots / f"single-world-{width}.png"))
                    if mobile:
                        check_scroll(page)
                        page.evaluate("window.singleGame=__kql.game")
                        tap(page, "Pause (P)")
                        page.wait_for_function("!__kql.game.loop.running")
                        before = page.evaluate("({x:__kql.game.scene.getScene('Game').player.x,y:__kql.game.scene.getScene('Game').player.y})")
                        page.set_viewport_size({"width": height, "height": width})
                        page.wait_for_timeout(150)
                        page.wait_for_function("!__kql.game.loop.running")
                        assert page.evaluate("__kql.game===singleGame")
                        assert page.evaluate("({x:__kql.game.scene.getScene('Game').player.x,y:__kql.game.scene.getScene('Game').player.y})") == before
                        tap(page, "Resume game")
                        page.wait_for_function("__kql.game.loop.running")
                        check_camera(page, True)
                    assert not errors, errors
                    print(f"{width}x{height}: one camera ({state['width']:.1f}x{state['height']:.1f} world); pane scroll/rotation passed.", flush=True)
                except Exception:
                    if args.screenshots:
                        page.screenshot(path=str(args.screenshots / f"focused-failure-{width}.png"))
                    raise
                finally:
                    context.close()
        finally:
            browser.close()


if __name__ == "__main__":
    main()
