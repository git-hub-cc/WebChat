#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import importlib.util
from typing import List, Dict, Set

# ==============================================================================
# 1. 配置 (Configuration)
# ==============================================================================

# 目标目录：Spring Boot 项目的文件
TARGET_DIR: str = "../../src/main/java/club/ppmc"

# 输出文件名
OUTPUT_FILE: str = "data.md"

# 必需的第三方库
REQUIRED_LIBS: List[str] = ["rich"] # Pillow 和 rjsmin 作为示例保留，可按需增删
# REQUIRED_LIBS: List[str] = ["rich", "Pillow", "rjsmin"]

# 扫描时要忽略的文件扩展名和特定文件名
EXCLUDED_EXTENSIONS: Set[str] = { ".log", ".DS_Store"}
EXCLUDED_FILES: Set[str] = {OUTPUT_FILE, os.path.basename(__file__)}


# 尝试导入 rich，如果失败则提供基础的打印功能
try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.text import Text
    from rich.prompt import Confirm
    from rich.theme import Theme

    # 自定义主题，增强可读性
    custom_theme = Theme({
        "info": "cyan",
        "success": "bold green",
        "warning": "yellow",
        "danger": "bold red",
        "path": "italic blue",
        "title": "bold magenta"
    })
    console = Console(theme=custom_theme)
except ImportError:
    # 如果 rich 未安装，创建一个模拟的 Console 类，以便依赖检查部分可以正常工作
    class SimpleConsole:
        def print(self, text, *args, **kwargs):
            print(text)
    console = SimpleConsole()


# ==============================================================================
# 2. 核心函数 (Core Functions)
# ==============================================================================

def check_dependencies():
    """
    检查所有必需的第三方库是否已安装。
    如果缺少任何库，则打印错误并退出。
    """
    console.print(Panel("[bold]1. 依赖前置检查[/bold]", style="info", expand=False))

    missing_libs: List[str] = []
    for lib_name in REQUIRED_LIBS:
        spec = importlib.util.find_spec(lib_name)
        if spec is None:
            missing_libs.append(lib_name)

    if missing_libs:
        console.print(
            f"[danger]错误：检测到缺失必要的库: {', '.join(missing_libs)}[/danger]"
        )
        install_command = f"pip install {' '.join(missing_libs)}"
        console.print(
            f"[warning]请先运行以下命令安装依赖：[/warning]\n"
            f"[bold cyan]{install_command}[/bold cyan]"
        )
        sys.exit(1)

    console.print("[success]✔ 所有依赖均已满足。[/success]\n")

def scan_source_files(directory: str) -> List[str]:
    """
    递归扫描指定目录，收集符合条件的文件路径。

    Args:
        directory (str): 要扫描的根目录。

    Returns:
        List[str]: 找到的文件路径列表。
    """
    console.print(Panel(f"[bold]2. 扫描目标目录: [path]{directory}[/path][/bold]", style="info", expand=False))

    if not os.path.isdir(directory):
        console.print(f"[danger]错误：目标目录 '{directory}' 不存在或不是一个目录。[/danger]")
        console.print("[warning]请确保您在 Spring Boot 项目的根目录下运行此脚本。[/warning]")
        sys.exit(1)

    found_files: List[str] = []
    for root, _, files in os.walk(directory):
        for filename in files:
            file_path = os.path.join(root, filename)
            _, extension = os.path.splitext(filename)

            if filename in EXCLUDED_FILES or extension in EXCLUDED_EXTENSIONS:
                console.print(f"[dim]  - 忽略: {file_path}[/dim]")
                continue

            found_files.append(file_path)
            console.print(f"  [info]● 发现: {file_path}[/info]")

    if not found_files:
        console.print("\n[warning]警告：在目标目录中未找到任何符合条件的文件。[/warning]")
    else:
        console.print(f"\n[success]✔ 扫描完成，共发现 {len(found_files)} 个文件。[/success]\n")

    return sorted(found_files)

def preview_and_confirm(file_list: List[str]) -> bool:
    """
    向用户预览将要执行的操作，并请求显式确认。

    Args:
        file_list (List[str]): 将被合并的文件列表。

    Returns:
        bool: 如果用户确认，则返回 True，否则返回 False。
    """
    preview_text = Text(f"以下 {len(file_list)} 个文件的内容将被合并写入到 [path]{OUTPUT_FILE}[/path]:\n\n")
    for f in file_list:
        preview_text.append(f"  • {f}\n", style="info")

    console.print(Panel(
        preview_text,
        title="[title]3. 操作预览与安全确认[/title]",
        border_style="warning",
        expand=False
    ))

    # 显式确认
    confirmation = Confirm.ask(
        "[bold]您确定要执行此操作吗？ (此操作将覆盖现有的 data.md 文件)[/bold]",
        default=False
    )
    return confirmation

def merge_files_to_markdown(file_list: List[str], output_filename: str):
    """
    将文件列表的内容合并到一个 Markdown 文件中。

    Args:
        file_list (List[str]): 要合并的文件路径列表。
        output_filename (str): 输出的 Markdown 文件名。
    """
    console.print(Panel(f"[bold]4. 执行合并操作 -> [path]{output_filename}[/path][/bold]", style="info", expand=False))

    try:
        with open(output_filename, "w", encoding="utf-8") as outfile:
            outfile.write(f"# 项目文件内容合集 ({len(file_list)} files)\n\n")
            for file_path in file_list:
                console.print(f"  [yellow]  ⟳ 正在处理: {file_path}...[/yellow]")
                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as infile:
                        content = infile.read()
                        file_extension = os.path.splitext(file_path)[1].lstrip('.')

                        outfile.write(f"## `FILE: {file_path}`\n\n")
                        outfile.write(f"```{file_extension}\n")
                        outfile.write(content)
                        outfile.write("\n```\n\n---\n\n")
                except Exception as e:
                    console.print(f"[danger]  ✗ 读取文件失败: {file_path} - {e}[/danger]")
        console.print(f"\n[success]✔ 所有文件已成功合并到 {output_filename}[/success]")
    except IOError as e:
        console.print(f"[danger]错误：无法写入输出文件 {output_filename}。请检查文件权限。[/danger]")
        console.print(f"[dim]{e}[/dim]")
        sys.exit(1)


# ==============================================================================
# 3. 主逻辑 (Main Logic)
# ==============================================================================

def main():
    """脚本的主执行函数"""
    try:
        console.print(Panel(
            "[bold]Spring Boot 项目静态资源合并脚本[/bold]\n"
            "此脚本将扫描指定目录，并将文件内容合并为一个 Markdown 文件。",
            title="[title]脚本启动[/title]",
            border_style="success"
        ))

        # 1. 依赖检查
        check_dependencies()

        # 2. 扫描文件
        files_to_merge = scan_source_files(TARGET_DIR)
        if not files_to_merge:
            console.print("[info]没有文件需要处理，脚本执行结束。[/info]")
            sys.exit(0)

        # 3. 预览并请求确认
        if not preview_and_confirm(files_to_merge):
            console.print("\n[warning]用户取消了操作。脚本已终止。[/warning]")
            sys.exit(0)

        # 4. 执行文件合并
        merge_files_to_markdown(files_to_merge, OUTPUT_FILE)

        # 5. 最终总结报告
        summary_text = Text(f"成功将 {len(files_to_merge)} 个文件合并到了项目根目录下的 ")
        summary_text.append(f"{OUTPUT_FILE}", style="path")
        summary_text.append(" 文件中。")

        console.print(Panel(
            summary_text,
            title="[title]✨ 操作完成 ✨[/title]",
            border_style="success",
            expand=False
        ))

    except KeyboardInterrupt:
        console.print("\n\n[danger]用户通过 Ctrl+C 强制中断了脚本。[/danger]")
        sys.exit(1)
    except Exception as e:
        console.print(f"\n\n[danger]发生未知错误: {e}[/danger]")
        sys.exit(1)

if __name__ == "__main__":
    main()