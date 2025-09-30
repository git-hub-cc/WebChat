import os
import math
import requests
from concurrent.futures import ThreadPoolExecutor
from tqdm import tqdm
import random
import time

# --- 配置区 ---

BOUNDING_BOX = {
    "lat_min": 22.5, "lat_max": 23.8,
    "lon_min": 112.8, "lon_max": 114.1
}
MIN_ZOOM = 10
MAX_ZOOM = 16

TILE_SERVER_URLS = [
    "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
    "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
    "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
]

OUTPUT_DIR = "./tiles_guangzhou"

# --- “礼貌”设置 ---
# ⚠️ 警告：这是最重要的修改。请务必替换为您自己的信息。
# 格式: ApplicationName/Version (ContactInfo; e.g., URL or email)
USER_AGENT = "WebChat-Offline-Tile-Downloader/1.0 (https://github.com/your-repo or mailto:your-email@example.com)"

# 大幅降低并发数
NUM_WORKERS = 2  # 从 16 降至 2

# 增加请求间的随机延迟 (0.2 到 0.6 秒)
REQUEST_DELAY_MIN = 0.2
REQUEST_DELAY_MAX = 0.6
# --------------------

RETRY_COUNT = 3
RETRY_DELAY = 5 # 增加重试延迟
REQUEST_TIMEOUT = 20

# --- 脚本核心逻辑 ---

def deg2num(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.log(math.tan(lat_rad) + (1 / math.cos(lat_rad))) / math.pi) / 2.0 * n)
    return (xtile, ytile)

def download_tile(url, path, session):
    if os.path.exists(path):
        return "skipped"

    for attempt in range(RETRY_COUNT):
        try:
            # 在每次请求前加入延迟
            time.sleep(random.uniform(REQUEST_DELAY_MIN, REQUEST_DELAY_MAX))

            response = session.get(url, timeout=REQUEST_TIMEOUT, stream=True)

            # 检查是否被明确禁止
            if response.status_code == 403 or "osm.wiki/Blocked" in response.text:
                return "blocked"

            if response.status_code == 200:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                return "downloaded"
            else:
                return "failed"
        except requests.exceptions.RequestException:
            pass
        time.sleep(RETRY_DELAY * (attempt + 1))
    return "failed"

def main():
    tiles_to_download = []

    print("Calculating tiles to download...")
    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        x_min, y_max = deg2num(BOUNDING_BOX["lat_max"], BOUNDING_BOX["lon_min"], z)
        x_max, y_min = deg2num(BOUNDING_BOX["lat_min"], BOUNDING_BOX["lon_max"], z)
        for x in range(x_min, x_max + 1):
            for y in range(y_max, y_min + 1):
                server_url = random.choice(TILE_SERVER_URLS)
                url = server_url.format(z=z, x=x, y=y)
                path = os.path.join(OUTPUT_DIR, str(z), str(x), f"{y}.png")
                tiles_to_download.append((url, path))

    total_tiles = len(tiles_to_download)
    print(f"Total tiles to download: {total_tiles}")

    if total_tiles == 0:
        return

    proceed = input(f"Proceed with slow & respectful download? (y/n): ")
    if proceed.lower() != 'y':
        print("Download cancelled.")
        return

    session = requests.Session()
    # 确保 User-Agent 被设置
    if not USER_AGENT or "your-email@example.com" in USER_AGENT:
        print("\nFATAL ERROR: Please set a unique User-Agent in the script before running.")
        return
    session.headers.update({"User-Agent": USER_AGENT})

    counts = {"downloaded": 0, "skipped": 0, "failed": 0, "blocked": 0}
    with ThreadPoolExecutor(max_workers=NUM_WORKERS) as executor:
        with tqdm(total=total_tiles, unit="tile", desc="Downloading tiles") as pbar:
            futures = {executor.submit(download_tile, url, path, session): (url, path) for url, path in tiles_to_download}
            for future in futures:
                result = future.result()
                if result:
                    counts[result] += 1
                pbar.update(1)
                # 如果检测到被封禁，立即停止
                if counts["blocked"] > 0:
                    print("\nAccess blocked by OSM server! Aborting download.")
                    # 尝试取消剩余的任务
                    for f in futures:
                        f.cancel()
                    break

    print("\nDownload finished or aborted.")
    print(f"Downloaded: {counts['downloaded']}, Skipped: {counts['skipped']}, Failed: {counts['failed']}, Blocked: {counts['blocked']}")
    print(f"Tiles are located in: {os.path.abspath(OUTPUT_DIR)}")

if __name__ == "__main__":
    main()