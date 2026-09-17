"""Real-renderer smoke tests. Run against a production preview with Playwright."""
import argparse
import re
import time
import urllib.error
import urllib.request

from playwright.sync_api import expect, sync_playwright


def enter_game(page, case_id, title, recruit):
    page.get_by_role("button", name=f"Select case {case_id}: {title}", exact=True).click()
    page.get_by_role("button", name="Open case file", exact=True).click()
    page.get_by_role("button", name="Choose recruit", exact=True).click()
    page.get_by_role("button", name=re.compile(f"^{recruit}")).click()
    page.get_by_role("button", name=f"Deploy {recruit}", exact=True).click()
    page.get_by_role("button", name="Begin investigation", exact=True).click()
    page.wait_for_function("""id => {
      const s=window.__kql?.game.scene.getScene('Game');
      return s?.caseDef.id===id && s.player?.body?.blocked.down;
    }""", arg=case_id)


def interact(page, kind, index=0):
    identity = page.evaluate("""([kind,index]) => {
      const s=__kql.game.scene.getScene('Game');
      const t=kind==='terminal'
        ? s.interactables.find(i=>i.obj.challengeId===s.caseDef.challenges[index].id)
        : s.interactables.find(i=>i.obj.kind===kind);
      if(!t)throw Error('Missing '+kind);
      s.player.body.reset(t.x,t.y);
      return t.obj.noteId ?? t.obj.challengeId ?? 'verdict';
    }""", [kind, index])
    page.wait_for_function("""([kind,id]) => {
      const s=__kql.game.scene.getScene('Game'),n=s.nearest;
      return n?.kind===kind && (n.noteId??n.challengeId??'verdict')===id &&
        s.time.now>=s.interactLockUntil;
    }""", arg=[kind, identity])
    page.keyboard.press("e")
    expect(page.get_by_role("dialog")).to_be_visible()
    return identity


def test_gameplay(page):
    cases = [("001", "Heartbeat Hills"), ("002", "Signal Harbor"), ("003", "Relay Ruins")]
    for case_id, title in cases:
        enter_game(page, case_id, title, "QUILL")
        notes_title = page.evaluate("__kql.game.scene.getScene('Game').caseDef.level.notes[0].title")
        interact(page, "note")
        page.get_by_role("button", name="Pocket it", exact=True).click()
        page.get_by_role("button", name="Notes (1) (Tab)", exact=True).click()
        expect(page.get_by_role("region", name="Pocketed field notes")).to_contain_text(notes_title)
        page.locator(".notebook-modal").get_by_role("button", name="Esc", exact=True).click()
        challenges = page.evaluate("""__kql.game.scene.getScene('Game').caseDef.challenges
          .map(c=>({id:c.id,query:c.solution,gate:c.unlocksGate}))""")
        for index, challenge in enumerate(challenges):
            interact(page, "terminal", index)
            page.wait_for_function("!__kql.game.loop.running")
            before = page.evaluate("""() => {
              const g=__kql.game; window.renders=0;
              g.events.on('postrender',()=>window.renders++);
              return g.scene.getScene('Game').player.x;
            }""")
            page.wait_for_timeout(120)
            assert page.evaluate("window.renders") == 0
            assert page.evaluate("__kql.game.scene.getScene('Game').player.x") == before
            page.get_by_role("button", name="2 \u00b7 Solve it", exact=True).click()
            page.get_by_role("combobox", name="KQL query editor").fill(challenge["query"])
            page.get_by_role("button", name=re.compile("^Run query")).click()
            expect(page.locator(".verdict-box.correct")).to_be_visible()
            page.locator(".celebrate").wait_for(state="detached")
            expect(page.locator(".result-block table")).to_be_visible()
            assert page.evaluate("""id => __kql.game.scene.getScene('Game').gateSprites
              .filter(g=>g.gateId===id).every(g=>!g.sprite.body?.enable)""", challenge["gate"])
            page.get_by_role("button", name="Back to the field", exact=True).click()
            page.wait_for_function("__kql.game.loop.running")
            page.wait_for_function("""() => {
              const s=__kql.game.scene.getScene('Game');
              return s.children.list.every(o=>o.type!=='ParticleEmitter') &&
                Math.abs(s.cameras.main.zoom-2)<0.001;
            }""")
            assert page.evaluate("""id => __kql.game.scene.getScene('Game').gateSprites
              .filter(g=>g.gateId===id).every(g=>!g.sprite.active)""", challenge["gate"])
        interact(page, "verdict")
        correct = page.evaluate("""__kql.game.scene.getScene('Game').caseDef.rootCauses.find(o=>o.correct).label""")
        page.get_by_role("button", name=re.compile("^" + re.escape(correct))).click()
        page.evaluate("""() => {
          window.oldGame=__kql.game;window.destroyed=false;
          oldGame.events.once('destroy',()=>window.destroyed=true);
        }""")
        page.get_by_role("button", name="Submit verdict", exact=True).click()
        expect(page.locator(".debrief-main")).to_be_visible()
        page.wait_for_function("window.destroyed && !oldGame.loop.running")
        page.get_by_role("button", name="Replay case", exact=True).click()
        page.wait_for_function("""() => {
          const s=window.__kql?.game.scene.getScene('Game');
          return s?.player?.body?.blocked.down && __kql.game!==oldGame;
        }""")
        expect(page.locator(".obj-count")).to_have_text("0/5")
        page.get_by_role("button", name="Abandon", exact=True).click()
        page.wait_for_function("!window.__kql")


def test_pixels(page, zoom):
    # Compare actual rendered pixels to the same authored CanvasTexture drawn
    # directly in 2D. This catches missing/inverted uploads and incorrect Bob
    # coordinates without pinning a screenshot to GPU-specific text antialiasing.
    result = page.evaluate("""zoom => new Promise(resolve => {
      const {game}=__kql,s=game.scene.getScene('Game'),cam=s.cameras.main;
      s.frozen=true;s.physics.pause();s.tweens.killAll();
      s.children.list.forEach(o=>o.setVisible(false));
      cam.stopFollow();cam.resetFX();cam.removeBounds();cam.setOrigin(0,0);
      cam.setZoom(zoom);cam.setScroll(0,0);cam.setBackgroundColor(0x0d0b1a);
      const probes=[
        {key:'tile_top',x:8,y:8,w:16,h:16,kind:'bob'},
        {key:'quill_idle0',x:32,y:8,w:16,h:24,kind:'image'},
        {key:'terminal_locked',x:56,y:8,w:16,h:19,kind:'image'},
        {key:'terminal_solved',x:80,y:8,w:16,h:19,kind:'image'},
        {key:'spike',x:104,y:8,w:16,h:16,kind:'image'},
        {key:'skyline_far',x:0,y:50,w:336,h:120,kind:'tile'},
      ];
      for(const probe of probes) {
        if(probe.kind==='bob')s.add.blitter(0,0,probe.key).create(probe.x,probe.y);
        else if(probe.kind==='tile')s.add.tileSprite(probe.x,probe.y,probe.w,probe.h,probe.key)
          .setOrigin(0).setTilePosition(37,0);
        else s.add.image(probe.x,probe.y,probe.key).setOrigin(0);
      }
      game.events.once('postrender',()=>{
        const png=game.canvas.toDataURL();
        const image=new Image();
        image.onload=()=>{
          const actual=document.createElement('canvas');actual.width=640;actual.height=360;
          const a=actual.getContext('2d');a.drawImage(image,0,0);
          const expected=document.createElement('canvas');expected.width=640;expected.height=360;
          const e=expected.getContext('2d');e.imageSmoothingEnabled=false;
          e.fillStyle='#0d0b1a';e.fillRect(0,0,640,360);e.scale(zoom,zoom);
          for(const probe of probes) {
            let source=s.textures.get(probe.key).getSourceImage();
            if(probe.kind==='tile'){
              const tiled=document.createElement('canvas');tiled.width=probe.w;tiled.height=probe.h;
              const t=tiled.getContext('2d');t.imageSmoothingEnabled=false;
              for(let x=-37;x<probe.w;x+=source.width)t.drawImage(source,x,0);
              source=tiled;
            }
            // Canvas batchSprite deliberately expands rounded image quads by
            // half a pixel (including TileSprites); Blitters keep exact dimensions.
            const bias=game.renderer.type===1 && probe.kind!=='bob' ? 0.5 : 0;
            e.drawImage(source,0,0,probe.w,probe.h,probe.x,probe.y,probe.w+bias,probe.h+bias);
          }
          const aa=a.getImageData(0,0,640,360).data,ee=e.getImageData(0,0,640,360).data;
          let differing=0;const samples=[];
          for(let i=0;i<aa.length;i+=4){
            if(aa[i]!==ee[i] || aa[i+1]!==ee[i+1] || aa[i+2]!==ee[i+2] || aa[i+3]!==ee[i+3]){
              differing++;if(samples.length<3)samples.push({x:i/4%640,y:Math.floor(i/4/640),
                actual:[...aa.slice(i,i+4)],expected:[...ee.slice(i,i+4)]});
            }
          }
          resolve({differing,samples,objects:s.children.list.filter(o=>o.visible && o.texture).map(o=>({
            key:o.texture.key,x:o.x,y:o.y,width:o.width,height:o.height,
            displayWidth:o.displayWidth,displayHeight:o.displayHeight,
            frame:[o.frame?.width,o.frame?.height,o.frame?.cutWidth,o.frame?.cutHeight]
          }))});
        };
        image.onerror=()=>resolve({error:'Cannot decode render capture'});
        image.src=png;
      });
    })""", zoom)
    assert result.get("differing") == 0, f"Zoom {zoom} texture pixels: {result}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173/")
    parser.add_argument("--channel", default="chromium", help="chromium, msedge or chrome")
    parser.add_argument("--canvas", action="store_true", help="Disable WebGL to exercise AUTO's Canvas fallback")
    parser.add_argument("--pixels-only", action="store_true", help="Only run the two pixel-orientation fixtures")
    args = parser.parse_args()
    deadline = time.monotonic() + 20
    while True:
        try:
            with urllib.request.urlopen(args.url, timeout=2) as response:
                if response.status != 200:
                    raise RuntimeError(f"Preview returned HTTP {response.status}")
            break
        except urllib.error.URLError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.25)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel=args.channel, headless=True)
        try:
            context = browser.new_context(viewport={"width": 1440, "height": 1080})
            if args.canvas:
                context.add_init_script("""(() => {
                  const get=HTMLCanvasElement.prototype.getContext;
                  HTMLCanvasElement.prototype.getContext=function(type,...args){
                    return type.includes('webgl') ? null : get.call(this,type,...args);
                  };
                })();""")
            page = context.new_page()
            page.set_default_timeout(15000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until="networkidle")
            assert not page.evaluate("""performance.getEntriesByType('resource')
              .some(r=>/assets\\/(PhaserGame|phaser)-/.test(r.name))"""), "Phaser downloaded on menu"
            if not args.pixels_only:
                test_gameplay(page)
                print("All three cases: notes, 15 queries, gates, effects cleanup, sleep/resume and replay passed.", flush=True)
            for recruit in ([] if args.pixels_only else ["QUILL", "SPARKY", "VELL", "CIRCUIT"]):
                enter_game(page, "001", "Heartbeat Hills", recruit)
                assert page.evaluate("__kql.game.renderer.type") == (1 if args.canvas else 2)
                before = page.evaluate("__kql.game.scene.getScene('Game').player.x")
                page.keyboard.down("d")
                page.wait_for_timeout(220)
                page.keyboard.up("d")
                assert page.evaluate("__kql.game.scene.getScene('Game').player.x") > before + 5
                page.wait_for_function("__kql.game.scene.getScene('Game').player.body.blocked.down")
                page.keyboard.down("Space")
                page.wait_for_timeout(65)
                assert page.evaluate("__kql.game.scene.getScene('Game').player.body.velocity.y") < 0
                page.keyboard.up("Space")
                page.keyboard.press("o")
                page.wait_for_function("!__kql.game.loop.running")
                page.evaluate("""() => {
                  window.oldGame=__kql.game;window.oldScene=oldGame.scene.getScene('Game');
                  window.destroyed=false;oldGame.events.once('destroy',()=>window.destroyed=true);
                }""")
                # Explicit React teardown while still covered/sleeping.
                page.get_by_role("button", name="Abandon", exact=True).evaluate("(button)=>button.click()")
                page.wait_for_function("destroyed && !oldGame.loop.running && oldScene.busOff.length===0")
            if not args.pixels_only:
                print("All four recruits: run/jump and sleeping teardown passed.", flush=True)
            for zoom in [1, 2]:
                enter_game(page, "001", "Heartbeat Hills", "QUILL")
                test_pixels(page, zoom)
                page.get_by_role("button", name="Abandon", exact=True).click()
                page.wait_for_function("!window.__kql")
            assert not errors, errors
            print(f"Pixel orientation, Blitter terrain and native skyline sampling passed at 1x/2x ({'Canvas' if args.canvas else 'WebGL'}).")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
