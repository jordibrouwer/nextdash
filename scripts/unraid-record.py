#!/usr/bin/env python3
"""Record the Unraid API's answers for the nextDash fixtures, anonymised.

Usage: UNRAID_URL=http://192.168.1.10 UNRAID_KEY=... python3 scripts/unraid-record.py
Writes internal/app/testdata/unraid/recorded-<area>.json. Names of shares, VMs,
disks' serials and the hostname are replaced; sizes, states and counts are kept.
"""
import json, os, re, sys, urllib.request

URL = os.environ["UNRAID_URL"].rstrip("/") + "/graphql"
KEY = os.environ["UNRAID_KEY"]
OUT = "internal/app/testdata/unraid"

def ask(query):
    req = urllib.request.Request(URL, data=json.dumps({"query": query}).encode(),
                                 headers={"content-type": "application/json", "x-api-key": KEY})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)

QUERIES = {
    "array": "{ array { state capacity { kilobytes { free used total } } parities { name status temp numErrors fsSize fsUsed fsFree isSpinning type } disks { name status temp numErrors fsSize fsUsed fsFree isSpinning type } caches { name status temp numErrors fsSize fsUsed fsFree isSpinning type } parityCheckStatus { status running paused progress speed errors date duration correcting } } }",
    "parity": "{ array { parityCheckStatus { status running paused progress speed errors date duration correcting } } parityHistory { date duration speed status errors } }",
    "shares": "{ shares { name used free size cache } }",
    "vms": "{ vms { domains { name state } } }",
    "ups": "{ upsDevices { name model status battery { chargeLevel estimatedRuntime } power { loadPercentage currentPower } } }",
    "notifications": "{ notifications { overview { unread { info warning alert total } } list(filter: { type: UNREAD, offset: 0, limit: 20 }) { id title subject description importance link timestamp } } }",
    "info": "{ info { os { hostname release uptime } versions { core { unraid api } } } }",
}

def anonymise(text):
    text = re.sub(r'"hostname":\s*"[^"]*"', '"hostname": "tower"', text)
    for i, name in enumerate(sorted(set(re.findall(r'"name":\s*"([^"]+)"', text)))):
        if not re.match(r"^(disk\d+|parity\d*|cache|flash)$", name):
            text = text.replace(f'"{name}"', f'"item{i}"')
    return text

for area, q in QUERIES.items():
    try:
        answer = ask(q)
    except Exception as e:  # keep going: one area may be forbidden or missing
        print(f"{area}: {e}", file=sys.stderr)
        continue
    with open(f"{OUT}/recorded-{area}.json", "w") as f:
        f.write(anonymise(json.dumps(answer, indent=1)))
    print(f"{area}: ok")
