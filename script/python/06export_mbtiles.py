import os
import sqlite3
from PIL import Image
import io

def export_mbtiles(mbtiles_path, output_dir):
    conn = sqlite3.connect(mbtiles_path)
    cursor = conn.cursor()

    cursor.execute("SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles")
    rows = cursor.fetchall()

    for z, x, y, data in rows:
        # MBTiles 存储时 y 轴是 TMS，需要翻转
        y = (1 << z) - 1 - y
        tile_dir = os.path.join(output_dir, str(z), str(x))
        os.makedirs(tile_dir, exist_ok=True)

        tile_path = os.path.join(tile_dir, f"{y}.png")

        with open(tile_path, "wb") as f:
            f.write(data)

    conn.close()
    print(f"Export complete: {output_dir}")

if __name__ == "__main__":
    export_mbtiles(
        "osm-2020-02-10-v3.11_china_guangzhou.mbtiles",
        "tiles_output"
    )
