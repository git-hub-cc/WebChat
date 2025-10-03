import os
from PIL import Image, ImageFilter
from rembg import remove, new_session
import io

def process_images_recursively():
    """
    递归地查找当前目录及其所有子目录下的 .png 和 .webp 图片，
    移除背景并覆盖原文件。
    尝试使用 'u2net_human_seg' 模型（如果更侧重人物图片），
    并对 Alpha 通道进行轻微模糊以平滑边缘。
    """
    start_dir = os.getcwd()
    print(f"将在目录 '{start_dir}' 及其所有子目录中查找并处理图片...")

    processed_files_count = 0

    # 尝试创建或使用一个特定的 rembg session
    # 如果你的 rembg 版本支持，可以尝试 'u2net_human_seg'
    # 如果遇到错误，可以尝试其他模型，例如 'u2netp' 或 'u2net' (默认)
    # 检查 rembg 文档以获取最新支持的模型名称
    try:
        session = new_session("u2net_human_seg") # 尝试使用专门识别人类的模型
        print("正在使用 'u2net_human_seg' 模型进行背景移除。")
    except Exception:
        session = new_session("u2net") # 回退到默认模型
        print("无法加载 'u2net_human_seg' 模型，回退到默认 'u2net' 模型。")


    for dirpath, _, filenames in os.walk(start_dir):
        for filename in filenames:
            if filename.lower().endswith(('.png', '.webp')):
                input_path = os.path.join(dirpath, filename)
                relative_path = os.path.relpath(input_path, start_dir)

                print(f"正在处理: {relative_path}...")

                try:
                    with open(input_path, 'rb') as f:
                        input_bytes = f.read()

                    # 使用指定的 session 进行背景移除
                    output_bytes = remove(input_bytes, session=session)
                    img = Image.open(io.BytesIO(output_bytes))

                    # 后处理：对 Alpha 通道进行轻微高斯模糊以平滑边缘
                    if img.mode == 'RGBA':
                        alpha = img.split()[-1]
                        # 调整模糊半径 (例如 1 或 2) 来控制平滑程度
                        blurred_alpha = alpha.filter(ImageFilter.GaussianBlur(radius=1))
                        img.putalpha(blurred_alpha)

                    # 保存为 PNG 格式以保留透明度
                    # 如果原文件是 .webp，可以考虑保存为 .webp，但 PNG 更通用
                    img.save(input_path, format='PNG')

                    print(f"处理完成: {relative_path} 已被覆盖。")
                    processed_files_count += 1

                except Exception as e:
                    print(f"处理 '{relative_path}' 时发生错误: {e}")

    print("\n--- 处理总结 ---")
    if processed_files_count == 0:
        print("未找到任何 .png 或 .webp 文件。")
        print("请确认：")
        print("1. 脚本是否在包含图片的正确目录下运行。")
        print("2. 图片文件是否确实在当前目录或其子目录中。")
        print("3. 文件扩展名是否正确（例如，不是 .jpg 或 .jpeg）。")
    else:
        print(f"总共处理并覆盖了 {processed_files_count} 个文件。")

if __name__ == "__main__":
    process_images_recursively()