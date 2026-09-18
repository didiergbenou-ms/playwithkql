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
        self.down_many([(pointer, button, offset)])

    def down_many(self, presses):
        # Read every target before starting any finger. Separate CDP starts
        # can consume the coyote window while the runner looks up Jump.
        additions = {}
        for pointer, button, offset in presses:
            assert pointer not in self.points and pointer not in additions, f"Pointer already held: {pointer}"
            box = self.page.get_by_role("button", name=button, exact=True).bounding_box()
            assert box, f"Missing touch target: {button}"
            additions[pointer] = {
                "id": pointer, "x": box["x"] + box["width"] / 2 + offset,
                "y": box["y"] + box["height"] / 2, "radiusX": 4, "radiusY": 4,
            }
        self.start_prepared(additions)

    def start_prepared(self, additions):
        assert not (self.points.keys() & additions.keys()), "Cannot restart a held pointer"
        self.points.update(additions)
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
    fingers.down_many([(1, "Move right", 0), (2, "Jump", 0)])
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


def interact(page, kind, index=0, lag_scene_clock=False):
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
    page.evaluate("""()=>{
      const s=__kql.game.scene.getScene('Game');
      window.interactionTrace=[];
      window.originalInteract=s.interact;
      const input=__kql.input;
      window.originalTouchMethods={};
      for(const method of ['press','release','cancel','consumePress','reset','setBlocked','setEnabled']){
        const original=input[method];
        originalTouchMethods[method]=original;
        input[method]=function(...args){
          const result=original.apply(this,args);
          if(method!=='consumePress'||result){
            interactionTrace.push({method,args,result,enabled:input.isEnabled(),blocked:input.isBlocked(),
              at:performance.now(),held:input.getSnapshot()});
            if(interactionTrace.length>40)interactionTrace.shift();
          }
          return result;
        };
      }
      s.interact=function(){
        interactionTrace.push({at:performance.now(),sceneTime:this.time.now,
          lock:this.interactLockUntil,frozen:this.frozen,paused:this.sys.isPaused(),
          nearest:this.nearest?.noteId??this.nearest?.challengeId??this.nearest?.kind,
          player:[this.player.x,this.player.y],velocity:[this.player.body.velocity.x,this.player.body.velocity.y]});
        return originalInteract.call(this);
      };
    }""")
    if lag_scene_clock:
        page.evaluate("""()=>{
          const s=__kql.game.scene.getScene('Game');
          window.lagSceneClock=()=>{s.time.now=0;};
          s.events.on('preupdate',window.lagSceneClock);
        }""")
    try:
        tap(page, "Interact")
        expect(page.get_by_role("dialog")).to_be_visible()
    except Exception:
        print(json.dumps(page.evaluate("""()=>{
          const s=__kql.game.scene.getScene('Game');
          return {trace:interactionTrace,at:performance.now(),sceneTime:s.time.now,
            input:{enabled:__kql.input.isEnabled(),blocked:__kql.input.isBlocked(),held:__kql.input.getSnapshot()},
            lock:s.interactLockUntil,frozen:s.frozen,paused:s.sys.isPaused(),loop:__kql.game.loop.running,
            nearest:s.nearest?.noteId??s.nearest?.challengeId??s.nearest?.kind,
            player:[s.player.x,s.player.y],velocity:[s.player.body.velocity.x,s.player.body.velocity.y],
            buttons:[...document.querySelectorAll('.touch-button')].map(b=>({
              label:b.getAttribute('aria-label'),disabled:b.disabled,pressed:b.getAttribute('aria-pressed')}))};
        }"""), indent=2), flush=True)
        raise
    finally:
        page.evaluate("""()=>{
          const s=__kql.game.scene.getScene('Game');
          s.interact=originalInteract;delete window.originalInteract;delete window.interactionTrace;
          Object.assign(__kql.input,originalTouchMethods);delete window.originalTouchMethods;
        }""")
        if lag_scene_clock:
            page.evaluate("""()=>{
              __kql.game.scene.getScene('Game').events.off('preupdate',window.lagSceneClock);
              delete window.lagSceneClock;
            }""")


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
    interact(page, "note", lag_scene_clock=True)
    page.locator(".scrim").dispatch_event("click")
    expect(page.get_by_role("dialog", name="Field note", exact=True)).to_be_visible()
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


def test_touch_route(page, recruit, reports=None):
    # Authored Harbor route: real touch movement across seven floor/platform
    # waypoints. Gates are opened to isolate controls, not to claim a case solve.
    tap(page, "Select case 002: Signal Harbor")
    enter(page, recruit)
    page.evaluate("""()=>{
      const s=__kql.game.scene.getScene('Game');
      for(const id of Object.values(s.caseDef.level.gateChars))s.openGate(id,false);
      window.routeFrames=[];window.routePointers=[];
      const capture=phase=>{
        if(routeFrames.length>=360)return;
        const b=s.player.body;
        routeFrames.push({phase,frame:__kql.game.loop.frame,now:s.time.now,at:performance.now(),
          x:s.player.x,y:s.player.y,bodyX:b.x,bodyY:b.y,bottom:b.bottom,vx:b.velocity.x,vy:b.velocity.y,
          grounded:b.blocked.down,touchingDown:b.touching.down,up:b.blocked.up,
          input:__kql.input.getSnapshot(),enabled:__kql.input.isEnabled(),blocked:__kql.input.isBlocked()});
      };
      s.physics.world.on('worldstep',()=>capture('physics'));
      s.events.on('postupdate',()=>capture('scene'));
      for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture']){
        document.addEventListener(type,e=>{
          const button=e.target.closest?.('.touch-button');
          if(button)routePointers.push({type,id:e.pointerId,at:performance.now(),name:button.getAttribute('aria-label')});
        },true);
      }
    }""")
    route = [
        (9, 10, False), (12, 8, True), (17, 6, True), (24, 4, True),
        (30, 6, False), (34, 8, False), (42, 10, False),
    ]
    fingers = Fingers(page)
    history = []
    for index, (column, row, jump) in enumerate(route):
        page.evaluate("window.routeFrames=[];window.routePointers=[]")
        # Interior stopping points leave room for ground drag and browser/CDP
        # latency. An edge position followed by settling can walk off the ledge.
        before = page.evaluate("""()=>{
          const s=__kql.game.scene.getScene('Game'),b=s.player.body;
          return {x:s.player.x,y:s.player.y,bottom:b.bottom,vx:b.velocity.x,grounded:b.blocked.down};
        }""")
        history.append({"waypoint": index, "target": [column, row], "before": before})
        if not jump and before["x"] >= column * 16 + 6:
            assert before["grounded"] and abs(before["bottom"] - row * 16) < 2, history
            continue
        if jump:
            assert before["grounded"], f"{recruit}: jump starts off its intended platform: {history}"
            assert page.evaluate("""x=>{
              const c=__kql.game.scene.getScene('Game').cameras.main;
              return x>=c.worldView.left && x<=c.worldView.right;
            }""", column * 16 + 8), f"{recruit}: next landing is off-camera before takeoff"
        if jump:
            # These waypoints exercise running jumps. Measure Jump first
            # so its dispatch cannot be delayed by a DOM lookup after run-up.
            box = page.get_by_role("button", name="Jump", exact=True).bounding_box()
            assert box
            jump_point = {2: {"id": 2, "x": box["x"] + box["width"] / 2,
                             "y": box["y"] + box["height"] / 2, "radiusX": 4, "radiusY": 4}}
            fingers.down(1, "Move right")
            page.wait_for_function("""()=>{
              const s=__kql.game.scene.getScene('Game');
              return s.player.body.velocity.x >= 118*s.character.stats.speed*0.5 &&
                s.player.body.blocked.down;
            }""", timeout=3000)
            fingers.start_prepared(jump_point)
        else:
            fingers.down(1, "Move right")
        page.wait_for_function(
            "x=>__kql.game.scene.getScene('Game').player.x>=x-2", arg=column * 16 + 8,
        )
        fingers.up(1)
        try:
            page.wait_for_function("""y=>{
              const b=__kql.game.scene.getScene('Game').player.body;
              return b.blocked.down && Math.abs(b.bottom-y)<2 && Math.abs(b.velocity.x)<1;
            }""", arg=row * 16, timeout=5000)
        except Exception:
            print(json.dumps({"recruit": recruit, "waypoint": index, "target": [column, row],
                              "state": position(page), "history": history}), flush=True)
            trace = page.evaluate("({frames:routeFrames,pointers:routePointers})")
            if reports:
                (reports / f"route-trace-{page.viewport_size['width']}-{recruit}.json").write_text(
                    json.dumps(trace, indent=2), encoding="utf-8")
            else:
                print(json.dumps(trace), flush=True)
            raise
        if 2 in fingers.points:
            fingers.up(2)
        page.wait_for_function("!__kql.game.scene.getScene('Game').jumpHeld")
        page.wait_for_function("Math.abs(__kql.game.scene.getScene('Game').player.body.velocity.x)<1")
    fingers.cancel()
    print(f"{recruit}: seven physical touch-controlled landings across every first-room platform passed.", flush=True)

def test_standing_jump(page):
    # Separate collision/input fixture for the drag bug, not part of the
    # non-teleported platform route above.
    page.evaluate("""()=>{
      const s=__kql.game.scene.getScene('Game');
      __kql.input.reset();
      s.player.body.reset(220,116);
    }""")
    page.wait_for_function("""()=>{
      const b=__kql.game.scene.getScene('Game').player.body;
      return b.blocked.down && Math.abs(b.bottom-128)<1 && Math.abs(b.velocity.x)<1;
    }""")
    fingers = Fingers(page)
    fingers.down_many([(1, "Move right", 0), (2, "Jump", 0)])
    try:
        page.wait_for_function("""()=>{
          const b=__kql.game.scene.getScene('Game').player.body;
          return b.blocked.down && Math.abs(b.bottom-96)<1;
        }""", timeout=5000)
        assert page.evaluate("__kql.game.scene.getScene('Game').player.body.drag.x") == 0
    finally:
        fingers.cancel()
    settled(page)
    assert page.evaluate("__kql.game.scene.getScene('Game').player.body.drag.x") == 800
    print("SPARKY: standing-jump fixture reaches the upper platform, release restores braking.", flush=True)


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
    parser.add_argument("--route-only", action="store_true", help="Diagnose the landscape Sparky route only")
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
            if args.route_only:
                context = browser.new_context(viewport={"width": 844, "height": 320},
                                              is_mobile=True, has_touch=True, reduced_motion="reduce")
                page = context.new_page()
                page.set_default_timeout(15000)
                try:
                    page.goto(args.url, wait_until="networkidle")
                    test_touch_route(page, "SPARKY", args.screenshots)
                    test_standing_jump(page)
                finally:
                    if args.screenshots:
                        (args.screenshots / "route-frames.json").write_text(
                            json.dumps(page.evaluate("({frames:window.routeFrames??[],pointers:window.routePointers??[]})"),
                                       indent=2), encoding="utf-8")
                        page.screenshot(path=str(args.screenshots / "route-diagnostic.png"))
                    context.close()
                return
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
                        test_touch_route(page, recruit, args.screenshots)
                        if recruit == "SPARKY":
                            test_standing_jump(page)
                    except Exception:
                        if args.screenshots:
                            (args.screenshots / f"route-frames-{width}-{recruit}.json").write_text(
                                json.dumps(page.evaluate("({frames:window.routeFrames??[],pointers:window.routePointers??[]})"),
                                           indent=2), encoding="utf-8")
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
