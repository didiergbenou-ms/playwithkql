"""Exercise all nine case/difficulty combinations with their five placeholder tasks."""
import argparse
import json
import re
import time
import urllib.error
import urllib.request

from playwright.sync_api import expect, sync_playwright

DIFFICULTIES = [("beginner", "Beginner"), ("intermediate", "Intermediate"), ("expert", "Expert")]
CASES = [("001", "Heartbeat Hills"), ("002", "Signal Harbor"), ("003", "Relay Ruins")]


def profile(page):
    return page.evaluate("JSON.parse(localStorage.getItem('kql-quest-profile')).state.profile")


def choose_case(page, case_id, title):
    page.get_by_role("button", name=f"Select case {case_id}: {title}", exact=True).click()
    page.get_by_role("button", name="Open case file", exact=True).click()
    expect(page.get_by_role("heading", name="Choose difficulty", exact=True)).to_be_visible()


def enter(page, case_id, title, difficulty, label):
    choose_case(page, case_id, title)
    page.get_by_role("button", name=f"Select {label} difficulty", exact=True).click()
    expect(page.get_by_role("button", name=f"Select {label} difficulty", exact=True)).to_have_attribute("aria-pressed", "true")
    page.get_by_role("button", name="Choose recruit", exact=True).click()
    expect(page.locator(".select-head .case-difficulty")).to_contain_text(label)
    page.get_by_role("button", name="Deploy QUILL", exact=True).click()
    expect(page.locator(".briefing .case-difficulty")).to_contain_text(label)
    page.get_by_role("button", name="Begin investigation", exact=True).click()
    page.wait_for_function("""([id,difficulty])=>{
      const s=window.__kql?.game.scene.getScene('Game');
      return s?.caseDef.id===id && s.caseDef.difficulty===difficulty && s.player?.body?.blocked.down;
    }""", arg=[case_id, difficulty])
    expect(page.locator(".hud-case .case-difficulty")).to_contain_text(label)


def interact(page, kind, identity=None):
    selected = page.evaluate("""([kind,id])=>{
      const s=__kql.game.scene.getScene('Game');
      const t=s.interactables.find(i=>i.obj.kind===kind && (!id || i.obj.challengeId===id));
      if(!t)throw Error('Missing target '+kind+' '+id);
      s.player.body.reset(t.x,t.y);
      return t.obj.challengeId ?? t.obj.noteId ?? 'verdict';
    }""", [kind, identity])
    page.wait_for_function("""([kind,id])=>{
      const s=__kql.game.scene.getScene('Game'),n=s.nearest;
      return n?.kind===kind && (n.challengeId??n.noteId??'verdict')===id && s.time.now>=s.interactLockUntil;
    }""", arg=[kind, selected])
    page.keyboard.press("e")
    expect(page.get_by_role("dialog")).to_be_visible()


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
    legacy = {
        "lifetimeScore": 1234, "bestScore": 700, "casesClosed": 2,
        "totalQueries": 8, "achievements": ["first-query"], "character": "quill",
    }
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=args.channel, headless=True)
        try:
            context = browser.new_context(viewport={"width": 1440, "height": 1080}, reduced_motion="reduce")
            page = context.new_page()
            page.set_default_timeout(15000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until="networkidle")
            page.evaluate("(profile)=>localStorage.setItem('kql-quest-profile',JSON.stringify({state:{profile},version:0}))", legacy)
            page.reload(wait_until="networkidle")
            for key, value in legacy.items():
                assert profile(page)[key] == value, f"Legacy profile lost {key}"
            assert not profile(page).get("caseResults"), "Legacy aggregate history was assigned to difficulty records"
            expect(page.get_by_role("group", name="Available case files").get_by_role("button")).to_have_count(3)
            choose_case(page, *CASES[0])
            assert not page.evaluate("""performance.getEntriesByType('resource')
                .some(r=>/assets\\/(PhaserGame|phaser)-/.test(r.name))"""), "Engine loaded before recruit selection"
            page.get_by_role("button", name="Select Expert difficulty", exact=True).click()
            page.get_by_role("button", name="Choose recruit", exact=True).click()
            page.get_by_role("button", name="Back", exact=True).click()
            expect(page.get_by_role("button", name="Select Expert difficulty", exact=True)).to_have_attribute("aria-pressed", "true")
            page.get_by_role("button", name="Back to cases", exact=True).click()
            completed = set()
            query_count = 0
            for case_id, title in CASES:
                for difficulty, label in DIFFICULTIES:
                    enter(page, case_id, title, difficulty, label)
                    expect(page.locator(".obj-count")).to_have_text("0/5")
                    challenges = page.evaluate("""__kql.game.scene.getScene('Game').caseDef.challenges
                        .map(c=>({id:c.id,solution:c.solution,starter:c.starter,gate:c.unlocksGate}))""")
                    assert len(challenges) == 5
                    interact(page, "note")
                    page.get_by_role("button", name="Pocket it", exact=True).click()
                    expect(page.get_by_role("button", name="Notes (1) (Tab)", exact=True)).to_be_visible()
                    for index, challenge in enumerate(challenges):
                        interact(page, "terminal", challenge["id"])
                        expect(page.locator(".terminal-modal .case-difficulty")).to_contain_text(label)
                        expect(page.locator(".terminal-modal .case-difficulty")).to_contain_text("Questions pending")
                        page.get_by_role("button", name="2 \u00b7 Solve it", exact=True).click()
                        editor = page.get_by_role("combobox", name="KQL query editor")
                        if index == 0:
                            assert not editor.input_value().startswith("previous-difficulty-draft")
                        editor.fill(challenge["solution"])
                        page.get_by_role("button", name=re.compile("^Run query")).click()
                        expect(page.locator(".verdict-box.correct")).to_be_visible()
                        page.locator(".celebrate").wait_for(state="detached")
                        expect(page.locator(".result-block table")).to_be_visible()
                        assert page.evaluate("""id=>__kql.game.scene.getScene('Game').gateSprites
                          .filter(g=>g.gateId===id).every(g=>!g.sprite.body?.enable)""", challenge["gate"])
                        page.get_by_role("button", name="Back to the field", exact=True).click()
                        expect(page.locator(".obj-count")).to_have_text(f"{index+1}/5")
                        query_count += 1
                    interact(page, "verdict")
                    correct = page.evaluate("__kql.game.scene.getScene('Game').caseDef.rootCauses.find(o=>o.correct).label")
                    page.get_by_role("button", name=re.compile("^" + re.escape(correct))).click()
                    page.get_by_role("button", name="Submit verdict", exact=True).click()
                    expect(page.locator(".debrief-main .case-difficulty")).to_contain_text(label)
                    completed.add(f"{case_id}:{difficulty}")
                    records = profile(page).get("caseResults", {})
                    assert set(records) == completed, records
                    assert records[f"{case_id}:{difficulty}"]["completions"] == 1
                    assert records[f"{case_id}:{difficulty}"]["bestScore"] > 0
                    page.get_by_role("button", name="Replay case", exact=True).click()
                    page.wait_for_function("""([id,d])=>{
                      const s=window.__kql?.game.scene.getScene('Game');
                      return s?.caseDef.id===id && s.caseDef.difficulty===d && s.player?.body?.blocked.down;
                    }""", arg=[case_id, difficulty])
                    expect(page.locator(".obj-count")).to_have_text("0/5")
                    expect(page.get_by_role("button", name="Notes (0) (Tab)", exact=True)).to_be_visible()
                    interact(page, "terminal", challenges[0]["id"])
                    page.get_by_role("button", name="2 \u00b7 Solve it", exact=True).click()
                    page.get_by_role("combobox", name="KQL query editor").fill("previous-difficulty-draft")
                    page.get_by_role("button", name="Close (Esc)", exact=True).click()
                    page.get_by_role("button", name="Abandon", exact=True).click()
                    page.wait_for_function("!window.__kql")
                    choose_case(page, case_id, title)
                    card = page.get_by_role("button", name=f"Select {label} difficulty", exact=True)
                    expect(card).to_contain_text("Completed 1 time")
                    for other, other_label in DIFFICULTIES:
                        other_card = page.get_by_role("button", name=f"Select {other_label} difficulty", exact=True)
                        expect(other_card).to_contain_text("Completed 1 time" if f"{case_id}:{other}" in completed else "Not completed")
                    page.get_by_role("button", name="Back to cases", exact=True).click()
                    print(f"{case_id}/{difficulty}: five queries, gates, scoped completion and fresh replay passed.", flush=True)
            assert query_count == 45
            final = profile(page)
            assert final["casesClosed"] == legacy["casesClosed"] + 9
            assert final["totalQueries"] == legacy["totalQueries"] + 45
            assert page.evaluate("Object.keys(JSON.parse(localStorage.getItem('kql-quest-profile')).state)") == ["profile"]
            page.reload(wait_until="networkidle")
            assert profile(page)["caseResults"] == final["caseResults"]
            page.get_by_role("button", name="Reset profile", exact=True).click()
            assert not profile(page).get("caseResults")
            assert profile(page)["casesClosed"] == 0
            assert not errors, errors
            print("All 45 terminal slots, legacy profile preservation, persistence and reset passed.")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
