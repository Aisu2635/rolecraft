"""Unit tests for iam_state.py (the apply-exports job's dump comparison)."""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import iam_state as s  # noqa: E402


def state() -> dict:
    return {
        "roles": [
            {"name": "a", "attached_policies": ["arn:aws:iam::aws:policy/X"], "description": "d"},
            {"name": "b", "attached_policies": [], "description": "d"},
        ],
        "policies": [{"name": "p", "attachment_count": 1, "document": {"Version": "2012-10-17"}}],
        "eks_access_entries": [{"cluster": "prod"}],
        "nested": {"inner": {"leaf": 1, "keep": 2}},
    }


class DropPath(unittest.TestCase):
    def test_top_level_key(self) -> None:
        st = state()
        s.drop_path(st, "eks_access_entries")
        self.assertNotIn("eks_access_entries", st)
        self.assertIn("roles", st)

    def test_field_of_every_list_item(self) -> None:
        st = state()
        s.drop_path(st, "roles[].attached_policies")
        self.assertEqual(st["roles"], [{"name": "a", "description": "d"}, {"name": "b", "description": "d"}])
        self.assertEqual(st["policies"][0]["attachment_count"], 1)

    def test_nested_dict_key(self) -> None:
        st = state()
        s.drop_path(st, "nested.inner.leaf")
        self.assertEqual(st["nested"], {"inner": {"keep": 2}})

    def test_missing_paths_are_no_ops(self) -> None:
        st = state()
        for path in ("absent", "absent[].x", "roles[].absent", "nested.absent.leaf", "roles.name"):
            s.drop_path(st, path)
        self.assertEqual(st, state())

    def test_bad_paths_raise(self) -> None:
        for path in ("", "roles[]", "roles..name", "roles[].attached_policies[]"):
            with self.assertRaises(ValueError, msg=path):
                s.drop_path(state(), path)


class Compare(unittest.TestCase):
    def test_equal_dumps(self) -> None:
        self.assertEqual(s.compare(state(), state(), []), [])

    def test_ignored_field_difference_passes(self) -> None:
        other = state()
        other["roles"][0]["attached_policies"] = []
        other["policies"][0]["attachment_count"] = 0
        ignore = ["roles[].attached_policies", "policies[].attachment_count"]
        self.assertEqual(s.compare(state(), other, ignore), [])

    def test_ignore_is_field_level_only(self) -> None:
        other = state()
        other["roles"][0]["attached_policies"] = []
        other["roles"][0]["description"] = "changed"
        lines = s.compare(state(), other, ["roles[].attached_policies"])
        self.assertTrue(any('"description": "changed"' in line for line in lines))
        self.assertFalse(any("attached_policies" in line for line in lines))

    def test_inputs_are_not_mutated(self) -> None:
        a, b = state(), state()
        s.compare(a, b, ["roles[].attached_policies", "eks_access_entries"])
        self.assertEqual(a, state())
        self.assertEqual(b, state())

    def test_diff_command_exit_codes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base, other = os.path.join(tmp, "a.json"), os.path.join(tmp, "b.json")
            changed = state()
            changed["policies"][0]["attachment_count"] = 0
            for path, content in ((base, state()), (other, changed)):
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(content, f)
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(s.main(["iam_state.py", "diff", base, other]), 1)
                self.assertEqual(s.main(["iam_state.py", "diff", base, other, "--ignore", "policies[].attachment_count"]), 0)
                self.assertEqual(s.main(["iam_state.py", "diff", base, other, "--bogus", "x"]), 2)


class Helpers(unittest.TestCase):
    def test_strip_account(self) -> None:
        self.assertEqual(s.strip_account("arn:aws:iam::123456789012:role/x"), "arn:aws:iam::<account>:role/x")
        self.assertEqual(s.strip_account("arn:aws:iam::aws:policy/ReadOnlyAccess"), "arn:aws:iam::aws:policy/ReadOnlyAccess")

    def test_document_decodes_url_encoded_json(self) -> None:
        self.assertEqual(s.document("%7B%22Version%22%3A%20%222012-10-17%22%7D"), {"Version": "2012-10-17"})
        self.assertEqual(s.document({"Version": "2012-10-17"}), {"Version": "2012-10-17"})

    def test_eks_entries_counts_calls(self) -> None:
        events = [
            {"op": "rejected", "region": "r", "cluster": "c", "principal": "arn:aws:iam::123456789012:role/x"},
            {"op": "create-access-entry", "region": "r", "cluster": "c", "principal": "arn:aws:iam::123456789012:role/x"},
            {
                "op": "associate-access-policy",
                "region": "r",
                "cluster": "c",
                "principal": "arn:aws:iam::123456789012:role/x",
                "policy": "p",
                "scope": "type=cluster",
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            log = os.path.join(tmp, "eks.jsonl")
            with open(log, "w", encoding="utf-8") as f:
                f.writelines(json.dumps(e) + "\n" for e in events)
            entries = s.eks_entries(log)
        self.assertEqual(
            entries,
            [
                {
                    "region": "r",
                    "cluster": "c",
                    "principal": "arn:aws:iam::<account>:role/x",
                    "rejected_calls": 1,
                    "create_calls": 1,
                    "policies": [{"policy": "p", "scope": "type=cluster"}],
                },
            ],
        )


if __name__ == "__main__":
    unittest.main()
