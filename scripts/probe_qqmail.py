from __future__ import annotations

import argparse
import hashlib
import imaplib
import json
import os
import re
import ssl
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_SAMPLE_LIMIT = 10
MAX_SAMPLE_LIMIT = 10


def load_dotenv_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def env_value(name: str, dotenv: dict[str, str], default: str | None = None) -> str | None:
    return os.environ.get(name) or dotenv.get(name) or default


def redact_secret(value: str | None) -> str:
    if not value:
        return "<missing>"
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:8]
    return f"<redacted len={len(value)} sha256_8={digest}>"


def mask_email(value: str) -> str:
    if "@" not in value:
        return "<account-provided>"
    name, domain = value.split("@", 1)
    prefix = name[:2] if len(name) >= 2 else "*"
    return f"{prefix}***@{domain}"


def clamp_sample_limit(value: str | None) -> int:
    if value is None:
        return DEFAULT_SAMPLE_LIMIT
    try:
        parsed = int(value)
    except ValueError:
        return DEFAULT_SAMPLE_LIMIT
    if parsed < 0:
        return 0
    return min(parsed, MAX_SAMPLE_LIMIT)


def write_jsonl_event(path: Path, event: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def decode_bytes(value: bytes) -> str:
    return value.decode("utf-8", errors="replace")


def parse_fetch_summary(chunks: list[Any]) -> list[dict[str, str]]:
    summaries: list[dict[str, str]] = []
    for item in chunks:
        if not isinstance(item, tuple) or not item:
            continue
        header = item[0]
        if not isinstance(header, bytes):
            continue
        text = decode_bytes(header)
        uid_match = re.search(r"UID\s+(\d+)", text)
        flags_match = re.search(r"FLAGS\s+\(([^)]*)\)", text)
        size_match = re.search(r"RFC822\.SIZE\s+(\d+)", text)
        internaldate_match = re.search(r'INTERNALDATE\s+"([^"]+)"', text)
        summaries.append(
            {
                "uid": uid_match.group(1) if uid_match else "",
                "flags": flags_match.group(1) if flags_match else "",
                "size": size_match.group(1) if size_match else "",
                "internalDate": internaldate_match.group(1) if internaldate_match else "",
            }
        )
    return summaries


def fail(message: str) -> None:
    raise SystemExit(message)


def run_probe(project_root: Path) -> int:
    dotenv = load_dotenv_values(project_root / ".env")
    email = env_value("QQMAIL_EMAIL", dotenv)
    auth_code = env_value("QQMAIL_KEY", dotenv)
    host = env_value("QQMAIL_IMAP_HOST", dotenv, "imap.qq.com") or "imap.qq.com"
    port = int(env_value("QQMAIL_IMAP_PORT", dotenv, "993") or "993")
    sample_limit = clamp_sample_limit(env_value("QQMAIL_METADATA_SAMPLE_LIMIT", dotenv))

    if not email:
        fail("QQMAIL_EMAIL is missing")
    if not auth_code:
        fail("QQMAIL_KEY is missing")

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    trace_path = project_root / "logs" / "runs" / f"{run_id}.jsonl"
    artifact_dir = project_root / "artifacts" / "e2e" / run_id
    capability_path = artifact_dir / "capability-snapshot.json"
    summary_path = artifact_dir / "summary.md"

    start = time.monotonic()
    base_event = {
        "runId": run_id,
        "provider": "qqmail",
        "accountAlias": mask_email(email),
        "timestamp": now_iso(),
        "dryRun": True,
        "mutationAllowed": False,
        "sampleLimit": sample_limit,
    }
    write_jsonl_event(
        trace_path,
        {
            **base_event,
            "event": "probe_started",
            "host": host,
            "port": port,
            "authCode": redact_secret(auth_code),
        },
    )

    imap: imaplib.IMAP4_SSL | None = None
    snapshot: dict[str, Any] = {
        **base_event,
        "host": host,
        "port": port,
        "readOnlyOnly": True,
        "mutationsAttempted": [],
        "folders": [],
        "capabilities": [],
        "selectedMailbox": None,
        "exists": None,
        "recent": None,
        "sampledMessages": [],
    }

    try:
        context = ssl.create_default_context()
        imap = imaplib.IMAP4_SSL(host=host, port=port, ssl_context=context, timeout=20)
        typ, capabilities = imap.capability()
        snapshot["capabilities"] = [decode_bytes(item) for item in capabilities] if typ == "OK" else []

        typ, _ = imap.login(email, auth_code)
        if typ != "OK":
            raise RuntimeError(f"IMAP login failed with status {typ}")
        write_jsonl_event(trace_path, {**base_event, "event": "login_ok", "timestamp": now_iso()})

        typ, folders = imap.list()
        if typ == "OK":
            snapshot["folders"] = [decode_bytes(folder) for folder in folders if isinstance(folder, bytes)]
        write_jsonl_event(
            trace_path,
            {
                **base_event,
                "event": "folders_listed",
                "timestamp": now_iso(),
                "folderCount": len(snapshot["folders"]),
            },
        )

        typ, select_data = imap.select("INBOX", readonly=True)
        if typ == "OK":
            snapshot["selectedMailbox"] = "INBOX"
            snapshot["exists"] = decode_bytes(select_data[0]) if select_data else None
        write_jsonl_event(
            trace_path,
            {
                **base_event,
                "event": "inbox_selected_readonly",
                "timestamp": now_iso(),
                "exists": snapshot["exists"],
            },
        )

        if sample_limit > 0 and snapshot["selectedMailbox"]:
            typ, search_data = imap.uid("SEARCH", "ALL")
            write_jsonl_event(
                trace_path,
                {
                    **base_event,
                    "event": "uid_search_finished",
                    "timestamp": now_iso(),
                    "status": typ,
                    "hasData": bool(search_data and search_data[0]),
                },
            )
            if typ == "OK" and search_data and search_data[0]:
                uids = decode_bytes(search_data[0]).split()
                sample_uids = uids[-sample_limit:]
                if sample_uids:
                    uid_set = ",".join(sample_uids)
                    typ, fetch_data = imap.uid("FETCH", uid_set, "(UID FLAGS INTERNALDATE RFC822.SIZE)")
                    if typ == "OK":
                        snapshot["sampledMessages"] = parse_fetch_summary(fetch_data)
        write_jsonl_event(
            trace_path,
            {
                **base_event,
                "event": "metadata_sampled",
                "timestamp": now_iso(),
                "sampledCount": len(snapshot["sampledMessages"]),
            },
        )

        snapshot["ok"] = True
        return_code = 0
    except Exception as exc:  # noqa: BLE001 - probe must record any connection failure.
        snapshot["ok"] = False
        snapshot["error"] = {"type": type(exc).__name__, "message": str(exc)}
        write_jsonl_event(
            trace_path,
            {
                **base_event,
                "event": "probe_failed",
                "timestamp": now_iso(),
                "error": snapshot["error"],
            },
        )
        return_code = 1
    finally:
        if imap is not None:
            try:
                imap.close()
            except Exception:
                pass
            try:
                imap.logout()
            except Exception:
                pass

        snapshot["durationMs"] = round((time.monotonic() - start) * 1000)
        artifact_dir.mkdir(parents=True, exist_ok=True)
        capability_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
        summary_path.write_text(
            "\n".join(
                [
                    f"# QQ Mail Probe {run_id}",
                    "",
                    f"- provider: qqmail",
                    f"- accountAlias: {mask_email(email)}",
                    f"- ok: {snapshot.get('ok')}",
                    f"- folderCount: {len(snapshot['folders'])}",
                    f"- selectedMailbox: {snapshot.get('selectedMailbox')}",
                    f"- inboxExists: {snapshot.get('exists')}",
                    f"- sampledMessages: {len(snapshot['sampledMessages'])}",
                    f"- mutationsAttempted: {len(snapshot['mutationsAttempted'])}",
                    f"- trace: `{trace_path}`",
                    f"- capabilitySnapshot: `{capability_path}`",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        write_jsonl_event(
            trace_path,
            {
                **base_event,
                "event": "probe_finished",
                "timestamp": now_iso(),
                "ok": snapshot.get("ok"),
                "durationMs": snapshot["durationMs"],
                "artifactDir": str(artifact_dir),
            },
        )
    return return_code


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only QQ Mail IMAP capability probe.")
    parser.add_argument("--project-root", default=".", help="Project root containing .env")
    args = parser.parse_args()
    return run_probe(Path(args.project_root).resolve())


if __name__ == "__main__":
    raise SystemExit(main())
