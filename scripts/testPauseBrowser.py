"""Pause/resume, HUD styling and overlay interaction checks on a built game."""
import argparse
import time
import urllib.error
import urllib.request

from playwright.sync_api import expect, sync_playwright


def enter(page):
    page.get_by_role("button", name="Open case file", exact=True).click()
    page.get_by_role("button", name="Choose recruit", exact=True).click()
    page.get_by_role("button", name="Deploy QUILL", exact=True).click()
    page.get_by_role("button", name="Begin investigation", exact=True).click()


def ready(page):
    page.wait_for_function("window.__kql?.game.scene.getScene('Game')?.player?.body?.blocked.down")


def paused(page):
    dialog = page.get_by_role("dialog", name="Game paused", exact=True)
    expect(dialog).to_be_visible()
    page.wait_for_function("window.__kql?.game.scene.getScene('Game')?.frozen && !window.__kql.game.loop.running")
    expect(dialog.get_by_role("button", name="Resume game", exact=True)).to_be_focused()
    return dialog


def test_controls(page):
    enter(page)
    ready(page)
    page.evaluate("""async()=>{
      const resource=performance.getEntriesByType('resource').find(r=>/\\/assets\\/store-.*\\.js$/.test(r.name));
      if(!resource)throw Error('Cannot find store module in production build');
      const exports=await import(resource.name);
      window.pauseTestStore=Object.values(exports).find(value=>typeof value==='function' &&
        typeof value.getState==='function' && value.getState().run);
      if(!pauseTestStore)throw Error('Cannot inspect the active run clock');
    }""")
    before_profile = page.evaluate("JSON.stringify(pauseTestStore.getState().profile)")
    abandon = page.get_by_role("button", name="Abandon", exact=True)
    assert abandon.evaluate("el=>getComputedStyle(el).backgroundColor") == "rgb(229, 64, 79)"
    page.get_by_role("button", name="Pause (P)", exact=True).click()
    dialog = paused(page)
    assert page.evaluate("pauseTestStore.getState().run.pauseStartedAt!==null")
    elapsed = page.evaluate("""()=>{
      const r=pauseTestStore.getState().run;return r.pauseStartedAt-r.startedAt-r.pausedDurationMs;
    }""")
    state = page.evaluate("""() => {
      const s=__kql.game.scene.getScene('Game');
      window.pausedRenders=0;__kql.game.events.on('postrender',()=>pausedRenders++);
      return {x:s.player.x,y:s.player.y,health:s.health,enemy:s.enemies.getChildren().map(e=>[e.x,e.y])};
    }""")
    dialog.focus()
    page.keyboard.down("d")
    page.keyboard.down("Space")
    page.wait_for_timeout(500)
    page.keyboard.up("Space")
    page.keyboard.up("d")
    assert page.evaluate("""() => {
      const s=__kql.game.scene.getScene('Game');
      return {x:s.player.x,y:s.player.y,health:s.health,enemy:s.enemies.getChildren().map(e=>[e.x,e.y])};
    }""") == state
    assert page.evaluate("pausedRenders") == 0
    assert page.evaluate("""()=>{
      const r=pauseTestStore.getState().run;return r.pauseStartedAt-r.startedAt-r.pausedDurationMs;
    }""") == elapsed
    page.keyboard.press("Tab")
    expect(dialog.get_by_role("button", name="Resume game", exact=True)).to_be_focused()
    dialog.get_by_role("button", name="Resume game", exact=True).click()
    page.wait_for_function("__kql.game.loop.running")
    assert page.evaluate("pauseTestStore.getState().run.pauseStartedAt") is None
    assert page.evaluate("pauseTestStore.getState().run.pausedDurationMs") >= 500
    assert page.evaluate("JSON.stringify(pauseTestStore.getState().profile)") == before_profile
    assert page.evaluate("Object.keys(JSON.parse(localStorage.getItem('kql-quest-profile')).state)") == ["profile"]
    expect(page.get_by_role("button", name="Pause (P)", exact=True)).to_be_focused()
    start_x = page.evaluate("__kql.game.scene.getScene('Game').player.x")
    page.keyboard.down("d")
    try:
        page.wait_for_function("x=>__kql.game.scene.getScene('Game').player.x>x+5", arg=start_x, timeout=3000)
    finally:
        page.keyboard.up("d")
    for key in ["p", "Escape", "p"]:
        page.keyboard.press("p")
        paused(page)
        # Holding P must not repeatedly toggle pause.
        page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'p',repeat:true,bubbles:true}))")
        expect(page.get_by_role("dialog", name="Game paused", exact=True)).to_be_visible()
        page.keyboard.press(key)
        page.wait_for_function("__kql.game.loop.running")
        expect(page.get_by_role("dialog", name="Game paused", exact=True)).to_have_count(0)
    page.get_by_role("button", name="Options (O)", exact=True).click()
    page.keyboard.press("p")
    expect(page.get_by_role("dialog", name="Options", exact=True)).to_be_visible()
    expect(page.get_by_role("dialog", name="Game paused", exact=True)).to_have_count(0)
    page.keyboard.press("Escape")
    page.evaluate("""()=>{
      const s=__kql.game.scene.getScene('Game'),t=s.interactables.find(i=>i.obj.kind==='terminal');
      s.player.body.reset(t.x,t.y);
    }""")
    page.wait_for_function("""()=>{
      const s=__kql.game.scene.getScene('Game');return s.nearest?.kind==='terminal' && s.time.now>=s.interactLockUntil;
    }""")
    page.keyboard.press("e")
    page.get_by_role("button", name="2 \u00b7 Solve it", exact=True).click()
    editor = page.get_by_role("combobox", name="KQL query editor")
    editor.fill("")
    editor.press_sequentially("project")
    expect(editor).to_have_value("project")
    expect(page.get_by_role("dialog", name="Game paused", exact=True)).to_have_count(0)
    page.get_by_role("button", name="Close (Esc)", exact=True).click()
    page.get_by_role("button", name="Pause (P)", exact=True).click()
    paused(page)
    page.locator(".scrim").click(position={"x": 2, "y": 2})
    page.wait_for_function("__kql.game.loop.running")
    for width in [1440, 1200, 900, 390]:
        page.set_viewport_size({"width": width, "height": 1000})
        expect(abandon).to_be_visible()
        expect(page.get_by_role("button", name="Pause (P)", exact=True)).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), f"overflow at {width}"
    abandon.click()
    page.wait_for_function("!window.__kql")
    enter(page)
    ready(page)
    page.get_by_role("button", name="Pause (P)", exact=True).click()
    paused(page)
    page.evaluate("""()=>{
      window.oldGame=__kql.game;window.wasDestroyed=false;
      oldGame.events.once('destroy',()=>window.wasDestroyed=true);
    }""")
    # Exercise teardown while the explicit pause overlay is still mounted.
    abandon.evaluate("(button)=>button.click()")
    page.wait_for_function("wasDestroyed && !oldGame.loop.running && !window.__kql")
    enter(page)
    ready(page)
    page.get_by_role("button", name="Abandon", exact=True).click()
    page.wait_for_function("!window.__kql")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173/")
    parser.add_argument("--channel", default="chromium")
    args = parser.parse_args()
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
            page = browser.new_page(viewport={"width": 1440, "height": 1080}, reduced_motion="reduce")
            page.set_default_timeout(15000)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(args.url, wait_until="networkidle")
            test_controls(page)
            assert not errors, errors
            page.close()
            page = browser.new_page(viewport={"width": 1440, "height": 1080}, reduced_motion="reduce")
            page.set_default_timeout(15000)
            page.on("pageerror", lambda e: errors.append(str(e)))
            pending = []
            page.route("**/assets/PhaserGame-*.js", lambda route: pending.append(route))
            page.goto(args.url, wait_until="networkidle")
            enter(page)
            expect(page.locator(".game-loading")).to_be_visible()
            page.get_by_role("button", name="Pause (P)", exact=True).click()
            for route in pending:
                route.continue_()
            paused(page)
            page.get_by_role("button", name="Resume game", exact=True).click()
            ready(page)
            assert not errors, errors
            print("Pause button/keyboard/resume, frozen world, focus, overlays, responsive red Abandon and delayed boot passed.")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
