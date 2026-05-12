import json
import tempfile
import unittest
from pathlib import Path

from scripts.probe_qqmail import (
    build_readonly_operation_plan,
    clamp_sample_limit,
    load_dotenv_values,
    parse_fetch_summary,
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

    def test_build_readonly_operation_plan_is_preview_only(self) -> None:
        plan = build_readonly_operation_plan("run-1", "masked@qq.com")

        self.assertEqual(plan["provider"], "qqmail")
        self.assertEqual(plan["status"], "preview")
        self.assertTrue(plan["confirmationRequired"])
        self.assertEqual(plan["messageRefs"], [])
        self.assertEqual(plan["mutationsAttempted"], 0)

    def test_parse_fetch_summary_accepts_tuple_and_raw_bytes_responses(self) -> None:
        summaries = parse_fetch_summary([
            (b'1 (UID 42 FLAGS (\\Seen) INTERNALDATE "12-May-2026 19:00:00 +0800" RFC822.SIZE 1234)', b""),
            b'2 (UID 43 FLAGS () INTERNALDATE "12-May-2026 19:01:00 +0800" RFC822.SIZE 4321)',
        ])

        self.assertEqual(summaries[0]["uid"], "42")
        self.assertEqual(summaries[0]["flags"], "\\Seen")
        self.assertEqual(summaries[1]["uid"], "43")


if __name__ == "__main__":
    unittest.main()
