"""Adaptive camera bounds, useful screen coverage, and sleeping rotation."""
import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

sys.dont_write_bytecode = True
from testMobileBrowser import controls_fit, enter, position, tap


def geometry(page):
    return page.evaluate("""()=>{
      const s=__kql.game.scene.getScene('Game');
      return {canvas:[__kql.game.canvas.width,__kql.game.canvas.height],
        cameras:s.cameras.cameras.filter(c=>c.visible).map(c=>({
          name:c.name,x:c.x,y:c.y,width:c.width,height:c.height,zoom:c.zoom,
          view:{x:c.worldView.x,y:c.worldView.y,width:c.worldView.width,height:c.worldView.height}
        }))};
    }""")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173/")
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument("--canvas", action="store_true")
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", headless=True)
        try:
            context = browser.new_context(
                viewport={"width": 393, "height": 700}, is_mobile=True, has_touch=True,
                device_scale_factor=3, reduced_motion="reduce",
            )
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
            page.goto(args.url, wait_until="networkidle")
            enter(page)
            page.evaluate("window.originalGame=__kql.game;window.originalScene=__kql.game.scene.getScene('Game')")
            if args.screenshots:
                page.screenshot(path=str(args.screenshots / "initial.png"))
            controls_fit(page)
            for width, height in [(393, 700), (320, 568), (430, 932), (667, 300), (844, 320), (393, 700)]:
                tap(page, "Pause (P)")
                page.wait_for_function("!__kql.game.loop.running")
                before = position(page)
                page.set_viewport_size({"width": width, "height": height})
                page.wait_for_timeout(300)
                page.wait_for_function("!__kql.game.loop.running")
                assert position(page) == before, "A sleeping resize advanced the player"
                assert page.evaluate("__kql.game===originalGame && __kql.game.scene.getScene('Game')===originalScene")
                expect(page.get_by_role("dialog", name="Game paused", exact=True)).to_be_visible()
                tap(page, "Resume game")
                page.wait_for_function("__kql.game.loop.running")
                page.wait_for_timeout(100)
                if args.screenshots:
                    page.screenshot(path=str(args.screenshots / f"adaptive-{width}x{height}.png"))
                controls_fit(page)
                g = geometry(page)
                for camera in g["cameras"]:
                    if camera["name"] == "route-label":
                        continue
                    assert camera["view"]["height"] <= 209
                    assert camera["view"]["y"] >= -1, f"Camera shows unbounded sky: {camera}"
                    assert camera["view"]["y"] + camera["view"]["height"] <= 209
                assert page.evaluate("""()=>{
                  const s=__kql.game.scene.getScene('Game');
                  return s.parallaxFar.width >= s.cameras.main.worldView.width &&
                    s.parallaxNear.width >= s.cameras.main.worldView.width;
                }"""), "Parallax ends before the wider action view"
                print(json.dumps({"viewport":[width,height],**g}), flush=True)
            assert not errors, errors
            context.close()
        finally:
            browser.close()


if __name__ == "__main__":
    main()
