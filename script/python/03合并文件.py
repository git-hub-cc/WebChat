import os
import sys

# --- 配置 ---
# 起始搜索目录（'.' 表示当前目录）
START_DIRECTORY = '.'
# 输出文件名
OUTPUT_FILE = 'res-vue.md'
# 允许的文件扩展名 (请使用小写)
ALLOWED_EXTENSIONS = ['.md', '.html', '.js', '.css', '.json', '.vue', '.svg']
# 行数限制
LINE_LIMIT = 1000
# 要排除的目录名
EXCLUDED_DIRS = ['node_modules', 'tmp', 'dist']
# 【新增】要排除的特定文件名
EXCLUDED_FILES = ['package-lock.json', 'res_vue.md']
# --- 配置结束 ---

def find_files_recursively(start_dir: str) -> list[str]:
    """
    递归地在目录中查找符合条件的文件。

    :param start_dir: 要搜索的起始目录。
    :return: 一个包含所有符合条件文件路径的列表。
    """
    target_files = []
    # os.walk 会遍历指定目录下的所有子目录和文件
    for dirpath, dirnames, filenames in os.walk(start_dir):
        # --- 核心优化：原地修改 dirnames 列表可以阻止 os.walk 进入这些目录 ---
        # 这样比进入目录后再判断要高效得多
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]

        for filename in filenames:
            # 构造完整的文件路径
            full_path = os.path.join(dirpath, filename)

            # 检查文件扩展名是否在允许列表中
            # os.path.splitext() 会将 "file.txt" 分割成 ("file", ".txt")
            file_ext = os.path.splitext(filename)[1].lower()

            # 【修改】确保不把输出文件本身、不符合扩展名的文件以及在排除列表中的文件包含进去
            if (filename != OUTPUT_FILE and
                    file_ext in ALLOWED_EXTENSIONS and
                    filename not in EXCLUDED_FILES): # <-- 新增的判断条件
                # 使用 os.path.normpath 来规范化路径（例如，将 './' 转换为 '.'）
                target_files.append(os.path.normpath(full_path))

    return target_files

def main():
    """
    主函数，执行文件合并逻辑。
    """
    print('🚀 开始扫描并合并文件...')

    try:
        # 1. 查找所有相关文件
        target_files = find_files_recursively(START_DIRECTORY)

        if not target_files:
            print(f'🤷 在当前目录及子目录中未找到任何符合条件的文件。')
            return

        print(f'🔍 找到了 {len(target_files)} 个文件，准备处理...')

        final_content = []

        # 2. 遍历并处理每个文件
        for file_path in target_files:
            try:
                # 使用 'with' 语句安全地读取文件，并指定 utf-8 编码
                # errors='ignore' 可以避免因个别文件编码问题导致整个脚本失败
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    lines = f.readlines()

                content_to_append = "".join(lines)

                # 3. 检查行数是否超限
                if len(lines) > LINE_LIMIT:
                    # 在控制台打印警告信息
                    print(
                        f"[⚠️ 警告] 文件行数超限: {file_path}\n"
                        f"         总行数: {len(lines)}, 将截取前 {LINE_LIMIT} 行。"
                    )
                    # 截取前 LINE_LIMIT 行
                    content_to_append = "".join(lines[:LINE_LIMIT])

                # 4. 为每个文件内容添加分隔符和标题
                # os.path.splitext(file_path)[1] 获取扩展名（如 '.java'）
                # [1:] 去掉前面的点，得到 'java'
                lang = os.path.splitext(file_path)[1][1:].lower() or 'text'

                file_header = f"\n\n---\n\n## 📄 文件: {file_path}\n\n---\n\n"
                code_block_wrapper = f"```{lang}\n{content_to_append.strip()}\n```"

                final_content.append(file_header + code_block_wrapper)

            except IOError as read_error:
                print(f'❌ 读取文件 {file_path} 失败: {read_error}', file=sys.stderr)
            except Exception as e:
                print(f'❌ 处理文件 {file_path} 时发生未知错误: {e}', file=sys.stderr)


        # 5. 将合并后的内容写入输出文件
        output_path = os.path.join(START_DIRECTORY, OUTPUT_FILE)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write("".join(final_content))

        print(f'\n✅ 操作成功!')
        print(f'   - 合并了 {len(target_files)} 个文件。')
        print(f'   - 输出文件已保存至: {os.path.abspath(output_path)}')

    except Exception as error:
        print(f'❌ 处理过程中发生严重错误: {error}', file=sys.stderr)

# 当该脚本被直接执行时，才运行 main() 函数
if __name__ == "__main__":
    main()