import os
import sys

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
    print(f"[*] 正在扫描目录: {os.path.abspath(root_folder)}")

    # os.walk 会递归遍历目录树
    for dirpath, _, filenames in os.walk(root_folder):
        for filename in filenames:
            # str.endswith() 可以接受一个元组作为参数
            if filename.lower().endswith(TARGET_SUFFIXES):
                full_path = os.path.join(dirpath, filename)
                files_to_delete.append(full_path)

    return files_to_delete

def main():
    """
    脚本主函数
    """
    # 1. 获取目标目录
    target_dir = input("请输入要扫描的目录路径 (直接回车则扫描当前目录): ").strip()
    if not target_dir:
        target_dir = '.'  # '.' 代表当前目录

    # 检查目录是否存在
    if not os.path.isdir(target_dir):
        print(f"[错误] 目录不存在: {target_dir}")
        sys.exit(1) # 退出脚本

    # 2. 查找匹配的文件
    files_list = find_files_to_delete(target_dir)

    # 如果没有找到文件，则直接退出
    if not files_list:
        print("\n[结果] 未找到任何匹配的文件。")
        return

    # 3. 演练 (Dry Run) - 预览将要删除的文件
    print("\n" + "="*50)
    print(" DRY RUN - 以下文件将被删除 ".center(50, "="))
    print("="*50)
    for f in files_list:
        print(f"  - {f}")
    print("="*50)
    print(f"[总计] 发现 {len(files_list)} 个文件待删除。")
    print("="*50 + "\n")


    # 5. 执行删除操作
    print("\n[*] 开始执行删除操作...")
    deleted_count = 0
    failed_count = 0
    for f_path in files_list:
        try:
            os.remove(f_path)
            print(f"[已删除] {f_path}")
            deleted_count += 1
        except OSError as e:
            print(f"[删除失败] {f_path} -原因: {e}")
            failed_count += 1

    # 6. 显示最终结果
    print("\n" + "-"*50)
    print(" 操作完成 ".center(50, "-"))
    print(f"成功删除: {deleted_count} 个文件")
    print(f"删除失败: {failed_count} 个文件")
    print("-"*50)


if __name__ == "__main__":
    main()