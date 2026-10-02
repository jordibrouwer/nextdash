#!/usr/bin/env python3
"""Record the Unraid API's answers for the nextDash fixtures, anonymised.

Usage: UNRAID_URL=http://192.168.1.10 UNRAID_KEY=... python3 scripts/unraid-record.py
Set UNRAID_INSECURE=1 for a self-signed certificate.
Writes internal/app/testdata/unraid/recorded-<area>.json. The answer is parsed and
walked: hostnames, share, VM and device names, notification titles, subjects,
descriptions and ids, and a UPS model are replaced; sizes, states, counts and
dates are kept. Disk names (disk1, parity, cache, ...) stay.
"""
import json, os, re, ssl, sys, urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "internal/app/testdata/unraid"

QUERIES = {
    "array": "{ array { state capacity { kilobytes { free used total } } parities { name status temp numErrors fsSize fsUsed fsFree isSpinning type } disks { name status temp numErrors fsSize fsUsed fsFree isSpinning type } caches { name status temp numErrors fsSize fsUsed fsFree isSpinning type } parityCheckStatus { status running paused progress speed errors date duration correcting } } }",
    "parity": "{ array { parityCheckStatus { status running paused progress speed errors date duration correcting } } parityHistory { date duration speed status errors } }",
    "shares": "{ shares { name used free size cache } }",
    "vms": "{ vms { domains { name state } } }",
    "ups": "{ upsDevices { name model status battery { chargeLevel estimatedRuntime } power { loadPercentage currentPower } } }",
    "notifications": "{ notifications { overview { unread { info warning alert total } } list(filter: { type: UNREAD, offset: 0, limit: 20 }) { id title subject description importance link timestamp } } }",
    "info": "{ info { os { hostname release uptime } versions { core { unraid api } } } }",
}

KEEP_NAME = re.compile(r"^(disk\d+|parity\d*|cache|flash)$")
KEEP_LINK = re.compile(r"^/[A-Za-z0-9_-]+$")


class Anonymiser:
    """Stable per distinct value: the same name becomes the same itemN everywhere."""

    def __init__(self):
        self.seen = {}

    def label(self, kind, value, fmt):
        key = (kind, value)
        if key not in self.seen:
            self.seen[key] = fmt.format(len([k for k in self.seen if k[0] == kind]))
        return self.seen[key]

    def walk(self, node):
        if isinstance(node, list):
            return [self.walk(x) for x in node]
        if not isinstance(node, dict):
            return node
        is_notification = "importance" in node and "title" in node
        out = {}
        for k, v in node.items():
            if k == "name" and isinstance(v, str):
                out[k] = v if KEEP_NAME.match(v) else self.label("name", v, "item{}")
            elif k == "hostname" and isinstance(v, str):
                out[k] = "tower"
            elif k == "model" and isinstance(v, str):
                out[k] = "UPS model"
            elif is_notification and k == "title" and isinstance(v, str):
                out[k] = self.label("title", v, "Notification {}")
            elif is_notification and k == "subject" and isinstance(v, str):
                out[k] = self.label("subject", v, "Subject {}")
            elif is_notification and k == "description":
                out[k] = ""
            elif is_notification and k == "id" and isinstance(v, str):
                out[k] = self.label("id", v, "n{}")
            elif is_notification and k == "link":
                out[k] = v if isinstance(v, str) and KEEP_LINK.match(v) else None
            else:
                out[k] = self.walk(v)
        return out


def anonymise(answer):
    return Anonymiser().walk(answer)


def main():
    url = os.environ["UNRAID_URL"].rstrip("/") + "/graphql"
    key = os.environ["UNRAID_KEY"]
    ctx = None
    if os.environ.get("UNRAID_INSECURE") == "1":
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    def ask(query):
        req = urllib.request.Request(url, data=json.dumps({"query": query}).encode(),
                                     headers={"content-type": "application/json", "x-api-key": key})
        with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
            return json.load(r)

    OUT.mkdir(parents=True, exist_ok=True)
    for area, q in QUERIES.items():
        try:
            answer = ask(q)
        except Exception as e:  # keep going: one area may be forbidden or missing
            print(f"{area}: {e}", file=sys.stderr)
            continue
        with open(OUT / f"recorded-{area}.json", "w") as f:
            json.dump(anonymise(answer), f, indent=1)
            f.write("\n")
        print(f"{area}: ok")


if __name__ == "__main__":
    main()
