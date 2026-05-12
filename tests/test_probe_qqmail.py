import json
import tempfile
import unittest
from pathlib import Path

from scripts.probe_qqmail import (
    clamp_sample_limit,
    load_dotenv_values,
    redact_secret,
    write_jsonl_event,
)


class ProbeQqmailUnitTests(unittest.TestCase):
    def test_load_dotenv_values_parses_simple_env_without_exposing_comments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text(
                "# comment\nQQMAIL_EMAIL=user@qq.com\nQQMAIL_KEY = secret-value\n",
                encoding="utf-8",
            )

            values = load_dotenv_values(env_path)

        self.assertEqual(values["QQMAIL_EMAIL"], "user@qq.com")
        self.assertEqual(values["QQMAIL_KEY"], "secret-value")
        self.assertNotIn("# comment", values)

    def test_redact_secret_never_returns_raw_secret(self) -> None:
        redacted = redact_secret("abcdef123456")

        self.assertNotEqual(redacted, "abcdef123456")
        self.assertIn("len=12", redacted)

    def test_clamp_sample_limit_defaults_and_caps(self) -> None:
        self.assertEqual(clamp_sample_limit(None), 10)
        self.assertEqual(clamp_sample_limit("200"), 10)
        self.assertEqual(clamp_sample_limit("3"), 3)
        self.assertEqual(clamp_sample_limit("bad"), 10)

    def test_write_jsonl_event_creates_parent_and_appends_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "logs" / "run.jsonl"

            write_jsonl_event(path, {"event": "probe_started"})
            write_jsonl_event(path, {"event": "probe_finished", "ok": True})

            lines = path.read_text(encoding="utf-8").splitlines()

        self.assertEqual(json.loads(lines[0])["event"], "probe_started")
        self.assertTrue(json.loads(lines[1])["ok"])


if __name__ == "__main__":
    unittest.main()
