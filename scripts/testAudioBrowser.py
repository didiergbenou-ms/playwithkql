"""Focused touch audio activation/recovery; does not verify physical speakers."""
import argparse
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4173/")
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", headless=True)
        context = browser.new_context(viewport={"width": 393, "height": 700}, is_mobile=True, has_touch=True)
        try:
            # Stricter-than-Chromium fixture: only release/click/key handlers
            # can resume. Actual audio nodes/context still come from Web Audio.
            context.add_init_script("""(()=>{
              window.audioProbe={ctx:null,starts:0,resumes:0,blocked:0,gesture:false,delay:false,waiters:[]};
              for(const event of ['pointerup','touchend','click','keydown']){
                window.addEventListener(event,e=>{
                  audioProbe.gesture=e.isTrusted;
                  setTimeout(()=>{audioProbe.gesture=false;},0);
                },true);
              }
              const Native=window.AudioContext;
              window.AudioContext=class extends Native{
                constructor(...args){super(...args);audioProbe.ctx=this;void super.suspend();}
                resume(){
                  audioProbe.resumes++;
                  if(!audioProbe.gesture){
                    audioProbe.blocked++;
                    return Promise.reject(new Error('Audio gesture required by test fixture'));
                  }
                  if(audioProbe.delay){
                    return new Promise(resolve=>audioProbe.waiters.push(()=>super.resume().then(resolve)));
                  }
                  return super.resume();
                }
                createOscillator(){
                  const node=super.createOscillator(),start=node.start.bind(node);
                  node.start=(...args)=>{audioProbe.starts++;return start(...args);};
                  return node;
                }
              };
            })();""")
            page = context.new_page()
            page.set_default_timeout(15000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until="networkidle")
            page.wait_for_function("audioProbe.ctx?.state==='suspended' && audioProbe.blocked>0")
            page.get_by_role("button", name="Options \u2014 music & sound", exact=True).tap()
            page.wait_for_function("audioProbe.ctx.state==='running'")
            music = page.locator(".opt-group").filter(has=page.get_by_role("heading", name="Music", exact=True))
            music.get_by_role("button", name="On", exact=True).tap()
            await_resume_count = page.evaluate("audioProbe.resumes")
            page.evaluate("audioProbe.ctx.suspend()")
            sources_before = page.evaluate("audioProbe.starts")
            page.get_by_role("button", name="Test effect", exact=True).tap()
            expect(page.get_by_role("status")).to_contain_text("Audio engine is running")
            page.wait_for_function("before=>audioProbe.ctx.state==='running' && audioProbe.starts>=before+3", arg=sources_before)
            assert page.evaluate("audioProbe.resumes") > await_resume_count, "No resume after later interruption"
            if args.screenshots:
                page.screenshot(path=str(args.screenshots / "audio-options.png"))

            effects = page.locator(".opt-group").filter(has=page.get_by_role("heading", name="Sound effects", exact=True))
            effects.get_by_role("button", name="On", exact=True).tap()
            before = page.evaluate("audioProbe.starts")
            page.get_by_role("button", name="Test effect", exact=True).tap()
            expect(page.get_by_role("status")).to_contain_text("Turn on sound effects")
            assert page.evaluate("audioProbe.starts") == before, "Test effect bypassed the mute setting"
            effects.get_by_role("button", name="Off", exact=True).tap()
            page.evaluate("audioProbe.delay=true;audioProbe.ctx.suspend()")
            before = page.evaluate("audioProbe.starts")
            page.get_by_role("button", name="Test effect", exact=True).tap()
            page.wait_for_function("audioProbe.waiters.length>0")
            page.get_by_role("button", name="Close (Esc)", exact=True).tap()
            page.evaluate("""async()=>{
              audioProbe.delay=false;
              await Promise.all(audioProbe.waiters.splice(0).map(resume=>resume()));
            }""")
            assert page.evaluate("audioProbe.starts") == before, "A closed sound test played late"
            assert not errors, errors
            print("Touch-release activation, later resume, cue scheduling, mute settings and stale-test cancellation passed.")
            print("Physical iPhone speakers, Silent Mode and Bluetooth routing still require a handset check.")
        finally:
            context.close()
            browser.close()


if __name__ == "__main__":
    main()
