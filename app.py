"""
Website Uptime Checker
- Pings every URL in the database once a minute (background thread)
- Stores each result in SQLite (history)
- Flask serves the dashboard (templates/ and static/ hold the frontend)
"""

import sqlite3
import threading
import time
from datetime import datetime
from urllib.parse import urlparse

import requests
from flask import Flask, jsonify, redirect, render_template, request, url_for

DB_FILE = "uptime.db"
CHECK_INTERVAL = 60   # seconds between checks
TIMEOUT = 10          # seconds before a site counts as down
RECENT = 60           # bars per site on the dashboard (keep in sync with SLOTS in static/app.js)

app = Flask(__name__)

last_run = 0.0        # when the most recent round of checks finished (epoch seconds)


@app.context_processor
def inject_settings():
    return {"interval": CHECK_INTERVAL}


# ---------- Database ----------

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute(
        """CREATE TABLE IF NOT EXISTS sites (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               url TEXT UNIQUE NOT NULL
           )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS checks (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               site_id INTEGER NOT NULL,
               checked_at TEXT NOT NULL,
               is_up INTEGER NOT NULL,
               status_code INTEGER,
               response_ms INTEGER,
               FOREIGN KEY (site_id) REFERENCES sites (id)
           )"""
    )
    # Add a few sites the first time so the dashboard isn't empty
    if conn.execute("SELECT COUNT(*) FROM sites").fetchone()[0] == 0:
        for url in ("https://www.google.com", "https://github.com"):
            conn.execute("INSERT INTO sites (url) VALUES (?)", (url,))
    conn.commit()
    conn.close()


# ---------- Checker ----------

def check_url(url):
    """Return (is_up, status_code, response_ms) for one URL."""
    start = time.time()
    try:
        r = requests.get(url, timeout=TIMEOUT, headers={"User-Agent": "UptimeChecker/1.0"})
        ms = int((time.time() - start) * 1000)
        return (1 if r.status_code < 400 else 0), r.status_code, ms
    except requests.RequestException:
        return 0, None, None


def run_checks():
    """Check every site once and save the results."""
    global last_run
    conn = get_db()
    sites = conn.execute("SELECT id, url FROM sites").fetchall()
    for site in sites:
        is_up, code, ms = check_url(site["url"])
        conn.execute(
            "INSERT INTO checks (site_id, checked_at, is_up, status_code, response_ms) "
            "VALUES (?, ?, ?, ?, ?)",
            (site["id"], datetime.now().strftime("%Y-%m-%d %H:%M:%S"), is_up, code, ms),
        )
        print(f"[{'UP' if is_up else 'DOWN'}] {site['url']} code={code} time={ms}ms")
    conn.commit()
    conn.close()
    last_run = time.time()


def checker_loop():
    while True:
        try:
            run_checks()
        except Exception as e:  # keep the thread alive no matter what
            print("Checker error:", e)
        time.sleep(CHECK_INTERVAL)


# ---------- Data for the pages ----------

def short_time(timestamp):
    """'2026-11-01 23:41:07' -> '23:41'"""
    return timestamp[11:16] if timestamp else None


def summarize_site(conn, site):
    """Everything the dashboard row for one site needs."""
    recent = conn.execute(
        "SELECT checked_at, is_up, status_code, response_ms FROM checks "
        "WHERE site_id = ? ORDER BY id DESC LIMIT ?",
        (site["id"], RECENT),
    ).fetchall()
    recent.reverse()  # oldest first, so the newest bar is on the right
    uptime = conn.execute(
        "SELECT AVG(is_up) * 100 FROM checks WHERE site_id = ?", (site["id"],)
    ).fetchone()[0]

    last = recent[-1] if recent else None
    if last is None:
        state = "pending"
    else:
        state = "up" if last["is_up"] else "down"

    return {
        "id": site["id"],
        "url": site["url"],
        "host": urlparse(site["url"]).netloc or site["url"],
        "state": state,
        "status_code": last["status_code"] if last else None,
        "response_ms": last["response_ms"] if last else None,
        "checked_at": short_time(last["checked_at"]) if last else None,
        "uptime": uptime,
        "ticks": [
            {"u": c["is_up"], "ms": c["response_ms"] or 0, "t": short_time(c["checked_at"])}
            for c in recent
        ],
    }


def status_payload(conn):
    sites = conn.execute("SELECT id, url FROM sites ORDER BY id").fetchall()
    summaries = [summarize_site(conn, s) for s in sites]
    times = [s["checked_at"] for s in summaries if s["checked_at"]]
    if last_run:
        next_in = max(0, int(last_run + CHECK_INTERVAL - time.time()))
    else:
        next_in = 0
    return {
        "sites": summaries,
        "last_check": max(times) if times else None,
        "next_in": next_in,
    }


# ---------- Pages ----------

@app.route("/")
def index():
    conn = get_db()
    payload = status_payload(conn)
    conn.close()
    return render_template("index.html", initial=payload)


@app.route("/status.json")
def status_json():
    """Used by static/app.js to refresh the dashboard without reloading."""
    conn = get_db()
    payload = status_payload(conn)
    conn.close()
    return jsonify(payload)


@app.route("/add", methods=["POST"])
def add_site():
    url = request.form["url"].strip()
    if url:
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        conn = get_db()
        conn.execute("INSERT OR IGNORE INTO sites (url) VALUES (?)", (url,))
        conn.commit()
        conn.close()
    return redirect(url_for("index"))


@app.route("/delete/<int:site_id>", methods=["POST"])
def delete_site(site_id):
    conn = get_db()
    conn.execute("DELETE FROM checks WHERE site_id = ?", (site_id,))
    conn.execute("DELETE FROM sites WHERE id = ?", (site_id,))
    conn.commit()
    conn.close()
    return redirect(url_for("index"))


@app.route("/history/<int:site_id>")
def history(site_id):
    conn = get_db()
    row = conn.execute("SELECT id, url FROM sites WHERE id = ?", (site_id,)).fetchone()
    if row is None:
        conn.close()
        return redirect(url_for("index"))

    site = summarize_site(conn, row)
    stats = conn.execute(
        "SELECT COUNT(*) AS total, AVG(is_up) * 100 AS uptime, "
        "AVG(response_ms) AS avg_ms, MAX(response_ms) AS max_ms "
        "FROM checks WHERE site_id = ?",
        (site_id,),
    ).fetchone()
    last_down = conn.execute(
        "SELECT checked_at FROM checks WHERE site_id = ? AND is_up = 0 ORDER BY id DESC LIMIT 1",
        (site_id,),
    ).fetchone()
    checks = conn.execute(
        "SELECT * FROM checks WHERE site_id = ? ORDER BY id DESC LIMIT 100", (site_id,)
    ).fetchall()
    conn.close()

    points = [
        {"t": short_time(c["checked_at"]), "ms": c["response_ms"] or 0, "up": c["is_up"]}
        for c in reversed(checks)
    ]
    stats = dict(stats)
    stats["last_down"] = last_down["checked_at"] if last_down else None

    return render_template("history.html", site=site, stats=stats, checks=checks, points=points)


if __name__ == "__main__":
    init_db()
    threading.Thread(target=checker_loop, daemon=True).start()
    # debug=False so the checker thread doesn't start twice
    app.run(host="127.0.0.1", port=5000, debug=False)
