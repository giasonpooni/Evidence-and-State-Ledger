"""Dependency-free adversarial tests of the pre-import source pin gate."""

import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("esm_replay", Path(__file__).with_name("instrument-replay-verify.py"))
ADAPTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ADAPTER)


class SourcePinTests(unittest.TestCase):
    def test_schema_selects_only_allowlisted_native_lanes(self):
        module, required, optional = ADAPTER.workflow_spec('ciw.calibrated-observable-session.v1')
        self.assertEqual(module, 'ciw.calibrated_observable')
        self.assertEqual(required, {'ciw', 'fsrt', 'tbrt', 'mcur', 'oit', 'gsie', 'cbsr', 'fdir', 'set'})
        self.assertEqual(optional, set())
        for schema in ('arbitrary.module', 'ciw.identified-design-session.v1', None, {}):
            with self.assertRaises(ValueError):
                ADAPTER.workflow_spec(schema)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="esm-pin-test-")
        self.root = Path(self.temporary.name)
        self.git("init", "--quiet")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "user.name", "Local test")
        (self.root / "kernel.py").write_text("VALUE = 1\n")
        (self.root / ".gitignore").write_text("ignored.py\n__pycache__/\n")
        self.git("add", ".")
        self.git("commit", "--quiet", "-m", "Synthetic source pin")
        self.pin = {"path": str(self.root), "revision": self.git("rev-parse", "HEAD")}

    def tearDown(self):
        self.temporary.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.root), *args], text=True).strip()

    def test_clean_exact_source(self):
        self.assertEqual(ADAPTER.checkout(self.pin), self.root)

    def test_assume_unchanged_cannot_hide_modified_source(self):
        self.git("update-index", "--assume-unchanged", "kernel.py")
        (self.root / "kernel.py").write_text("VALUE = 'untrusted'\n")
        self.assertEqual(self.git("status", "--porcelain"), "")
        with self.assertRaisesRegex(ValueError, "source bytes"):
            ADAPTER.checkout(self.pin)

    def test_skip_worktree_cannot_hide_modified_source(self):
        self.git("update-index", "--skip-worktree", "kernel.py")
        (self.root / "kernel.py").write_text("VALUE = 'untrusted'\n")
        with self.assertRaisesRegex(ValueError, "source bytes"):
            ADAPTER.checkout(self.pin)

    def test_ignored_module_is_not_an_approved_import(self):
        (self.root / "ignored.py").write_text("raise RuntimeError('shadow')\n")
        self.assertEqual(self.git("status", "--porcelain"), "")
        with self.assertRaisesRegex(ValueError, "ignored"):
            ADAPTER.checkout(self.pin)

    def test_import_symlink_refused_even_when_committed(self):
        (self.root / "link.py").symlink_to(self.root / "kernel.py")
        self.git("add", "link.py")
        self.git("commit", "--quiet", "-m", "Synthetic symlink")
        self.pin["revision"] = self.git("rev-parse", "HEAD")
        with self.assertRaisesRegex(ValueError, "links"):
            ADAPTER.checkout(self.pin)

    def test_duplicate_and_nonfinite_json_refused(self):
        for text in ('{"pin":1,"pin":2}', '{"value":NaN}', '{"value":Infinity}', '{"value":1e999}', '{"value":1e-999}'):
            with self.assertRaises(ValueError):
                ADAPTER.strict_json(text)

    def test_git_replacement_cannot_change_the_pinned_tree(self):
        original = self.pin["revision"]
        (self.root / "kernel.py").write_text("VALUE = 2\n")
        self.git("commit", "--quiet", "-am", "Replacement content")
        replacement = self.git("rev-parse", "HEAD")
        self.git("checkout", "--quiet", original)
        self.git("replace", original, replacement)
        # Git replacement metadata is ignored; the original pinned bytes pass.
        self.assertEqual(ADAPTER.checkout(self.pin), self.root)
        self.git("update-index", "--assume-unchanged", "kernel.py")
        (self.root / "kernel.py").write_text("VALUE = 2\n")
        with self.assertRaises(ValueError):
            ADAPTER.checkout(self.pin)

    def test_only_standalone_ppda_may_have_an_unimported_vendor_gitlink(self):
        (self.root / "vendor" / "unimported").mkdir(parents=True)
        self.git("update-index", "--add", "--cacheinfo", f"160000,{self.pin['revision']},vendor/unimported")
        self.git("commit", "--quiet", "-m", "Unimported synthetic vendor gitlink")
        self.pin["revision"] = self.git("rev-parse", "HEAD")
        with self.assertRaises(ValueError):
            ADAPTER.checkout(self.pin)
        self.assertEqual(ADAPTER.checkout(self.pin, standalone_ppda=True), self.root)
        (self.root / "bridge" / "unapproved").mkdir(parents=True)
        self.git("update-index", "--add", "--cacheinfo", f"160000,{self.pin['revision']},bridge/unapproved")
        self.git("commit", "--quiet", "-m", "Import-root gitlink remains forbidden")
        self.pin["revision"] = self.git("rev-parse", "HEAD")
        with self.assertRaises(ValueError):
            ADAPTER.checkout(self.pin, standalone_ppda=True)


if __name__ == "__main__":
    unittest.main()
