"""KQL terminal reliability checks against a running production preview."""
import argparse
import re
import time
import urllib.error
import urllib.request

from playwright.sync_api import expect, sync_playwright


def enter(page, case_id="001", title="Heartbeat Hills"):
    page.get_by_role("button", name=f"Select case {case_id}: {title}", exact=True).click()
    page.get_by_role("button", name="Open case file", exact=True).click()
    page.get_by_role("button", name="Choose recruit", exact=True).click()
    page.get_by_role("button", name="Deploy QUILL", exact=True).click()
    page.get_by_role("button", name="Begin investigation", exact=True).click()
    page.wait_for_function("window.__kql?.game.scene.getScene('Game')?.player?.body?.blocked.down")


def open_terminal(page, index=0):
    identity = page.evaluate("""index => {
      const s=__kql.game.scene.getScene('Game'),id=s.caseDef.challenges[index].id;
      const t=s.interactables.find(i=>i.obj.challengeId===id);
      s.player.body.reset(t.x,t.y);
      return id;
    }""", index)
    page.wait_for_function("""id => {
      const s=__kql.game.scene.getScene('Game');
      return s.nearest?.challengeId===id && s.time.now>=s.interactLockUntil;
    }""", arg=identity)
    page.keyboard.press("e")
    expect(page.locator(".terminal-modal")).to_be_visible()
    if page.get_by_role("button", name="Got it \u2014 show me the task", exact=True).count():
        expect(page.locator(".learn-pane .result-wrap table")).to_be_visible()
        page.get_by_role("button", name="Got it \u2014 show me the task", exact=True).click()
    return page.get_by_role("combobox", name="KQL query editor")


def close_terminal(page):
    page.get_by_role("button", name="Close (Esc)", exact=True).click()
    expect(page.locator(".terminal-modal")).to_have_count(0)


def run(page):
    page.get_by_role("button", name=re.compile("^Run query")).click()


def record(page):
    return page.evaluate("localStorage.getItem('kql-quest-profile')")

def first_starter(page):
    return page.evaluate("__kql.game.scene.getScene('Game').caseDef.challenges[0].starter")


def check_drafts_and_results(page):
    enter(page)
    editor = open_terminal(page)
    before = record(page)
    page.evaluate("window.profileWrites=0")
    draft = 'Heartbeat\n| where Computer == "keep  spaces"\n| take 1'
    editor.fill(draft)
    assert record(page) == before
    assert page.evaluate("window.profileWrites") == 0
    close_terminal(page)
    editor = open_terminal(page)
    expect(editor).to_have_value(draft)
    # An intentional empty draft is different from having no draft.
    editor.fill("")
    close_terminal(page)
    editor = open_terminal(page)
    expect(editor).to_have_value("")
    editor.fill("Heartbeat | take 1")
    close_terminal(page)
    second = open_terminal(page, 1)
    second.fill("Heartbeat | distinct Computer")
    close_terminal(page)
    editor = open_terminal(page)
    expect(editor).to_have_value("Heartbeat | take 1")
    run(page)
    expect(page.locator(".verdict-box.incorrect")).to_be_visible()
    expect(page.locator(".result-block tbody tr")).to_have_count(1)
    editor.fill("Heartbeat | take 10")
    expect(page.locator(".verdict-box.stale")).to_contain_text("PREVIOUS RESULT")
    expect(page.locator(".checks li").last).not_to_have_class("done")
    expect(page.locator(".result-block")).to_contain_text("Previous run output")
    run(page)
    expect(page.locator(".verdict-box.correct")).to_be_visible()
    page.locator(".celebrate").wait_for(state="detached")
    expect(page.locator(".checks li").last).to_have_class("done")
    expect(page.locator(".result-block tbody tr")).to_have_count(10)
    expect(page.locator(".obj-count")).to_have_text("1/5")
    editor.fill("Heartbeat | take 1")
    expect(page.locator(".verdict-box.correct")).to_have_count(0)
    expect(page.locator(".verdict-box.stale")).to_be_visible()
    expect(page.locator(".checks li").last).not_to_have_class("done")
    expect(page.locator(".obj-count")).to_have_text("1/5")
    editor.fill("Heartbeat | take 10")
    expect(page.locator(".checks li").last).to_have_class("done")
    page.get_by_role("button", name="Format", exact=True).click()
    expect(page.locator(".verdict-box.stale")).to_be_visible()
    close_terminal(page)
    editor = open_terminal(page)
    expect(editor).to_have_value("Heartbeat\n| take 10")
    page.get_by_role("button", name="1 \u00b7 Learn", exact=True).click()
    expect(page.locator(".learn-pane .result-wrap table")).to_be_visible()
    page.get_by_role("button", name="Try this example myself", exact=True).click()
    example_draft = editor.input_value()
    close_terminal(page)
    editor = open_terminal(page)
    expect(editor).to_have_value(example_draft)
    page.get_by_role("button", name=re.compile("Full schema")).click()
    page.locator(".schema-table .schema-name").filter(has_text="AmaDiagnostics").click()
    schema_draft = editor.input_value()
    assert schema_draft.startswith("AmaDiagnostics")
    close_terminal(page)
    editor = open_terminal(page)
    expect(editor).to_have_value(schema_draft)
    page.get_by_role("button", name=re.compile("Stuck\\?")).click()
    page.get_by_role("button", name=re.compile("^Show solution")).click()
    page.get_by_role("button", name="Copy into editor", exact=True).click()
    solution_draft = editor.input_value()
    close_terminal(page)
    editor = open_terminal(page)
    expect(editor).to_have_value(solution_draft)
    # Every programmatic edit must invalidate the last result too.
    page.get_by_role("button", name="Reset", exact=True).click()
    expect(page.locator(".verdict-box")).to_have_count(0)
    expect(page.locator(".result-block table")).to_have_count(0)
    expect(page.locator(".solved-flag")).to_be_visible()
    close_terminal(page)
    editor = open_terminal(page)
    expect(editor).to_have_value(first_starter(page))
    close_terminal(page)
    page.get_by_role("button", name="Abandon", exact=True).click()
    page.wait_for_function("!window.__kql")
    enter(page, "002", "Signal Harbor")
    editor = open_terminal(page)
    expect(editor).to_have_value(first_starter(page))
    editor.fill("some unfinished second-case draft")
    close_terminal(page)
    page.get_by_role("button", name="Abandon", exact=True).click()
    page.wait_for_function("!window.__kql")
    enter(page)
    editor = open_terminal(page)
    expect(editor).to_have_value(first_starter(page))
    close_terminal(page)
    page.get_by_role("button", name="Abandon", exact=True).click()
    page.wait_for_function("!window.__kql")
    print("Drafts, empty drafts, independent terminals/cases, reset and stale results passed.", flush=True)

WORKER_ASSET = "**/assets/query.worker-*.js"
BLOCKED_WORKER = """
self.onmessage=()=>{while(true){}};
self.postMessage({kind:'ready'});
"""


def check_worker_recovery(page):
    enter(page)
    editor = open_terminal(page)
    editor.fill("Heartbeat | take 10")
    page.wait_for_function("workerStats.active===0")
    before = record(page)

    def unchanged():
        assert record(page) == before, "Failed/cancelled work changed the saved profile"
        expect(page.locator(".obj-count")).to_have_text("0/5")
        assert page.evaluate("__kql.game.scene.getScene('Game').gateSprites.some(g=>g.sprite.body?.enable)")

    def use_fixture(source):
        page.route(WORKER_ASSET, lambda route: route.fulfill(content_type="text/javascript", body=source))

    def finished():
        page.wait_for_function("workerStats.active===0")
        expect(page.get_by_role("button", name=re.compile("^Run query"))).to_be_enabled()
        unchanged()

    # All intentional stalls are isolated in real workers and terminated by the
    # application. No pathological regex or synchronous main-thread loop is used.
    use_fixture(BLOCKED_WORKER)
    run(page)
    expect(page.get_by_role("button", name="Cancel query", exact=True)).to_be_visible()
    page.wait_for_function("workerStats.gradeRequests>0")
    ticks = page.evaluate("window.uiTicks")
    page.wait_for_timeout(200)
    assert page.evaluate("uiTicks") > ticks, "Blocked worker froze the UI thread"
    expect(page.get_by_role("alert")).to_contain_text("execution time limit", timeout=5000)
    finished()

    for action in ["cancel", "edit", "reset", "close"]:
        editor.fill("Heartbeat | take 10")
        baseline_starts = page.evaluate("workerStats.started")
        run(page)
        expect(page.get_by_role("button", name="Cancel query", exact=True)).to_be_visible()
        editor.press("Control+Enter")
        assert page.evaluate("workerStats.started") == baseline_starts + 1, "Duplicate Run spawned another worker"
        if action == "cancel":
            page.get_by_role("button", name="Cancel query", exact=True).click()
            expect(page.get_by_role("alert")).to_contain_text("cancelled")
            expect(editor).to_have_value("Heartbeat | take 10")
        elif action == "edit":
            editor.fill("Heartbeat | take 1")
            expect(page.get_by_role("alert")).to_contain_text("Query changed")
        elif action == "reset":
            page.get_by_role("button", name="Reset", exact=True).click()
            expect(editor).to_have_value(first_starter(page))
        else:
            close_terminal(page)
            page.wait_for_function("workerStats.active===0")
            editor = open_terminal(page)
            expect(editor).to_have_value("Heartbeat | take 10")
        finished()
    page.unroute(WORKER_ASSET)

    fixtures = [
        ("startup", "/* worker deliberately never signals readiness */", "could not start in time"),
        ("crash", "throw new Error('worker test failure')", "worker failed"),
        ("protocol", "self.onmessage=()=>self.postMessage({kind:'bad'});self.postMessage({kind:'ready'});", "malformed response"),
        ("reference", """
          self.onmessage=e=>self.postMessage({kind:'grade-result',id:e.data.id,
            result:{status:'error',errorSource:'reference',message:'Terminal malfunction (fixture)'}});
          self.postMessage({kind:'ready'});
        """, "No attempt recorded"),
    ]
    for name, source, message in fixtures:
        use_fixture(source)
        editor.fill("Heartbeat | take 10")
        run(page)
        expect(page.get_by_role("alert")).to_contain_text(message, timeout=13000)
        finished()
        page.unroute(WORKER_ASSET)
        print(f"Worker {name} failure: no score/attempt/gate changes, cleanup passed.", flush=True)

    # A delayed correct answer must not be applied after the draft changes.
    use_fixture("""
      self.onmessage=e=>setTimeout(()=>self.postMessage({
        kind:'grade-result',id:e.data.id,result:{status:'correct',message:'Accepted',
          table:{name:'Heartbeat',columns:['Value'],rows:[{Value:1}]}}
      }),700);
      self.postMessage({kind:'ready'});
    """)
    run(page)
    expect(page.get_by_role("button", name="Cancel query", exact=True)).to_be_visible()
    editor.fill("Heartbeat | take 1")
    page.wait_for_timeout(900)
    expect(page.locator(".verdict-box.correct")).to_have_count(0)
    finished()
    page.unroute(WORKER_ASSET)

    # Blocked query cancelled by leaving the entire run cannot affect a new case.
    use_fixture(BLOCKED_WORKER)
    run(page)
    expect(page.get_by_role("button", name="Cancel query", exact=True)).to_be_visible()
    page.get_by_role("button", name="Abandon", exact=True).evaluate("(button)=>button.click()")
    page.wait_for_function("!window.__kql && workerStats.active===0")
    page.unroute(WORKER_ASSET)
    enter(page, "002", "Signal Harbor")
    editor = open_terminal(page)
    expect(editor).to_have_value(first_starter(page))
    unchanged()
    editor.fill("Heartbeat | take 10")
    run(page)
    expect(page.locator(".verdict-box.correct")).to_be_visible()
    page.locator(".celebrate").wait_for(state="detached")
    page.wait_for_function("workerStats.active===0")
    expect(page.locator(".obj-count")).to_have_text("1/5")
    close_terminal(page)
    page.get_by_role("button", name="Abandon", exact=True).click()
    page.wait_for_function("!window.__kql")
    print("Actual timeout, cancellation, stale response, duplicate Run and fresh-worker recovery passed.", flush=True)


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
            page.add_init_script("""(() => {
              const original=Storage.prototype.setItem;
              window.profileWrites=0;
              Storage.prototype.setItem=function(key,value){
                if(key==='kql-quest-profile')window.profileWrites++;
                return original.call(this,key,value);
              };
              window.workerStats={started:0,active:0,gradeRequests:0};
              const NativeWorker=window.Worker;
              window.Worker=class extends NativeWorker{
                constructor(...args){super(...args);workerStats.started++;workerStats.active++;this.stopped=false;}
                postMessage(job,...rest){
                  if(job.kind==='grade')workerStats.gradeRequests++;
                  return super.postMessage(job,...rest);
                }
                terminate(){
                  if(!this.stopped){this.stopped=true;workerStats.active--;}
                  return super.terminate();
                }
              };
              window.uiTicks=0;
              setInterval(()=>window.uiTicks++,30);
            })();""")
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until="networkidle")
            check_drafts_and_results(page)
            check_worker_recovery(page)
            assert not errors, errors
        finally:
            browser.close()


if __name__ == "__main__":
    main()
