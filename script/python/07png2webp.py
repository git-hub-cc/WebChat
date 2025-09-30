import os
from PIL import Image

# 目标大小限制 (单位: 字节)
MAX_SIZE = 5 * 1024

def convert_to_webp(png_path):
    webp_path = os.path.splitext(png_path)[0] + ".webp"

    img = Image.open(png_path).convert("RGBA")

    # 初始质量
    quality = 80

    # 逐步降低质量直到满足大小限制
    while quality > 5:
        img.save(webp_path, "WEBP", quality=quality, method=6)
        size = os.path.getsize(webp_path)
        if size <= MAX_SIZE:
            print(f"✅ {png_path} -> {webp_path}, {size/1024:.2f} KB (quality={quality})")
            return
        quality -= 5

    print(f"⚠️ {png_path} 转换后仍大于5KB (最终 {size/1024:.2f} KB)")

def main():
    # 遍历当前目录和所有子目录
    for root, _, files in os.walk("."):
        for file in files:
            if file.lower().endswith(".png"):
                png_path = os.path.join(root, file)
                convert_to_webp(png_path)

if __name__ == "__main__":
    main()
