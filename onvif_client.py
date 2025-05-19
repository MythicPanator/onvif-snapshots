import os
import logging
import re
import time
import tempfile
import requests
import xml.etree.ElementTree as ET
import cv2

# ─── Module Logger ───────────────────────────────────────────────────────────
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter(
    fmt='%(asctime)s %(levelname)s [%(funcName)s] %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S'
))
logger.addHandler(handler)

try:
    # Suppress verbose FFmpeg logs from OpenCV
    cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
except Exception:
    pass

# Apply FFMPEG options to force TCP transport and a larger buffer (1 MB)
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|buffer_size;1048576"
)

class OnvifClientError(Exception):
    """Exception for ONVIF client errors."""
    pass

# Map service names to actual ONVIF paths
SERVICE_PATHS = {
    'device': '/onvif/device_service',
    'media':  '/onvif/media_service',
    'ptz':    '/onvif/ptz_service'
}

# XML namespaces for parsing
namespaces = {
    's':   'http://www.w3.org/2003/05/soap-envelope',
    'trt': 'http://www.onvif.org/ver10/media/wsdl',
    'tt':  'http://www.onvif.org/ver10/schema'
}

# SOAP templates
SOAP_ENVELOPE = '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">{body}</s:Envelope>'
GET_PROFILES_BODY = (
    '<s:Body>'
    '<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>'
    '</s:Body>'
)
GET_STREAM_URI_BODY = (
    '<s:Body>'
    '<trt:GetStreamUri xmlns:trt="http://www.onvif.org/ver10/media/wsdl">'
      '<trt:StreamSetup>'
        '<tt:Stream xmlns:tt="http://www.onvif.org/ver10/schema">RTP-Unicast</tt:Stream>'
        '<tt:Transport xmlns:tt="http://www.onvif.org/ver10/schema">'
          '<tt:Protocol>RTSP</tt:Protocol>'
        '</tt:Transport>'
      '</trt:StreamSetup>'
      '<trt:ProfileToken>{token}</trt:ProfileToken>'
    '</trt:GetStreamUri>'
    '</s:Body>'
)
GOTO_PRESET_BODY = (
    '<s:Body>'
    '<GotoPreset xmlns="http://www.onvif.org/ver20/ptz/wsdl">'
      '<ProfileToken>{profile}</ProfileToken>'
      '<PresetToken>{preset}</PresetToken>'
    '</GotoPreset>'
    '</s:Body>'
)

def get_service_url(camera_ip: str, service: str) -> str:
    path = SERVICE_PATHS.get(service)
    if not path:
        raise OnvifClientError(f"Unknown ONVIF service '{service}'")
    return f'http://{camera_ip}{path}'

def send_soap_request(url: str, body: str, username: str, password: str) -> bytes:
    headers = {'Content-Type': 'application/soap+xml'}
    envelope = SOAP_ENVELOPE.format(body=body)
    try:
        resp = requests.post(url, auth=(username, password), headers=headers, data=envelope, timeout=10)
        resp.raise_for_status()
        return resp.content
    except requests.RequestException as e:
        logger.error(f"SOAP request error: {e}")
        raise OnvifClientError(str(e)) from e

def get_profile_token(camera_ip: str, username: str, password: str) -> str:
    xml = send_soap_request(
        get_service_url(camera_ip, 'media'),
        GET_PROFILES_BODY,
        username,
        password
    )
    tree = ET.fromstring(xml)
    profiles = tree.findall('.//trt:Profiles', namespaces)
    if not profiles:
        raise OnvifClientError("No media profiles found")
    token = profiles[0].get('token')
    logger.info(f"Media profile token: {token}")
    return token

def goto_preset(camera_ip: str, username: str, password: str, profile_token: str, preset_token: str) -> None:
    body = GOTO_PRESET_BODY.format(profile=profile_token, preset=preset_token)
    send_soap_request(
        get_service_url(camera_ip, 'ptz'),
        body,
        username,
        password
    )

def get_stream_uri(camera_ip: str, username: str, password: str, profile_token: str) -> str:
    body = GET_STREAM_URI_BODY.format(token=profile_token)
    xml = send_soap_request(
        get_service_url(camera_ip, 'media'),
        body,
        username,
        password
    )
    tree = ET.fromstring(xml)
    uri_elem = tree.find('.//tt:Uri', namespaces)
    if uri_elem is None or not uri_elem.text:
        raise OnvifClientError("RTSP URI not found")
    uri = re.sub(
        r'rtsp://\d+\.\d+\.\d+\.\d+',
        f'rtsp://{camera_ip}',
        uri_elem.text
    )
    logger.info(f"Resolved RTSP URI: {uri}")
    return uri

def _is_valid_frame(frame) -> bool:
    if frame is None:
        return False
    h, w = frame.shape[:2]
    if h < 100 or w < 100:
        return False
    if cv2.meanStdDev(frame)[1].mean() < 5:
        return False
    return True

def _save_to_tmp(frame) -> str:
    # Write JPEG into Azure's writable /tmp directory
    tmp = tempfile.NamedTemporaryFile(suffix='.jpg', dir='/tmp', delete=False)
    path = tmp.name
    tmp.close()
    if not cv2.imwrite(path, frame):
        raise OnvifClientError("Failed to write snapshot image to /tmp")
    return path

def capture_snapshot(rtsp_url: str, output_filename: str, timeout: int = 20) -> str:
    """
    Capture a high-quality snapshot from an RTSP stream using OpenCV over TCP.
    Saves JPEG under /tmp with the given filename and returns its full path.
    """
    logger.info(f"Connecting to RTSP stream: {rtsp_url}")
    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    if not cap.isOpened():
        cap.release()
        raise OnvifClientError("Unable to open RTSP stream via OpenCV")

    start = time.time()
    warmup = 90
    # Drop initial frames to reach a clean keyframe
    while warmup and time.time() - start < timeout:
        if not cap.grab():
            break
        warmup -= 1
        time.sleep(0.1)

    frames = []
    # Collect a handful of valid frames
    while len(frames) < 5 and time.time() - start < timeout:
        ret, frame = cap.read()
        if not ret:
            continue
        if _is_valid_frame(frame):
            frames.append(frame)
        time.sleep(0.1)
    cap.release()

    if not frames:
        raise OnvifClientError("No valid frames captured via OpenCV")

    # Pick the middle frame for stability
    valid_frame = frames[len(frames) // 2]

    # Ensure output directory exists and write to /tmp
    tmp_path = os.path.join('/tmp', output_filename)
    if not cv2.imwrite(tmp_path, valid_frame):
        raise OnvifClientError(f"Failed to write snapshot image to {tmp_path}")

    logger.info(f"Snapshot saved to: {tmp_path} ({valid_frame.shape[1]}x{valid_frame.shape[0]})")
    return tmp_path

# retain snapshot_with_retry unchanged
def snapshot_with_retry(
    camera_ip: str,
    username: str,
    password: str,
    preset: str = None,
    max_retries: int = 3,
    retry_delay: int = 2,
    preset_wait: int = 14
) -> str:
    token = get_profile_token(camera_ip, username, password)
    if preset:
        goto_preset(camera_ip, username, password, token, preset)
        time.sleep(preset_wait)

    rtsp_url = get_stream_uri(camera_ip, username, password, token)
    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            logger.info(f"Snapshot attempt {attempt}/{max_retries}")
            temp_file = capture_snapshot(rtsp_url, f"snapshot_{preset}.jpg")
            return temp_file
        except OnvifClientError as e:
            last_err = e
            logger.warning(f"Attempt {attempt} failed: {e}")
            time.sleep(retry_delay)

    raise OnvifClientError(f"Snapshot failed after {max_retries} tries: {last_err}")
