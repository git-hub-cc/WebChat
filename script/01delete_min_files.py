# 导入标准库
import os
import sys

# --- 依赖检查 ---
# 检查用户是否安装了 'rich' 库，用于美化输出。如果没有，则提示安装。
try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Confirm
except ImportError:
    print("错误：缺少必要的 'rich' 库。")
    print("这个库能让脚本输出更清晰易读。")
    print("请在您的终端或命令行中运行以下命令来安装它：")
    print("pip install rich")
    sys.exit(1) # 退出脚本

# 初始化 rich 控制台
console = Console()


# --- 配置区 ---
# 定义要删除的文件后缀元组
TARGET_SUFFIXES = ('.min.html', '.min.js', '.min.css')


def find_files_to_delete(root_folder):
    """
    在指定目录及其子目录中查找所有匹配后缀的文件。

    Args:
        root_folder (str): 要开始扫描的根目录路径。

    Returns:
        list: 包含所有待删除文件完整路径的列表。
    """
    files_to_delete = []
    # 使用 os.path.abspath 获取绝对路径，让输出更清晰
    abs_root_folder = os.path.abspath(root_folder)
    console.print(f"[*] 正在扫描目录: [cyan]{abs_root_folder}[/cyan]")

    # os.walk 会递归遍历目录树
    for dirpath, _, filenames in os.walk(root_folder):
        for filename in filenames:
            # str.endswith() 可以接受一个元组作为参数，并使用 lower() 忽略大小写
            if filename.lower().endswith(TARGET_SUFFIXES):
                full_path = os.path.join(dirpath, filename)
                files_to_delete.append(full_path)

    return files_to_delete

def main():
    """
    脚本主函数
    """
    # 1. 设置目标目录 (Spring Boot 项目的 static 目录)
    # 假设此脚本在 Spring Boot 项目的根目录下运行
    target_dir = os.path.join('src', 'main', 'resources', 'static')

    # 检查目录是否存在
    if not os.path.isdir(target_dir):
        console.print(
            f"[bold red]错误[/bold red]: 目标目录不存在: '{target_dir}'\n"
            f"请确保您正在 Spring Boot 项目的 [bold]根目录[/bold]下运行此脚本。"
        )
        sys.exit(1) # 退出脚本

    # 2. 查找匹配的文件
    files_list = find_files_to_delete(target_dir)

    # 如果没有找到文件，则直接退出
    if not files_list:
        console.print("\n[bold green]结果[/bold green]: 未找到任何匹配的文件。无需操作。")
        return

    # 3. 演练 (Dry Run) - 使用 Panel 美化预览
    preview_content = "\n".join(f"  - {f}" for f in files_list)
    dry_run_panel = Panel(
        preview_content,
        title="[bold yellow]DRY RUN - 演练模式[/bold yellow]",
        subtitle=f"[cyan]总计 {len(files_list)} 个文件[/cyan]",
        border_style="yellow",
        title_align="left",
        subtitle_align="right",
        expand=True
    )
    console.print(dry_run_panel)
    console.print("以上文件 [bold]将被永久删除[/bold]！")


    # 4. 确认操作
    # 使用 Confirm.ask 提问，默认为 False (更安全)
    if not Confirm.ask(
        f"[bold yellow]您确定要删除这 {len(files_list)} 个文件吗？[/bold yellow]",
        default=False,
        console=console
    ):
        console.print("\n[bold cyan]操作已取消。[/bold cyan]")
        return # 退出 main 函数，不执行删除

    # 5. 执行删除操作
    console.print("\n[*] 开始执行删除操作...")
    deleted_count = 0
    failed_count = 0
    for f_path in files_list:
        try:
            os.remove(f_path)
            console.print(f"[green]  [√] 已删除: [/green]{f_path}")
            deleted_count += 1
        except Exception as e:
            console.print(f"[red]  [×] 删除失败: [/red]{f_path} - 原因: {e}")
            failed_count += 1

    # 6. 显示最终结果
    summary_text = (
        f"成功删除: [bold green]{deleted_count}[/bold green] 个文件\n"
        f"删除失败: [bold red]{failed_count}[/bold red] 个文件"
    )
    summary_panel = Panel(
        summary_text,
        title="[bold blue]操作完成[/bold blue]",
        border_style="blue",
        title_align="center"
    )
    console.print(summary_panel)


if __name__ == "__main__":
    main()