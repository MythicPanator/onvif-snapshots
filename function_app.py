import os
import sys
import time
import logging
import datetime as dt
import urllib.parse
import json

import azure.functions as func
from azure.storage.blob import BlobClient, ContentSettings
from dotenv import load_dotenv

from onvif_client import snapshot_with_retry, OnvifClientError

# ─── Configure module logger ────────────────────────────────────────────────
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(logging.Formatter(
    fmt='%(asctime)s %(levelname)s [%(funcName)s] %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S'
))
logger.addHandler(handler)

# ─── Load configuration ────────────────────────────────────────────────────
load_dotenv()  # remove in production
CAMERA_IP          = os.getenv('CAMERA_IP')
CAMERA_USER        = os.getenv('CAMERA_USER')
CAMERA_PASSWORD    = os.getenv('CAMERA_PASSWORD')
PRESETS_RAW        = os.getenv('CAMERA_PRESETS', '')
PRESET_WAIT        = int(os.getenv('PRESET_WAIT', '14'))
MAX_RETRIES        = int(os.getenv('MAX_RETRIES', '3'))
RETRY_DELAY        = int(os.getenv('RETRY_DELAY', '2'))
SNAPSHOT_CONTAINER = os.getenv('SNAPSHOT_CONTAINER', 'snapshots')
AZ_CONNECTION      = os.getenv('AzureWebJobsStorage')

# Validate required config
required = [CAMERA_IP, CAMERA_USER, CAMERA_PASSWORD, AZ_CONNECTION]
if not all(required):
    missing = [k for k,v in {
        'CAMERA_IP': CAMERA_IP,
        'CAMERA_USER': CAMERA_USER,
        'CAMERA_PASSWORD': CAMERA_PASSWORD,
        'AzureWebJobsStorage': AZ_CONNECTION
    }.items() if not v]
    logger.critical(f"Missing environment variables: {', '.join(missing)}")
    sys.exit(1)

PRESETS = [p.strip() for p in PRESETS_RAW.split(',') if p.strip()]

# ─── Snapshot Logic ─────────────────────────────────────────────────────────
def handle_snapshot_sequence():
    """Core logic to capture and upload snapshots for all presets."""
    logger.info("Snapshot sequence started")
    now = dt.datetime.utcnow()
    date_prefix = now.strftime('%Y/%m/%d')
    date_str = now.strftime('%Y-%m-%d')
    hour_label = ('early' if 5 <= now.hour < 10 else
                  'midday' if 10 <= now.hour < 15 else
                  'late'   if 15 <= now.hour < 21 else
                  'night')

    blob_probe = BlobClient.from_connection_string(AZ_CONNECTION, SNAPSHOT_CONTAINER, '__probe__')
    account_name = blob_probe.account_name

    # Prepare daily index
    index_blob_path = f"{date_prefix}/index.json"
    index_blob = BlobClient.from_connection_string(
        AZ_CONNECTION,
        SNAPSHOT_CONTAINER,
        index_blob_path
    )
    try:
        existing = index_blob.download_blob().readall()
        index_data = json.loads(existing)
    except Exception:
        index_data = {"date": date_str, "snapshots": []}

    targets = PRESETS or [None]
    failures = []

    for preset in targets:
        label = preset or 'current'
        logger.info(f"[{label}] Running snapshot_with_retry")
        try:
            # 1. Capture returns the full temp path, e.g. '/tmp/snapshot_3.jpg'
            local_path = snapshot_with_retry(
                camera_ip=CAMERA_IP,
                username=CAMERA_USER,
                password=CAMERA_PASSWORD,
                preset=preset,
                max_retries=MAX_RETRIES,
                retry_delay=RETRY_DELAY,
                preset_wait=PRESET_WAIT
            )

            # 2. Derive just the filename for blob naming
            filename = os.path.basename(local_path)
            logger.info(f"[{label}] Captured: {filename}")

            # 3. Upload from the temp path…
            blob_path = f"{date_prefix}/{hour_label}_{date_str}_{filename}"
            blob = BlobClient.from_connection_string(
                AZ_CONNECTION,
                SNAPSHOT_CONTAINER,
                blob_path
            )
            with open(local_path, 'rb') as f:
                blob.upload_blob(
                    f,
                    overwrite=True,
                    content_settings=ContentSettings(content_type='image/jpeg')
                )
            logger.info(f"[{label}] Uploaded to {blob_path}")

            # 4. Update daily index—update existing entry or append new
            prefix_pattern = f"{date_prefix}/{hour_label}_"
            updated = False
            for entry in index_data["snapshots"]:
                if entry.get("preset") == label and entry.get("path", "").startswith(prefix_pattern):
                    entry["time"] = now.strftime('%H:%M')
                    entry["path"] = blob_path
                    updated = True
                    break
            if not updated:
                index_data["snapshots"].append({
                    "time": now.strftime('%H:%M'),
                    "preset": label,
                    "path": blob_path
                })

            # 5. Update the “latest” alias using the same filename
            encoded = urllib.parse.quote(blob_path, safe='')
            source_url = f"https://{account_name}.blob.core.windows.net/{SNAPSHOT_CONTAINER}/{encoded}"
            latest_blob = BlobClient.from_connection_string(
                AZ_CONNECTION,
                SNAPSHOT_CONTAINER,
                f"latest/{filename}"
            )
            latest_blob.start_copy_from_url(source_url)
            logger.info(f"[{label}] Latest alias updated")

        except OnvifClientError as e:
            logger.error(f"[{label}] ONVIF error: {e}")
            failures.append(label)
        except Exception as e:
            logger.error(f"[{label}] Unexpected error: {e}")
            failures.append(label)

    # Upload updated index.json if any entries exist
    if index_data.get("snapshots"):
        index_blob.upload_blob(
            json.dumps(index_data, indent=2),
            overwrite=True,
            content_settings=ContentSettings(content_type='application/json')
        )
        logger.info(f"Daily index updated at {index_blob_path}")

    if failures:
        raise RuntimeError(f"Snapshot sequence failed for presets: {', '.join(failures)}")
    logger.info("Snapshot sequence completed successfully")

# ─── Function App ──────────────────────────────────────────────────────────
app = func.FunctionApp()

@app.schedule(
    schedule="0 */30 * * * *",
    arg_name="snapshotTimer",
    run_on_startup=False,
    use_monitor=False
)
def scheduled_snapshot(snapshotTimer: func.TimerRequest) -> None:
    """Scheduled snapshot run every 30 minutes."""
    try:
        handle_snapshot_sequence()
    except Exception as e:
        logger.critical(f"Scheduled run failed: {e}")
        sys.exit(1)

@app.function_name(name="http_snapshot")
@app.route(route="snapshot", methods=["GET"])
def http_snapshot(req: func.HttpRequest) -> func.HttpResponse:
    """HTTP endpoint to trigger snapshot sequence on demand."""
    try:
        handle_snapshot_sequence()
        return func.HttpResponse("Snapshot sequence succeeded", status_code=200)
    except OnvifClientError as e:
        return func.HttpResponse(f"ONVIF error: {e}", status_code=502)
    except Exception as e:
        logger.critical(f"HTTP run failed: {e}")
        return func.HttpResponse(f"Error: {e}", status_code=500)

# ─── Local Debug Entry Point ────────────────────────────────────────────────
if __name__ == '__main__':
    # Allows running this file directly (e.g., VSCode 'Run')
    try:
        handle_snapshot_sequence()
    except Exception:
        logger.exception("Local snapshot test failed")
        sys.exit(1)
    sys.exit(0)
