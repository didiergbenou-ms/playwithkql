"""Phone layout and real multi-pointer gameplay against a production preview."""
import argparse
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


class Fingers:
    """CDP dispatches trusted touch input, not synthetic keyboard/pointer events."""

    def __init__(self, page):
        self.page = page
        self.cdp = page.context.new_cdp_session(page)
        self.points = {}

    def send(self, kind):
        self.cdp.send("Input.dispatchTouchEvent", {
            "type": kind, "touchPoints": list(self.points.values()),
        })

    def down(self, pointer, button, offset=0):
        box = self.page.get_by_role("button", name=button, exact=True).bounding_box()
        assert box, f"Missing touch target: {button}"
        self.points[pointer] = {
            "id": pointer, "x": box["x"] + box["width"] / 2 + offset,
            "y": box["y"] + box["height"] / 2, "radiusX": 4, "radiusY": 4,
        }
        self.send("touchStart")

    def move(self, pointer, x, y):
        self.points[pointer].update(x=x, y=y)
        self.send("touchMove")

    def up(self, pointer):
        point = self.points.pop(pointer)
        # CDP's partial touchEnd identifies the released point, not the list
        # of fingers remaining down (which would release the wrong finger).
        self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": [point]})

    def cancel(self):
        if not self.points:
            return
        self.points.clear()
        self.send("touchCancel")


def tap(page, name):
    button = page.get_by_role("button", name=name, exact=True)
    if button.count() == 0 and page.locator(".hud-compact").count() and (
        name in ["Options (O)", "KQL card", "Abandon"] or name.startswith("Notes (")
    ):
        page.get_by_role("button", name="Pause (P)", exact=True).tap()
        expect(page.get_by_role("dialog", name="Game paused", exact=True)).to_be_visible()
    if page.evaluate("navigator.maxTouchPoints > 0"):
        button.tap()
    else:
        button.click()


def no_overflow(page, label):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), label


def fits_screen(locator, page, label, minimum=0):
    box = locator.bounding_box()
    assert box, f"{label}: missing"
    viewport = page.viewport_size
    assert box["x"] >= -1 and box["y"] >= -1, f"{label}: clipped at top/left: {box}"
    assert box["x"] + box["width"] <= viewport["width"] + 1, f"{label}: off right: {box}"
    assert box["y"] + box["height"] <= viewport["height"] + 1, f"{label}: off bottom: {box}"
    if minimum:
        assert box["width"] >= minimum and box["height"] >= minimum, f"{label}: small target: {box}"
    return box


def ready(page):
    page.wait_for_function("""()=>{
      const scene=window.__kql?.game.scene.getScene('Game');
      return scene?.viewportLayout && scene.player?.body?.blocked.down;
    }""")


def enter(page, recruit="QUILL", difficulty="Beginner"):
    no_overflow(page, "case menu")
    tap(page, "Open case file")
    if difficulty != "Beginner":
        tap(page, f"Select {difficulty} difficulty")
    no_overflow(page, "difficulty")
    tap(page, "Choose recruit")
    if recruit != "QUILL":
        page.get_by_role("button", name=re.compile("^" + recruit)).tap()
    no_overflow(page, "recruit selection")
    tap(page, f"Deploy {recruit}")
    no_overflow(page, "briefing")
    tap(page, "Begin investigation")
    ready(page)


def controls_fit(page):
    no_overflow(page, "stage")
    boxes = []
    for name in ["Move left", "Move right", "Jump", "Interact", "Pause (P)"]:
        boxes.append(fits_screen(page.get_by_role("button", name=name, exact=True), page, name, 44))
    for i, a in enumerate(boxes):
        for b in boxes[i + 1:]:
            overlap_x = min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"])
            overlap_y = min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"])
            assert overlap_x <= 1 or overlap_y <= 1, f"Touch targets overlap: {a}, {b}"
    canvas = fits_screen(page.locator(".phaser-host canvas"), page, "canvas")
    backing = page.evaluate("({width:__kql.game.canvas.width,height:__kql.game.canvas.height})")
    assert abs(canvas["width"] / canvas["height"] - backing["width"] / backing["height"]) < 0.02
    hud = page.locator(".hud-compact").bounding_box()
    assert hud and hud["height"] <= 64, f"HUD consumes too much play space: {hud}"
    expect(page.locator(".hud-compact button")).to_have_count(1)
    viewport = page.viewport_size
    layout = page.evaluate("__kql.game.scene.getScene('Game').viewportLayout")
    assert layout is not None, "Adaptive geometry was never applied"
    assert canvas["y"] - (hud["y"] + hud["height"]) <= layout["unusedCssHeight"] + 14, "Unaccounted gap above game"
    controls = page.locator(".touch-controls").bounding_box()
    assert controls and controls["y"] - (canvas["y"] + canvas["height"]) <= 12, "Gap before controller deck"
    assert canvas["width"] >= viewport["width"] - 24, "Game does not fill available width"
    assert viewport["height"] - (controls["y"] + controls["height"]) <= 16, "Unused space below controls"
    if viewport["width"] > viewport["height"]:
        assert hud["height"] <= 52, "Landscape HUD too tall"
        assert canvas["height"] >= viewport["height"] - 140, f"Landscape game wastes its available area: {canvas}"
    else:
        assert canvas["height"] >= min(viewport["height"] - 156, (viewport["width"] - 16) * 208 / 224 + 176) - 2, (
            f"Portrait view fails the useful action/overview height budget: {canvas}"
        )
    assert abs(canvas["height"] - layout["cssHeight"]) < 2, "Canvas stretched beyond its uniform camera scale"
    cameras = page.evaluate("""__kql.game.scene.getScene('Game').cameras.cameras
      .filter(c=>c.visible).map(c=>({x:c.x,y:c.y,width:c.width,height:c.height,
        worldWidth:c.width/c.zoomX,worldHeight:c.height/c.zoomY}))""")
    main = cameras[0]
    assert main["worldWidth"] >= (223 if layout["mode"] == "portrait" else 179), (
        f"Main action view is too narrow for the viewport contract: {main}"
    )
    assert main["worldHeight"] <= 209, f"Extra canvas height replaced blank space with sky: {main}"
    total_area = sum(c["width"] * c["height"] for c in cameras)
    assert total_area >= backing["width"] * backing["height"] * .9, f"Unassigned camera space: {cameras}"
    if len(cameras) > 1:
        assert cameras[1]["worldWidth"] >= main["worldWidth"] * 1.5, "Route view adds no wider context"


def position(page):
    return page.evaluate("""()=>{
      const s=__kql.game.scene.getScene('Game');
      return {x:s.player.x,y:s.player.y,vx:s.player.body.velocity.x,vy:s.player.body.velocity.y};
    }""")

def settled(page):
    # Release stops input immediately, not airborne momentum. Wait for the
    # existing landing/ground drag rather than assuming a CI frame rate.
    expect(page.locator(".touch-controls .is-held")).to_have_count(0)
    page.wait_for_function("""()=>{
      const b=__kql.game.scene.getScene('Game').player.body;
      return b.blocked.down && Math.abs(b.velocity.x)<1;
    }""", timeout=5000)


def test_fingers(page):
    fingers = Fingers(page)
    start = position(page)
    fingers.down(1, "Move right")
    fingers.down(2, "Jump")
    page.wait_for_function("""start=>{
      const p=__kql.game.scene.getScene('Game').player;
      return p.x>start.x+5 && p.y<start.y-5;
    }""", arg=start, timeout=3000)
    airborne = position(page)
    assert airborne["x"] > start["x"] + 5, "Touch movement did not move the player"
    assert airborne["y"] < start["y"] - 5, "Move + jump failed"
    fingers.up(2)
    fingers.move(1, 2, 2)
    page.wait_for_function("x=>__kql.game.scene.getScene('Game').player.x>x", arg=airborne["x"], timeout=3000)
    fingers.cancel()
    settled(page)
    ready(page)

    fingers.down(1, "Move left", -5)
    fingers.down(2, "Move left", 5)
    page.wait_for_timeout(60)
    fingers.up(1)
    page.wait_for_function("__kql.game.scene.getScene('Game').player.body.velocity.x<0", timeout=3000)
    fingers.up(2)
    settled(page)
    expect(page.locator(".touch-controls .is-held")).to_have_count(0)

    fingers.down(1, "Move right")
    fingers.down(2, "Pause (P)")
    fingers.up(2)
    expect(page.get_by_role("dialog", name="Game paused", exact=True)).to_be_visible()
    page.wait_for_function("!__kql.game.loop.running")
    frozen = position(page)
    page.wait_for_timeout(150)
    assert position(page) == frozen
    fingers.down(2, "Resume game")
    fingers.up(2)
    page.wait_for_function("__kql.game.loop.running")
    settled(page)
    fingers.up(1)
    expect(page.locator(".touch-controls .is-held")).to_have_count(0)

    # The visibility event itself is synthetic; pointer input above is real CDP.
    fingers.down(1, "Move right")
    page.evaluate("window.dispatchEvent(new Event('blur'))")
    settled(page)
    fingers.cancel()


def interact(page, kind, index=0):
    identity = page.evaluate("""([kind,index])=>{
      const s=__kql.game.scene.getScene('Game');
      const target=kind==='terminal'
        ? s.interactables.find(i=>i.obj.challengeId===s.caseDef.challenges[index].id)
        : s.interactables.find(i=>i.obj.kind===kind);
      if(!target)throw Error('Missing '+kind);
      s.player.body.reset(target.x,target.y);
      return target.obj.noteId ?? target.obj.challengeId ?? 'verdict';
    }""", [kind, index])
    page.wait_for_function("""([kind,id])=>{
      const s=__kql.game.scene.getScene('Game'),n=s.nearest;
      return n?.kind===kind && (n.noteId??n.challengeId??'verdict')===id &&
        performance.now()>=s.interactLockUntil;
    }""", arg=[kind, identity])
    tap(page, "Interact")
    expect(page.get_by_role("dialog")).to_be_visible()


def test_mixed_buffer(page):
    # Freeze collisions to place the real scene in a deterministic pre-landing
    # state. Actual keyboard and touch events still feed its ordinary update().
    page.evaluate("""()=>{
      document.activeElement?.blur();
      const s=__kql.game.scene.getScene('Game');
      s.physics.pause();
      s.player.body.blocked.down=false;s.player.body.touching.down=false;
      s.lastGroundedAt=-9999;s.jumpQueuedAt=-9999;s.touchJumpQueuedAt=-9999;
      s.jumpHeld=false;
    }""")
    fingers = Fingers(page)
    try:
        page.keyboard.down("Space")
        page.wait_for_function("__kql.game.scene.getScene('Game').jumpQueuedAt>0")
        queued = page.evaluate("__kql.game.scene.getScene('Game').jumpQueuedAt")
        fingers.down(1, "Jump")
        page.wait_for_function("__kql.game.scene.getScene('Game').touchJumpPress!==null")
        fingers.cancel()
        page.wait_for_function("__kql.game.scene.getScene('Game').touchJumpPress===null")
        assert page.evaluate("__kql.game.scene.getScene('Game').jumpQueuedAt") == queued
        velocity = page.evaluate("""queued=>{
          const s=__kql.game.scene.getScene('Game'),time=s.time.now;
          s.time.now=queued+60;s.player.body.blocked.down=true;
          s.update(s.time.now,16);
          s.time.now=time;
          return s.player.body.velocity.y;
        }""", queued)
        assert velocity < -160, "Cancelled touch erased the independent keyboard landing buffer"
    finally:
        fingers.cancel()
        page.keyboard.up("Space")
        page.evaluate("__kql.game.scene.getScene('Game').physics.resume()")
    ready(page)

    right = page.get_by_role("button", name="Move right", exact=True)
    right.focus()
    start = position(page)
    page.keyboard.down("Space")
    try:
        page.wait_for_function("x=>__kql.game.scene.getScene('Game').player.x>x+5", arg=start["x"], timeout=3000)
    finally:
        page.keyboard.up("Space")
    assert abs(position(page)["y"] - start["y"]) < 1, "Button Space leaked into Phaser jump"
    settled(page)
    # AT activation uses a click without a pointer sequence. Ordinary touch
    # above must not duplicate actions through this separate activation path.
    right.evaluate("el=>el.click()")
    page.wait_for_function("__kql.game.scene.getScene('Game').player.body.velocity.x>0", timeout=3000)
    right.evaluate("el=>el.click()")
    settled(page)
    expect(page.locator(".touch-controls .is-held")).to_have_count(0)
    right.evaluate("el=>el.blur()")


def test_terminal(page):
    interact(page, "terminal")
    assert page.evaluate("document.activeElement?.tagName!=='TEXTAREA'"), "Touch modal opened the keyboard"
    page.wait_for_function("!__kql.game.loop.running")
    no_overflow(page, "terminal learn")
    tap(page, "2 \u00b7 Solve it")
    editor = page.get_by_role("combobox", name="KQL query editor")
    assert editor.evaluate("el=>parseFloat(getComputedStyle(el).fontSize)") >= 16
    editor.fill("Hea")
    page.get_by_role("option", name=re.compile("Heartbeat")).tap()
    expect(editor).to_have_value("Heartbeat")
    query = page.evaluate("__kql.game.scene.getScene('Game').caseDef.challenges[0].solution")
    editor.fill(query)
    # This models the keyboard's visible rectangle, not a real OS keyboard.
    page.evaluate("""()=>{
      const v=visualViewport;
      Object.defineProperty(v,'height',{configurable:true,get:()=>320});
      Object.defineProperty(v,'offsetTop',{configurable:true,get:()=>120});
      v.dispatchEvent(new Event('resize'));
      v.dispatchEvent(new Event('scroll'));
    }""")
    page.wait_for_timeout(100)
    box = page.get_by_role("dialog").bounding_box()
    assert box and box["y"] >= 119 and box["y"] + box["height"] <= 441, (
        f"Modal escaped keyboard-reduced visual viewport: {box}"
    )
    for name in ["Run query", "Close terminal"]:
        action = page.get_by_role("button", name=name, exact=True).bounding_box()
        assert action and action["y"] >= 120 and action["y"] + action["height"] <= 440, (
            f"{name} hidden by the keyboard: {action}"
        )
    expect(editor).to_have_value(query)
    page.evaluate("""()=>{
      const v=visualViewport;
      delete v.height;delete v.offsetTop;
      v.dispatchEvent(new Event('resize'));
      v.dispatchEvent(new Event('scroll'));
    }""")
    # Rotation while editing must retain scene, draft and overlay.
    page.evaluate("window.mobileScene=__kql.game.scene.getScene('Game')")
    page.set_viewport_size({"width": 844, "height": 390})
    page.wait_for_timeout(200)
    expect(editor).to_have_value(query)
    assert page.evaluate("__kql.game.scene.getScene('Game')===mobileScene")
    no_overflow(page, "landscape editor")
    page.get_by_role("button", name=re.compile("^Run query")).tap()
    expect(page.locator(".verdict-box.correct")).to_be_visible()
    page.locator(".celebrate").wait_for(state="detached")
    expect(page.locator(".result-block table")).to_be_visible()
    no_overflow(page, "query results")
    tap(page, "Back to the field")
    page.wait_for_function("__kql.game.loop.running")
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(200)
    interact(page, "terminal")
    tap(page, "2 \u00b7 Solve it")
    expect(editor).to_have_value(query)
    tap(page, "Close (Esc)")


def test_phone(page, screenshots=None):
    enter(page)
    controls_fit(page)
    if screenshots:
        page.screenshot(path=str(screenshots / "mobile-portrait.png"))
    test_fingers(page)
    test_mixed_buffer(page)
    test_terminal(page)
    for name, dialog_name in [
        ("Pause (P)", "Game paused"), ("Options (O)", "Options"),
        ("KQL card", "KQL reference card"),
    ]:
        tap(page, name)
        no_overflow(page, dialog_name)
        expect(page.get_by_role("dialog", name=dialog_name, exact=True)).to_be_visible()
        if dialog_name == "Game paused":
            tap(page, "Return to checkpoint")
        else:
            page.get_by_role("dialog").get_by_role("button", name=re.compile("^(Close|Esc)")).first.tap()
        page.wait_for_function("__kql.game.loop.running")
    interact(page, "note")
    tap(page, "Pocket it")
    tap(page, "Notes (1)")
    no_overflow(page, "notebook")
    page.locator(".notebook-modal").get_by_role("button", name="Esc", exact=True).tap()
    page.evaluate("window.mobileGame=__kql.game")
    for width, height in [(320, 568), (360, 640), (430, 932), (667, 375), (844, 390), (1024, 768)]:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(200)
        controls_fit(page)
        if screenshots and width == 844:
            page.screenshot(path=str(screenshots / "mobile-landscape.png"))
        assert page.evaluate("__kql.game===mobileGame"), "Resize restarted the world"
    tap(page, "Abandon")
    page.wait_for_function("!window.__kql")
    enter(page)
    expect(page.locator(".touch-controls .is-held")).to_have_count(0)
    assert page.evaluate("__kql.game!==mobileGame")


def test_touch_route(page, recruit):
    # Authored Harbor route: real touch movement across twelve floor/platform
    # waypoints. Gates are opened to isolate controls, not to claim a case solve.
    tap(page, "Select case 002: Signal Harbor")
    enter(page, recruit)
    page.evaluate("""()=>{
      const s=__kql.game.scene.getScene('Game');
      for(const id of Object.values(s.caseDef.level.gateChars))s.openGate(id,false);
    }""")
    route = [
        (9, 10, False), (12, 8, True), (14, 8, False), (17, 6, True),
        (20, 6, False), (23, 4, True), (27, 4, False), (30, 6, False),
        (32, 6, False), (34, 8, False), (36, 8, False), (42, 10, False),
    ]
    fingers = Fingers(page)
    for index, (column, row, jump) in enumerate(route):
        if jump:
            assert page.evaluate("""x=>{
              const c=__kql.game.scene.getScene('Game').cameras.main;
              return x>=c.worldView.left && x<=c.worldView.right;
            }""", column * 16 + 8), f"{recruit}: next landing is off-camera before takeoff"
        if 1 not in fingers.points:
            fingers.down(1, "Move right")
        if jump:
            fingers.down(2, "Jump")
        page.wait_for_function(
            "x=>__kql.game.scene.getScene('Game').player.x>=x-2", arg=column * 16 + 8,
        )
        fingers.up(1)
        try:
            page.wait_for_function("""y=>{
              const b=__kql.game.scene.getScene('Game').player.body;
              return b.blocked.down && Math.abs(b.bottom-y)<2;
            }""", arg=row * 16, timeout=5000)
        except Exception:
            print(json.dumps({"recruit": recruit, "waypoint": index, "target": [column, row],
                              "state": position(page)}), flush=True)
            raise
        if 2 in fingers.points:
            fingers.up(2)
        page.wait_for_function("!__kql.game.scene.getScene('Game').jumpHeld")
        page.wait_for_function("Math.abs(__kql.game.scene.getScene('Game').player.body.velocity.x)<1")
    fingers.cancel()
    print(f"{recruit}: twelve physical touch-controlled platform waypoints passed.", flush=True)


def test_phone_case(page):
    tap(page, "Select case 002: Signal Harbor")
    enter(page, difficulty="Intermediate")
    challenges = page.evaluate("""__kql.game.scene.getScene('Game').caseDef.challenges
      .map(c=>({solution:c.solution,gate:c.unlocksGate}))""")
    for index, challenge in enumerate(challenges):
        interact(page, "terminal", index)
        tap(page, "2 \u00b7 Solve it")
        page.get_by_role("combobox", name="KQL query editor").fill(challenge["solution"])
        page.get_by_role("button", name=re.compile("^Run query")).tap()
        expect(page.locator(".verdict-box.correct")).to_be_visible()
        page.locator(".celebrate").wait_for(state="detached")
        expect(page.locator(".result-block table")).to_be_visible()
        if "| render " in challenge["solution"]:
            expect(page.locator(".result-block svg")).to_be_visible()
        no_overflow(page, f"Intermediate terminal {index + 1}")
        assert page.evaluate("""id=>__kql.game.scene.getScene('Game').gateSprites
          .filter(g=>g.gateId===id).every(g=>!g.sprite.body?.enable)""", challenge["gate"])
        tap(page, "Back to the field")
        page.wait_for_function("__kql.game.loop.running")
    interact(page, "verdict")
    no_overflow(page, "verdict choices")
    correct = page.evaluate("__kql.game.scene.getScene('Game').caseDef.rootCauses.find(o=>o.correct).label")
    page.get_by_role("button", name=re.compile("^" + re.escape(correct))).tap()
    tap(page, "Submit verdict")
    expect(page.locator(".debrief-main")).to_be_visible()
    no_overflow(page, "debrief")
    tap(page, "Replay case")
    ready(page)
    expect(page.locator(".obj-count")).to_have_text("0/5")
    expect(page.locator(".touch-controls .is-held")).to_have_count(0)
    print("Phone five-terminal case, both chart types, gates, verdict, debrief and replay passed.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173/")
    parser.add_argument("--channel", default="chromium")
    parser.add_argument("--screenshots", type=Path, help="Optional output directory for phone screenshots")
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
            context = browser.new_context(
                viewport={"width": 390, "height": 844}, device_scale_factor=3,
                is_mobile=True, has_touch=True, reduced_motion="reduce",
            )
            page = context.new_page()
            page.set_default_timeout(15000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.add_init_script("""
              window.mobileEvents=[];
              for(const type of ['pointerdown','pointerup','pointercancel','click']){
                document.addEventListener(type,e=>{
                  const b=e.target.closest?.('button');if(!b)return;
                  mobileEvents.push({type,name:b.getAttribute('aria-label')??b.textContent,
                    pointer:e.pointerId,primary:e.isPrimary,detail:e.detail});
                  if(mobileEvents.length>30)mobileEvents.shift();
                },true);
              }
            """)
            page.goto(args.url, wait_until="networkidle")
            try:
                test_phone(page, args.screenshots)
            except Exception:
                print(json.dumps(page.evaluate("window.mobileEvents"), indent=2), flush=True)
                if args.screenshots:
                    page.screenshot(path=str(args.screenshots / "phone-failure.png"))
                raise
            assert not errors, errors
            context.close()
            context = browser.new_context(
                viewport={"width": 360, "height": 740}, is_mobile=True, has_touch=True,
                reduced_motion="reduce",
            )
            page = context.new_page()
            page.set_default_timeout(15000)
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until="networkidle")
            test_phone_case(page)
            assert not errors, errors
            context.close()
            for width, height in [(393, 700), (844, 320)]:
                for recruit in ["SPARKY", "QUILL", "VELL", "CIRCUIT"]:
                    context = browser.new_context(
                        viewport={"width": width, "height": height}, is_mobile=True, has_touch=True,
                        reduced_motion="reduce",
                    )
                    page = context.new_page()
                    page.set_default_timeout(15000)
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.goto(args.url, wait_until="networkidle")
                    try:
                        test_touch_route(page, recruit)
                    except Exception:
                        if args.screenshots:
                            page.screenshot(path=str(args.screenshots / f"route-failure-{width}-{recruit}.png"))
                        raise
                    assert not errors, errors
                    context.close()
            context = browser.new_context(viewport={"width": 1440, "height": 1080}, has_touch=False)
            # A Windows touch laptop may still report its hardware here;
            # explicitly model a keyboard/mouse-only desktop for this branch.
            context.add_init_script("Object.defineProperty(navigator,'maxTouchPoints',{get:()=>0})")
            page = context.new_page()
            page.goto(args.url, wait_until="networkidle")
            enter(page)
            expect(page.locator(".touch-controls")).to_have_count(0)
            page.keyboard.press("p")
            expect(page.get_by_role("dialog", name="Game paused", exact=True)).to_be_visible()
            page.keyboard.press("Escape")
            page.wait_for_function("__kql.game.loop.running")
            context.close()
            print("Phone layouts, real multi-touch, cancellation, pause, query, rotation and desktop input passed.")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
