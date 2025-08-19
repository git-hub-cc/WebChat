import os
import re
import requests
import json
from bs4 import BeautifulSoup, CData
from urllib.parse import urlparse, urljoin

# --- 配置 ---
INPUT_HTML = 'index.html'
OUTPUT_DIR = '.'  # We will save files into a structured directory inside this path
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}
DOWNLOADED_URLS = set()

def get_local_path_from_url(url, base_dir):
    """根据 URL 生成本地存储路径"""
    parsed_url = urlparse(url)
    # 路径不应包含查询参数或片段
    path_segments = parsed_url.path.lstrip('/').split('/')
    # 将 netloc 添加为根目录，以避免来自不同域的同名文件冲突
    local_path = os.path.join(base_dir, parsed_url.netloc, *path_segments)
    return os.path.normpath(local_path)

def download_resource(url, output_path, quiet=False):
    """下载指定 URL 的资源并保存到本地"""
    if url in DOWNLOADED_URLS:
        if not quiet:
            print(f"  [缓存命中] 资源已在本次任务中下载: {url}")
        return None, False

    if not quiet:
        print(f"  [下载] {url} -> {output_path}")

    output_dir = os.path.dirname(output_path)
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        if not quiet:
            print(f"  [创建目录] {output_dir}")

    if os.path.exists(output_path):
        if not quiet:
            print(f"  [跳过] 文件已存在: {output_path}")
        DOWNLOADED_URLS.add(url)
        try:
            with open(output_path, 'rb') as f:
                return f.read(), True
        except IOError as e:
            if not quiet:
                print(f"  [错误] 读取本地文件失败: {e}")
            return None, False

    try:
        response = requests.get(url, headers=HEADERS, timeout=30, stream=True)
        response.raise_for_status()
        content = response.content
        with open(output_path, 'wb') as f:
            f.write(content)
        DOWNLOADED_URLS.add(url)
        return content, True
    except requests.exceptions.RequestException as e:
        if not quiet:
            print(f"  [错误] 下载失败: {e}")
        return None, False

def download_monaco_files(lib_name, version, base_cdn_url, output_dir):
    """
    使用 cdnjs API 获取 Monaco Editor 的完整文件列表并下载所有文件。
    """
    api_url = f"https://api.cdnjs.com/libraries/{lib_name}/{version}?fields=files"
    print(f"\n[Monaco下载] 使用 cdnjs API: {api_url}")
    try:
        response = requests.get(api_url, headers=HEADERS, timeout=30)
        response.raise_for_status()
        data = response.json()
        files_to_download = data.get('files', [])
    except (requests.exceptions.RequestException, json.JSONDecodeError) as e:
        print(f"  [错误] 无法从 cdnjs API 获取文件列表: {e}")
        print("  [警告] 将跳过 Monaco Editor 的批量下载。")
        return False

    if not files_to_download:
        print("  [警告] cdnjs API 未返回任何文件，无法下载 Monaco Editor。")
        return False

    print(f"  [Monaco下载] 发现 {len(files_to_download)} 个文件。开始下载...")
    cdn_base = f"https://cdnjs.cloudflare.com/ajax/libs/{lib_name}/{version}/"

    for i, file_path in enumerate(files_to_download):
        file_url = urljoin(cdn_base, file_path)
        # 保持与 cdn 相同的目录结构
        local_path = os.path.join(get_local_path_from_url(cdn_base, output_dir), file_path)

        print(f"    ({i+1}/{len(files_to_download)}) 下载 {file_path}...")
        download_resource(file_url, local_path.replace('/', os.sep), quiet=True)

    print("  [Monaco下载] 所有文件下载完成。")
    return True

# ... (process_css_content 和 process_js_content 保持不变) ...

def process_css_content(css_content, base_css_url, base_dir):
    """解析 CSS 内容，下载其中引用的资源（如字体、图片）"""
    url_pattern = re.compile(r'url\((?![\'"]?data:)([\'"]?([^\'"\)]+)[\'"]?)\)')
    modified_css = css_content
    for match in reversed(list(url_pattern.finditer(css_content))):
        original_specifier = match.group(1)
        relative_url = match.group(2).strip()
        if not relative_url: continue

        absolute_sub_url = urljoin(base_css_url, relative_url)
        sub_local_path = get_local_path_from_url(absolute_sub_url, base_dir)

        # 下载资源
        download_resource(absolute_sub_url, sub_local_path)

        # 计算相对路径并更新CSS内容
        css_file_path = get_local_path_from_url(base_css_url, base_dir)
        relative_new_path = os.path.relpath(sub_local_path, os.path.dirname(css_file_path))
        relative_new_path = relative_new_path.replace(os.sep, '/')

        # 保持原始的引号风格
        if original_specifier.startswith("'") and original_specifier.endswith("'"):
            new_specifier = f"'{relative_new_path}'"
        elif original_specifier.startswith('"') and original_specifier.endswith('"'):
            new_specifier = f'"{relative_new_path}"'
        else:
            new_specifier = relative_new_path

        start, end = match.span(1)
        modified_css = modified_css[:start] + new_specifier + modified_css[end:]

    # 如果CSS内容被修改，则写回文件
    if modified_css != css_content:
        css_file_path = get_local_path_from_url(base_css_url, base_dir)
        print(f"  [更新CSS内部路径] {css_file_path}")
        with open(css_file_path, 'w', encoding='utf-8') as f:
            f.write(modified_css)

def process_js_content(js_content, base_js_url, base_dir):
    """
    (简化版) 解析 JS 内容，下载其中引用的相对路径资源。
    主要针对 worker 或其他通过相对路径加载的脚本。
    """
    path_pattern = re.compile(r'[\'"]((\.\.?/|\w+/)[^"\'\s]+?\.js)[\'"]')
    for match in path_pattern.finditer(js_content):
        relative_path = match.group(1)
        print(f"    [JS子资源] 发现相对路径: {relative_path}")
        absolute_sub_url = urljoin(base_js_url, relative_path)
        sub_local_path = get_local_path_from_url(absolute_sub_url, base_dir)
        sub_content, success = download_resource(absolute_sub_url, sub_local_path)
        if success and sub_content:
             try:
                process_js_content(sub_content.decode('utf-8', errors='ignore'), absolute_sub_url, base_dir)
             except Exception:
                 pass # 不是文本文件，忽略


def process_html_file(html_path, output_dir):
    """处理主 HTML 文件，包括外链资源和内联脚本"""
    print(f"[开始处理] {html_path}")
    try:
        with open(html_path, 'r', encoding='utf-8') as f:
            soup = BeautifulSoup(f.read(), 'html.parser')
    except FileNotFoundError:
        print(f"[致命错误] 输入文件未找到: {html_path}")
        return

    # --- 步骤 1: 处理 <link> 和 <script src="..."> 等外链资源 ---
    # (此部分逻辑保持不变)
    tags_to_process = soup.find_all(['link', 'script'])
    for tag in tags_to_process:
        url_attr = 'href' if tag.name == 'link' else 'src'
        original_url = tag.get(url_attr)
        if not original_url or original_url.startswith('data:'):
            continue

        if original_url.startswith('//'):
            absolute_url = 'https:' + original_url
        elif original_url.startswith('http://') or original_url.startswith('https://'):
            absolute_url = original_url
        else:
            print(f"[忽略] 本地资源: {original_url}")
            continue

        print(f"\n[发现外链资源] <{tag.name}> {absolute_url}")
        local_path = get_local_path_from_url(absolute_url, output_dir)
        content, success = download_resource(absolute_url, local_path)

        if success:
            is_stylesheet = tag.name == 'link' and 'stylesheet' in (tag.get('rel') or [])
            is_javascript = tag.name == 'script'
            if is_stylesheet and content:
                print(f"  [解析CSS] {local_path}")
                try:
                    process_css_content(content.decode('utf-8'), absolute_url, output_dir)
                except UnicodeDecodeError:
                    print(f"  [警告] CSS 文件解码失败，跳过内容解析: {local_path}")
            if is_javascript and content:
                print(f"  [解析JS] {local_path}")
                try:
                    process_js_content(content.decode('utf-8', errors='ignore'), absolute_url, output_dir)
                except Exception:
                    pass

            relative_new_path = os.path.relpath(local_path, os.path.dirname(os.path.join(output_dir, INPUT_HTML)))
            tag[url_attr] = relative_new_path.replace(os.sep, '/')
            print(f"  [更新路径] {original_url} -> {tag[url_attr]}")


    # --- 步骤 2: 处理内联 <script> 中的 require.js 配置 ---
    print("\n[扫描内联脚本以查找 require.config]")
    inline_scripts = soup.find_all('script', src=None)
    for script_tag in inline_scripts:
        if not script_tag.string:
            continue

        script_content = script_tag.string
        if 'require.config' not in script_content:
            continue

        print("[发现 require.config]")

        # 正则表达式查找 cdnjs 上的 monaco-editor 路径
        monaco_pattern = re.compile(r"['\"](https://cdnjs\.cloudflare\.com/ajax/libs/(monaco-editor)/([0-9.]+)/min/vs)['\"]")
        match = monaco_pattern.search(script_content)

        if not match:
            print("  [信息] require.config 中未发现可处理的 Monaco Editor cdnjs 路径。")
            continue

        original_cdn_path = match.group(1)
        lib_name = match.group(2)
        version = match.group(3)
        print(f"  [Monaco识别] 库: {lib_name}, 版本: {version}")

        # 批量下载所有Monaco文件
        if download_monaco_files(lib_name, version, original_cdn_path, output_dir):
            # 下载成功，现在更新HTML中的路径
            local_base_path = get_local_path_from_url(original_cdn_path, output_dir)
            relative_new_path = os.path.relpath(local_base_path, os.path.dirname(os.path.join(output_dir, INPUT_HTML)))
            relative_new_path = relative_new_path.replace(os.sep, '/')

            print(f"  [更新 require.config 路径] {original_cdn_path} -> {relative_new_path}")

            # 替换脚本内容中的URL
            modified_content = script_content.replace(original_cdn_path, relative_new_path)

            # 使用 CData 来防止 BeautifulSoup 转义特殊字符
            script_tag.string.replace_with(CData(modified_content))
        else:
            print("  [失败] Monaco Editor 下载失败，HTML 中的路径将不会被修改。")


    # --- 步骤 3: 保存修改后的 HTML ---
    modified_html_path = os.path.join(output_dir, os.path.basename(html_path))
    with open(modified_html_path, 'w', encoding='utf-8') as f:
        # 使用 str(soup) 以保留 CData 的原始格式
        f.write(str(soup))
    print(f"\n[处理完成] 修改后的 HTML 已保存至: {modified_html_path}")

if __name__ == '__main__':
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
    process_html_file(INPUT_HTML, OUTPUT_DIR)