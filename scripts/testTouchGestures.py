"""Unit checks for the remote touch driver; these never launch a browser."""
import copy
import unittest

from testMobileBrowser import Fingers


class FakeSession:
    def __init__(self, events):
        self.events = events

    def send(self, method, params):
        self.events.append(("send", method, copy.deepcopy(params)))


class FakeContext:
    def __init__(self, events):
        self.events = events

    def new_cdp_session(self, page):
        return FakeSession(self.events)


class FakeLocator:
    def __init__(self, name, events):
        self.name, self.events = name, events

    def bounding_box(self):
        self.events.append(("measure", self.name))
        return {"x": 10 if self.name == "Move right" else 200, "y": 600, "width": 56, "height": 56}


class FakePage:
    def __init__(self):
        self.events = []
        self.context = FakeContext(self.events)

    def get_by_role(self, role, name, exact):
        return FakeLocator(name, self.events)


class TouchGestureTests(unittest.TestCase):
    def test_running_jump_begins_both_fingers_in_one_event_after_measurement(self):
        page = FakePage()
        fingers = Fingers(page)
        fingers.down_many([(1, "Move right", 0), (2, "Jump", 0)])
        self.assertEqual(page.events[:2], [("measure", "Move right"), ("measure", "Jump")])
        self.assertEqual(len(page.events), 3)
        self.assertEqual(page.events[2][1], "Input.dispatchTouchEvent")
        self.assertEqual(page.events[2][2]["type"], "touchStart")
        self.assertEqual([point["id"] for point in page.events[2][2]["touchPoints"]], [1, 2])

    def test_releasing_jump_does_not_release_direction(self):
        page = FakePage()
        fingers = Fingers(page)
        fingers.down_many([(1, "Move right", 0), (2, "Jump", 0)])
        fingers.up(2)
        self.assertEqual(list(fingers.points), [1])
        self.assertEqual(page.events[-1][2]["type"], "touchEnd")
        self.assertEqual([point["id"] for point in page.events[-1][2]["touchPoints"]], [2])

    def test_duplicate_pointer_is_rejected_without_starting_another_gesture(self):
        page = FakePage()
        fingers = Fingers(page)
        fingers.down(1, "Move right")
        before = copy.deepcopy(page.events)
        with self.assertRaises(AssertionError):
            fingers.down_many([(1, "Jump", 0)])
        self.assertEqual(page.events, before)


if __name__ == "__main__":
    unittest.main()
