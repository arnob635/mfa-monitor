"""
Estonian MFA booking monitor.

Checks https://broneering.mfa.ee every N minutes and emails you when the
"Long-stay visa (D-visa) application" service appears for the chosen embassy.

How it works: selecting an embassy on the site posts the form back to the
server, which returns the page with the service dropdown filled in. This script
does the same post (no CAPTCHA involved, that only guards the final submit)
and looks for the D-visa option in the returned HTML.
"""

import os
import random
import smtplib
import time
import traceback
from datetime import datetime, timezone
from email.message import EmailMessage

import requests
from bs4 import BeautifulSoup

# ---------- Config (set these as Railway environment variables) ----------
GMAIL_USER = os.environ["GMAIL_USER"]                    # you@gmail.com
GMAIL_APP_PASSWORD = os.environ["GMAIL_APP_PASSWORD"]    # 16-char app password
ALERT_TO = os.environ.get("ALERT_TO", GMAIL_USER)        # comma-separated OK

EMBASSY_ID = os.environ.get("EMBASSY_ID", "40")          # 40 = New Delhi
TARGET_SERVICE = os.environ.get("TARGET_SERVICE", "pikaajaline_viisa")  # D-visa
CHECK_INTERVAL_MIN = float(os.environ.get("CHECK_INTERVAL_MIN", "10"))
HEARTBEAT_HOURS = float(os.environ.get("HEARTBEAT_HOURS", "24"))  # 0 = off
ERROR_ALERT_AFTER = int(os.environ.get("ERROR_ALERT_AFTER", "6"))  # consecutive failures

URL = "https://broneering.mfa.ee/en/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/129.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S} UTC] {msg}", flush=True)


def fetch_services() -> dict[str, str]:
    """Return {option_value: option_label} for the embassy's service dropdown."""
    with requests.Session() as s:
        s.headers.update(HEADERS)

        # 1. Load the page to get the session cookie and CSRF token.
        r = s.get(URL, timeout=30)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        token_input = soup.select_one('input[name="broneering[_token]"]')
        if not token_input:
            raise RuntimeError("CSRF token not found; the page layout may have changed.")

        # 2. Post the embassy choice, same as picking it in the dropdown.
        data = {
            "broneering[esindus]": EMBASSY_ID,
            "broneering[toiming]": "",
            "broneering[_token]": token_input.get("value", ""),
        }
        r = s.post(URL, data=data, headers={"Referer": URL}, timeout=30)
        # The site replies 422 here (form not complete yet, no service chosen)
        # but still returns the page with the filled-in dropdown. Accept it.
        if r.status_code not in (200, 422):
            r.raise_for_status()
            raise RuntimeError(f"Unexpected HTTP {r.status_code} from booking site.")

    return parse_services(r.text)


def parse_services(html: str) -> dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    select = soup.select_one('select[name="broneering[toiming]"]')
    if select is None:
        raise RuntimeError("Service dropdown not found in response; the site may have changed.")
    return {
        opt.get("value", ""): opt.get_text(strip=True)
        for opt in select.find_all("option")
        if opt.get("value")
    }


def send_email(subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = GMAIL_USER
    msg["To"] = ALERT_TO
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
        smtp.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        smtp.send_message(msg)
    log(f"Email sent: {subject}")


def main() -> None:
    log(f"Monitor started. Embassy={EMBASSY_ID}, target={TARGET_SERVICE}, "
        f"every {CHECK_INTERVAL_MIN} min.")
    send_email(
        "MFA monitor started",
        f"Watching embassy {EMBASSY_ID} for service '{TARGET_SERVICE}' "
        f"every {CHECK_INTERVAL_MIN:g} minutes.\n{URL}",
    )

    was_available = False
    failures = 0
    error_alert_sent = False
    last_heartbeat = time.time()

    while True:
        try:
            services = fetch_services()
            failures = 0
            error_alert_sent = False
            available = TARGET_SERVICE in services
            log(f"OK. {len(services)} service(s) listed. D-visa available: {available}")

            if available and not was_available:
                send_email(
                    "D-VISA SLOT OPEN: book now",
                    "The Long-stay visa (D-visa) option just appeared for the "
                    "Estonian Embassy in New Delhi.\n\n"
                    f"Book here: {URL}\n\n"
                    f"Services currently listed:\n- " + "\n- ".join(services.values()),
                )
            elif was_available and not available:
                log("D-visa option disappeared again.")
            was_available = available

        except Exception as e:  # keep running through network blips
            failures += 1
            log(f"Check failed ({failures} in a row): {e}")
            traceback.print_exc()
            if failures >= ERROR_ALERT_AFTER and not error_alert_sent:
                try:
                    send_email(
                        "MFA monitor: checks are failing",
                        f"{failures} checks in a row have failed. Last error:\n{e}\n\n"
                        "The site may be down, blocking the server, or its layout changed.",
                    )
                    error_alert_sent = True
                except Exception as mail_err:
                    log(f"Could not send error email: {mail_err}")

        if HEARTBEAT_HOURS and time.time() - last_heartbeat >= HEARTBEAT_HOURS * 3600:
            try:
                send_email("MFA monitor: still running",
                           f"Still watching. D-visa currently available: {was_available}.")
            except Exception as mail_err:
                log(f"Could not send heartbeat: {mail_err}")
            last_heartbeat = time.time()

        # Small random jitter so requests aren't on an exact clock.
        sleep_s = CHECK_INTERVAL_MIN * 60 + random.uniform(-30, 30)
        time.sleep(max(60, sleep_s))


if __name__ == "__main__":
    main()
