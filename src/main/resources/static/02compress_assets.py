#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
# --- 修改点 1: 引入 rjsmin 并移除 slimit ---
import rjsmin
import rcssmin
import htmlmin
import shutil

# --- 配置 ---
# 要处理的文件扩展名及其对应的压缩函数和目标扩展名
FILE_TYPES_TO_PROCESS = {
    '.js': {
        # --- 修改点 2: 使用 rjsmin.jsmin 作为 JS 压缩器 ---
        # rjsmin 专注于移除空格和注释，不进行变量名混淆，与原配置中 mangle=False 行为一致，更安全。
        'minifier': rjsmin.jsmin,
        'min_ext': '.min.js',
        'skip_if_min_exists': True
    },
    '.css': {
        'minifier': rcssmin.cssmin,
        'min_ext': '.min.css',
        'skip_if_min_exists': True
    }
}

# 需要进行内容替换的文件列表 (相对于当前目录)
# 注意：这里应该指向已经被压缩过的 .min 文件
FILES_FOR_CONTENT_REPLACEMENT = [
    'index.html',
    os.path.join('js', 'ThemeLoader.min.js')
]

# 内容替换规则 (正则表达式, 替换字符串)
# 这个规则会将 'path/file.js' 替换为 'path/file.min.js'
REPLACEMENT_PATTERNS = [
    # 匹配 "path/file.js" -> "path/file.min.js"
    (re.compile(r'"([\w./-]+(?<!\.min))\.(js|css|html)"', re.IGNORECASE), r'"\1.min.\2"'),
    # 匹配 'path/file.js' -> 'path/file.min.js'
    (re.compile(r"'([\w./-]+(?<!\.min))\.(js|css|html)'", re.IGNORECASE), r"'\1.min.\2'"),
    # 匹配 `path/file.js` -> `path/file.min.js` (模板字符串)
    (re.compile(r'`([\w./-]+(?<!\.min))\.(js|css|html)`', re.IGNORECASE), r'`\1.min.\2`'),
    # 匹配没有引号的路径，例如 url(path/style.css) -> url(path/style.min.css)
    (re.compile(r'(\b[\w./-]*\/[\w./-]+(?<!\.min))\.(js|css|html)\b', re.IGNORECASE), r'\1.min.\2'),
]

# --- 辅助函数 (无需修改) ---
def minify_file(filepath, config):
    """压缩单个文件"""
    base, ext = os.path.splitext(filepath)
    min_filepath = base + config['min_ext']

    if config['skip_if_min_exists'] and os.path.exists(min_filepath):
        try:
            # 如果源文件没有比已压缩文件新，则跳过
            if os.path.getmtime(filepath) <= os.path.getmtime(min_filepath):
                print(f"  Skipping (up-to-date): {min_filepath}")
                return False
        except FileNotFoundError:
             pass

    print(f"  Minifying: {filepath} -> {min_filepath}")
    try:
        with open(filepath, 'r', encoding='utf-8') as f_in:
            original_content = f_in.read()
        minified_content = config['minifier'](original_content)
        with open(min_filepath, 'w', encoding='utf-8') as f_out:
            f_out.write(minified_content)
        print(f"  Successfully minified: {min_filepath}")
        return True
    except Exception as e:
        print(f"  Error minifying {filepath}: {e}")
        # 如果压缩失败，将原始文件复制过去，以防构建流程中断
        if not os.path.exists(min_filepath):
            try:
                shutil.copy2(filepath, min_filepath)
                print(f"  Minification failed, copied original to: {min_filepath}")
                return True
            except Exception as copy_e:
                print(f"  Error copying {filepath} to {min_filepath} after minification failure: {copy_e}")
        return False

def replace_content_in_file(filepath, patterns):
    """在文件中执行内容替换"""
    if not os.path.exists(filepath):
        print(f"  File not found for content replacement: {filepath}")
        return

    print(f"  Processing replacements in: {filepath}")
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        original_content = content
        modified_content = content

        for pattern, replacement in patterns:
            modified_content = pattern.sub(replacement, modified_content)

        if modified_content != original_content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(modified_content)
            print(f"  Content replaced in: {filepath}")
        else:
            print(f"  No changes made to: {filepath}")
    except Exception as e:
        print(f"  Error processing replacements in {filepath}: {e}")

# --- 主逻辑 (无需修改) ---
def main():
    current_dir = os.getcwd()
    print(f"Processing files in and under: {current_dir}\n")

    print("--- Minifying Files ---")
    for root, dirs, files in os.walk(current_dir):
        # 排除常见的不需要处理的目录
        dirs[:] = [d for d in dirs if d not in ['.git', 'node_modules', 'venv', '__pycache__']]
        for filename in files:
            filepath = os.path.join(root, filename)
            base, ext = os.path.splitext(filename)
            ext_lower = ext.lower()
            # 检查文件类型是否需要处理，并确保不是已经压缩过的文件
            if ext_lower in FILE_TYPES_TO_PROCESS:
                if not base.lower().endswith('.min'):
                    config = FILE_TYPES_TO_PROCESS[ext_lower]
                    minify_file(filepath, config)

    print("\n--- Replacing Content in Specific Files ---")
    for target_file_relative in FILES_FOR_CONTENT_REPLACEMENT:
        target_filepath = os.path.join(current_dir, target_file_relative)
        replace_content_in_file(target_filepath, REPLACEMENT_PATTERNS)

    print("\nScript finished.")

if __name__ == "__main__":
    main()