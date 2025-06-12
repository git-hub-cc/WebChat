#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import re
import shutil

# --- 依赖检查 ---
# 统一检查所有必需的库
try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Confirm
    from PIL import Image
    import rjsmin
    import rcssmin
    import htmlmin
except ImportError as e:
    print(f"错误：脚本运行缺少必要的 Python 库 (无法导入 '{e.name}')。")
    print("\n此脚本需要多个库才能完整运行。")
    print("请在您的终端或命令行中运行以下命令来安装所有依赖：")
    # 提供一个包含所有依赖的命令，方便用户一次性安装
    print("\npip install rich Pillow rjsmin rcssmin htmlmin\n")
    sys.exit(1)

# 初始化 rich 控制台
console = Console()


# ==============================================================================
# ---                           配置区 (Configuration)                         ---
# ==============================================================================

# --- 压缩与替换配置 ---
FILE_TYPES_TO_PROCESS = {
    '.js': {'minifier': rjsmin.jsmin, 'min_ext': '.min.js', 'skip_if_min_exists': True},
    '.css': {'minifier': rcssmin.cssmin, 'min_ext': '.min.css', 'skip_if_min_exists': True},
    # '.html': {'minifier': htmlmin.minify, 'min_ext': '.min.html', 'skip_if_min_exists': True},
}
FILES_FOR_CONTENT_REPLACEMENT = [
    'index.html',
    os.path.join('js', 'ThemeLoader.min.js')
]
REPLACEMENT_PATTERNS = [
    (re.compile(r'"([\w./-]+(?<!\.min))\.(js|css|html)"', re.IGNORECASE), r'"\1.min.\2"'),
    (re.compile(r"'([\w./-]+(?<!\.min))\.(js|css|html)'", re.IGNORECASE), r"'\1.min.\2'"),
    (re.compile(r'`([\w./-]+(?<!\.min))\.(js|css|html)`', re.IGNORECASE), r'`\1.min.\2`'),
    (re.compile(r'(\burl\((?!["\']?data:)["\']?)([\w./-]+(?<!\.min))\.(css)(["\']?\))', re.IGNORECASE), r'\1\2.min.\3\4'),
]

# --- 图片缩放配置 ---
TARGET_IMAGE_WIDTH = 130


# ==============================================================================
# ---                         辅助函数 (Helper Functions)                      ---
# ==============================================================================

# --- 用于压缩和替换的函数 ---
def minify_file(filepath, config):
    base, _ = os.path.splitext(filepath)
    min_filepath = base + config['min_ext']
    if config['skip_if_min_exists'] and os.path.exists(min_filepath):
        if os.path.getmtime(filepath) <= os.path.getmtime(min_filepath):
            console.print(f"  [cyan]跳过 (已是最新):[/cyan] {os.path.normpath(min_filepath)}")
            return True
    console.print(f"  [yellow]压缩中:[/yellow] {os.path.normpath(filepath)} -> {os.path.normpath(min_filepath)}")
    try:
        with open(filepath, 'r', encoding='utf-8') as f_in:
            original_content = f_in.read()
        minified_content = config['minifier'](original_content)
        with open(min_filepath, 'w', encoding='utf-8') as f_out:
            f_out.write(minified_content)
        return True
    except Exception as e:
        console.print(f"  [red]压缩错误[/red] {os.path.normpath(filepath)}: {e}")
        try:
            shutil.copy2(filepath, min_filepath)
            console.print(f"  [yellow]压缩失败，已复制源文件至:[/yellow] {os.path.normpath(min_filepath)}")
            return True
        except Exception as copy_e:
            console.print(f"  [bold red]复制失败:[/bold red] {copy_e}")
        return False

def replace_content_in_file(filepath, patterns):
    if not os.path.exists(filepath):
        console.print(f"  [red]错误:[/red] 文件未找到，无法替换内容: {os.path.normpath(filepath)}")
        return
    console.print(f"  [yellow]处理中:[/yellow] {os.path.normpath(filepath)}")
    try:
        with open(filepath, 'r', encoding='utf-8') as f: content = f.read()
        modified_content = content
        for pattern, replacement in patterns:
            modified_content = pattern.sub(replacement, modified_content)
        if modified_content != content:
            with open(filepath, 'w', encoding='utf-8') as f: f.write(modified_content)
            console.print(f"  [green]内容已更新:[/green] {os.path.normpath(filepath)}")
        else:
            console.print(f"  [cyan]内容无变化:[/cyan] {os.path.normpath(filepath)}")
    except Exception as e:
        console.print(f"  [red]替换内容时出错[/red] {os.path.normpath(filepath)}: {e}")

# --- 用于图片处理的函数 ---
def resize_image(image_path, target_width):
    try:
        with Image.open(image_path) as img:
            original_width, original_height = img.size
            if original_width == target_width:
                console.print(f"  [cyan]跳过 (宽度已是 {target_width}px):[/cyan] {os.path.normpath(image_path)}")
                return True
            aspect_ratio = original_height / original_width
            target_height = int(round(target_width * aspect_ratio)) or 1
            console.print(f"  [yellow]处理中:[/yellow] {os.path.normpath(image_path)} ({original_width}x{original_height}) -> ({target_width}x{target_height})")
            resized_img = img.resize((target_width, target_height), Image.Resampling.LANCZOS)
            resized_img.save(image_path, format='PNG', optimize=True)
            return True
    except Exception as e:
        console.print(f"  [red]处理错误[/red] {os.path.normpath(image_path)}: {e}")
        return False

def find_files(directory_path, extension):
    found_files = []
    for root, _, files in os.walk(directory_path):
        for filename in files:
            if filename.lower().endswith(extension):
                found_files.append(os.path.join(root, filename))
    return found_files


# ==============================================================================
# ---                         任务模块 (Task Modules)                        ---
# ==============================================================================

def run_minify_and_replace():
    """任务1：压缩 JS/CSS 并更新文件引用"""
    console.print(Panel("任务 1: 压缩 JS/CSS 并更新文件引用", style="bold blue", expand=False))
    target_dir = os.path.join('src', 'main', 'resources', 'static')
    if not os.path.isdir(target_dir):
        console.print(f"[bold red]错误:[/bold red] 目录 '{target_dir}' 不存在。请在项目根目录运行脚本。")
        return

    # --- 压缩文件 ---
    console.print("\n[b]步骤 1/2: 正在压缩文件...[/b]")
    for root, dirs, files in os.walk(target_dir):
        dirs[:] = [d for d in dirs if d not in ['.git', 'node_modules', 'venv', '__pycache__']]
        for filename in files:
            if not filename.lower().endswith(tuple(config['min_ext'] for config in FILE_TYPES_TO_PROCESS.values())):
                ext = '.' + filename.rsplit('.', 1)[-1] if '.' in filename else ''
                if ext.lower() in FILE_TYPES_TO_PROCESS:
                    minify_file(os.path.join(root, filename), FILE_TYPES_TO_PROCESS[ext.lower()])

    # --- 内容替换 ---
    console.print("\n[b]步骤 2/2: 正在更新文件引用...[/b]")
    files_to_modify = [os.path.join(target_dir, p) for p in FILES_FOR_CONTENT_REPLACEMENT if os.path.exists(os.path.join(target_dir, p))]
    if not files_to_modify:
        console.print("[green]未找到需要更新引用的文件。[/green]")
        console.print(Panel("任务 1 完成", style="bold green", expand=False))
        return

    preview_content = "\n".join(f"  - {os.path.normpath(f)}" for f in files_to_modify)
    console.print("以下文件的内容 [bold]将被修改[/bold]:")
    console.print(Panel(preview_content, border_style="yellow", expand=False))

    if Confirm.ask(f"[bold yellow]您确定要修改这 {len(files_to_modify)} 个文件吗？[/bold yellow]", default=False):
        for f in files_to_modify:
            replace_content_in_file(f, REPLACEMENT_PATTERNS)
    else:
        console.print("[cyan]内容替换操作已取消。[/cyan]")
    console.print(Panel("任务 1 完成", style="bold green", expand=False))


def run_resize_avatars():
    """任务2：缩放头像图片"""
    console.print(Panel("任务 2: 缩放头像图片 (PNG)", style="bold blue", expand=False))
    target_dir = os.path.join('src', 'main', 'resources', 'static', 'img', 'head')
    if not os.path.isdir(target_dir):
        console.print(f"[bold red]错误:[/bold red] 目录 '{target_dir}' 不存在。请在项目根目录运行脚本。")
        return

    files_to_process = find_files(target_dir, ".png")
    if not files_to_process:
        console.print("[green]未找到任何 .png 图片文件。[/green]")
        console.print(Panel("任务 2 完成", style="bold green", expand=False))
        return

    preview_content = "\n".join(f"  - {os.path.normpath(f)}" for f in files_to_process)
    warning_panel = Panel(
        f"目标宽度: [bold cyan]{TARGET_IMAGE_WIDTH}px[/bold cyan]\n"
        f"发现 [bold yellow]{len(files_to_process)}[/bold yellow] 个PNG图片将被处理。\n\n"
        f"[bold red]警告：此操作将直接覆盖原始图片文件！[/bold red]",
        title="[bold blue]图片缩放预览[/bold blue]", border_style="blue"
    )
    console.print(warning_panel)
    console.print("以下文件将被修改：")
    console.print(Panel(preview_content, border_style="yellow"))

    if Confirm.ask(f"[bold yellow]您确定要缩放并覆盖这 {len(files_to_process)} 张图片吗？[/bold yellow]", default=False):
        processed_count = sum(1 for f in files_to_process if resize_image(f, TARGET_IMAGE_WIDTH))
        console.print(f"\n成功处理: [green]{processed_count}[/green] 张图片。")
    else:
        console.print("[cyan]图片缩放操作已取消。[/cyan]")
    console.print(Panel("任务 2 完成", style="bold green", expand=False))


# ==============================================================================
# ---                         主控制器 (Main Controller)                       ---
# ==============================================================================

def main():
    """主菜单和任务调度器"""
    console.print(Panel("[bold]Spring Boot 静态资源辅助工具[/bold]", style="bold magenta", expand=False))
    console.print("\n请选择要执行的操作:")
    console.print("[bold yellow]1[/bold yellow]) 压缩 JS/CSS 并更新引用")
    console.print("[bold yellow]2[/bold yellow]) 缩放头像图片")
    console.print("[bold yellow]3[/bold yellow]) [bold]执行所有任务[/bold]")
    console.print("[bold yellow]0[/bold yellow] or [bold yellow]q[/bold yellow]) 退出")

    choice = input("> ").strip().lower()

    if choice == '1':
        run_minify_and_replace()
    elif choice == '2':
        run_resize_avatars()
    elif choice == '3':
        console.print("\n[b]=== 开始执行所有任务 ===[/b]\n")
        run_minify_and_replace()
        console.print("\n" + "="*50 + "\n") # 分隔线
        run_resize_avatars()
        console.print("\n[b]=== 所有任务已执行完毕 ===[/b]")
    elif choice in ('0', 'q'):
        console.print("[bold cyan]脚本退出。再见！[/bold cyan]")
    else:
        console.print("[red]无效输入，请重新选择。[/red]")


if __name__ == "__main__":
    main()