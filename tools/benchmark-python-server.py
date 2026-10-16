"""Reproducible real-HTTP Java/Python parity and latency benchmark using isolated data.

Build Java first: mvn test-compile dependency:build-classpath -Dmdep.outputFile=target/python-java-classpath.txt
Run: python tools/benchmark-python-server.py --java <java executable> --files 1000 --records 100 --repeats 20
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import datetime as dt
import json
import os
from pathlib import Path
import platform
import socket
import statistics
import subprocess
import sys
import tempfile
import time

import httpx
import psutil
import yaml

ROOT = Path(__file__).resolve().parents[1]
ROUTE = "/openbexi_timeline/sessions"


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


@contextmanager
def running(command, log, ready):
    with log.open("w", encoding="utf-8") as output:
        process = subprocess.Popen(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 45
            while not ready():
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError("Server did not start: " + log.read_text(encoding="utf-8"))
                time.sleep(.05)
            yield process
        finally:
            owned = process_tree(process)
            for child in reversed(owned):
                try:
                    child.terminate()
                except psutil.NoSuchProcess:
                    pass
            _, alive = psutil.wait_procs(owned, timeout=10)
            for child in alive:
                child.kill()
            process.wait(timeout=10)


def scan(client, base, params):
    started, first, requests, size, records = time.perf_counter(), None, 0, 0, []
    params = {"progressive": "1", "matchProtocol": "1", "scene": "0", "filter": "", "search": "", "traceLevel": "ERROR", **params}
    for _ in range(1000):
        response = client.get(base + ROUTE, params=params)
        response.raise_for_status()
        requests += 1
        size += len(response.content)
        body = response.json()
        metadata = body["timelineMatch"]
        if metadata.get("error"):
            raise AssertionError(metadata["error"])
        records.extend(body["events"])
        if body["events"] and first is None:
            first = (time.perf_counter() - started) * 1000
        if not metadata.get("nextCursor"):
            return records, {"firstRecordsMs": first, "completeMs": (time.perf_counter()-started)*1000, "requests": requests,
                             "decodedBytes": size, "complete": metadata["complete"], "records": len(records),
                             "warningCount": len(metadata.get("warnings", [])),
                             "warningCodes": sorted({item.get("code", "unspecified") for item in metadata.get("warningDetails", [])})}
        params["cursor"] = metadata["nextCursor"]
        if metadata.get("retryAfterMs"):
            time.sleep(min(2, metadata["retryAfterMs"]/1000))
    raise AssertionError("Scan exceeded 1,000 requests")


def normalize(records):
    # Ignore map/record ordering; preserve all record fields, including stable
    # source identities, nested annotations, namespaces, dates and styling.
    def clean(value):
        if isinstance(value, dict):
            return {k: clean(v) for k, v in sorted(value.items())}
        if isinstance(value, list):
            return sorted((clean(v) for v in value), key=lambda v: json.dumps(v, sort_keys=True))
        return value
    return clean(records)


def process_tree(process):
    parent = psutil.Process(process.pid)
    return [parent, *parent.children(recursive=True)]


def cpu_seconds(process):
    return sum(p.cpu_times().user + p.cpu_times().system for p in process_tree(process))


def measure(client, base, params, repeats, process):
    before = cpu_seconds(process)
    runs = [scan(client, base, params)[1] for _ in range(repeats)]
    warm = {"p50Ms": statistics.median(r["completeMs"] for r in runs),
            "p95Ms": sorted(r["completeMs"] for r in runs)[min(len(runs)-1, int(.95*len(runs)))],
            "requestsPerLoad": statistics.mean(r["requests"] for r in runs), "decodedBytesPerLoad": statistics.mean(r["decodedBytes"] for r in runs),
            "firstRecordsP50Ms": statistics.median(r["firstRecordsMs"] for r in runs),
            "completeLoads": sum(r["complete"] for r in runs),
            "cpuSeconds": cpu_seconds(process)-before, "rssMiB": sum(p.memory_info().rss for p in process_tree(process))/1024**2}
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=4) as pool:
        concurrent = list(pool.map(lambda _: scan(client, base, params)[1], range(8)))
    warm["concurrent8LoadsMs"] = (time.perf_counter()-started)*1000
    warm["concurrentP95Ms"] = max(item["completeMs"] for item in concurrent)
    return warm


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--java", default="java")
    parser.add_argument("--files", type=int, default=1000)
    parser.add_argument("--records", type=int, default=100)
    parser.add_argument("--repeats", type=int, default=20)
    parser.add_argument("--output", default="target/python-java-benchmark.json")
    parser.add_argument("--publication", action="store_true", help="Serve the same fixtures through one committed collector snapshot")
    args = parser.parse_args()
    classpath = os.pathsep.join([str(ROOT/"target/test-classes"), str(ROOT/"target/classes"), (ROOT/"target/python-java-classpath.txt").read_text().strip()])
    with tempfile.TemporaryDirectory(prefix="timeline-benchmark-") as directory, httpx.Client(timeout=45, trust_env=False) as client:
        root = Path(directory)
        source = root/"data"
        first = dt.datetime(2024, 1, 1, tzinfo=dt.timezone.utc)
        for index in range(args.files):
            date = first + dt.timedelta(days=index)
            file = source/date.strftime("%Y/%m/%d")/"events.json"
            file.parent.mkdir(parents=True, exist_ok=True)
            records = [{"id": f"{index}-{ordinal}", "start": (date+dt.timedelta(minutes=ordinal)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "data": {"title": f"Record {ordinal}", "status": "STARTED" if ordinal%2 else "SCHEDULE", "priority": ordinal%5}} for ordinal in range(args.records)]
            if index == args.files-1 and args.records >= 10:
                records[0]["end"] = (date+dt.timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
                records[0]["activities"] = [{"id": "child", "start": records[1]["start"], "data": {"title": "Nested café warning"}},
                                            {"id": "outside", "start": (date+dt.timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ"), "data": {"title": "Outside"}}]
                records[1]["end"] = ""
                records[2]["end"] = None
                records[3]["start"] = int((date+dt.timedelta(minutes=3)).timestamp()*1000)
                records[4]["data"]["namespace"] = "nested-namespace"
                records[5]["render"] = {"color": "#ab1234"}
                records[6]["zone"] = True
                records[8]["namespace"] = " "
            file.write_text(json.dumps({"events": records}), encoding="utf-8")
        if args.publication:
            reports=sorted(source.rglob('events.json'))
            publication=source/'.timeline-collector/publication.json'; publication.parent.mkdir()
            publication.write_text(json.dumps(dict(version=1, generation='benchmark', dateTimeFormat='iso8601',
                baseline_reports=[file.relative_to(source).as_posix() for file in reports],
                events=[record for file in reports for record in json.loads(file.read_text())['events']])), encoding='utf-8')
        last = first + dt.timedelta(days=args.files-1)
        params = {"startDate": last.strftime("%Y-%m-%dT00:00:00Z"), "endDate": (last+dt.timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")}
        config = root/"sources.yml"
        config.write_text(yaml.safe_dump({"data_sources": [{"namespace": "benchmark", "type": "json_file", "enable": True,
                                                           "data_model": (source/"yyyy/mm/dd").as_posix(), "filter": {"include": "", "exclude": ""}}],
                                          "timeline_server": {"poll_seconds": 60}}), encoding="utf-8")
        port_file = root/"java-port"
        def java_ready():
            if not port_file.exists(): return False
            try:
                with socket.create_connection(('127.0.0.1', int(port_file.read_text())), timeout=.2): return True
            except (OSError, ValueError): return False
        cases = [params, {**params, "filter": "expr: status = STARTED AND priority >= 2"},
                 {**params, "filter": 'expr: namespace = "benchmark" AND (status = "STARTED")', "sortBy": "status"},
                 {**params, "filter": "status:STARTED|priority:3"}, {**params, "search": "Record 1", "searchMode": "text"},
                 {**params, "search": "^Record [23]$", "searchMode": "pattern"}, {**params, "search": "Record;SCHEDULE", "searchMode": "legacy"},
                 {**params, "filter": "expr: EXISTS(end)"}, {**params, "search": "CAFÉ", "searchMode": "text"},
                 {**params, "filter": "|Outside"}, {**params, "history": "backward", "search": "Nested café", "searchMode": "text"}]
        report = {"platform": platform.platform(), "python": platform.python_version(), "files": args.files, "recordsPerFile": args.records,
                  "storage": "collector snapshot" if args.publication else "legacy dated files",
                  "warmRepeats": args.repeats, "concurrentClients": 4, "note": "Cold means a new server/cache/index; OS file cache is not flushed. Decoded bytes exclude HTTP compression."}
        with running([args.java, "-Dopenbexi.timeline.logFormat=readable", "-cp", classpath,
                      "com.openbexi.timeline.data_browser.PythonBaselineServer", str(root), str(config), str(port_file)], ROOT/"target/benchmark-java.log", java_ready) as process:
            java_base = "http://127.0.0.1:" + port_file.read_text()
            _, cold = scan(client, java_base, params)
            report["java"] = {"cold": cold, "warm": measure(client, java_base, params, args.repeats, process)}
            expected = [normalize(scan(client, java_base, case)[0]) for case in cases]
        port = free_port()
        python_base = f"http://127.0.0.1:{port}"
        def ready():
            try:
                return client.get(python_base+"/health").status_code == 200
            except httpx.HTTPError:
                return False
        command = [sys.executable, "-m", "openbexi_timeline_server", "-data_conf", str(config), "--root", str(root), "--state", str(root/"index"), "--port", str(port)]
        with running(command, ROOT/"target/benchmark-python.log", ready) as process:
            _, cold = scan(client, python_base, params)
            report["pythonBackend"] = {"cold": cold, "warm": measure(client, python_base, params, args.repeats, process)}
            for case, wanted in zip(cases, expected):
                actual = normalize(scan(client, python_base, case)[0])
                if actual != wanted:
                    (ROOT/"target/python-parity-difference.json").write_text(json.dumps({"case": case, "java": wanted, "python": actual}, indent=2), encoding="utf-8")
                    raise AssertionError("Java/Python response mismatch; see target/python-parity-difference.json")
        with running(command, ROOT/"target/benchmark-python-restart.log", ready) as process:
            report["pythonBackend"]["persistentRestart"] = scan(client, python_base, params)[1]
        report["parityCasesPassed"] = len(cases)
        destination = ROOT/args.output
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
