import socket
import struct
import time
import random
import concurrent.futures
from collections import namedtuple, defaultdict
import ipaddress # 用于验证IP地址

# --- STUN 常量 ---
STUN_MESSAGE_TYPE_BINDING_REQUEST = 0x0001 # 绑定请求
STUN_MESSAGE_TYPE_BINDING_SUCCESS_RESPONSE = 0x0101 # 绑定成功响应
STUN_MESSAGE_TYPE_BINDING_ERROR_RESPONSE = 0x0111 # 绑定错误响应 (RFC 5389 & RFC 3489)
STUN_MAGIC_COOKIE = 0x2112A442 # 魔术 Cookie

STUN_ATTRIBUTE_XOR_MAPPED_ADDRESS = 0x0020 # XOR 映射地址属性
STUN_ATTRIBUTE_MAPPED_ADDRESS = 0x0001 # 映射地址属性 (旧版)
STUN_ATTRIBUTE_SOFTWARE = 0x8022 # 服务器软件属性
STUN_ATTRIBUTE_ERROR_CODE = 0x0009 # 错误代码属性

STUN_HEADER_LENGTH = 20 # STUN 头部长度

# --- 用于结果的命名元组 ---
StunAttribute = namedtuple('StunAttribute', ['type', 'length', 'value'])
StunParseResult = namedtuple('StunParseResult', ['public_ip', 'public_port', 'software', 'error_code', 'error_reason', 'raw_attributes', 'error_message'])
MetricResult = namedtuple('MetricResult', ['value', 'details']) # 指标结果: value - 值, details - 详细信息


# --- STUN 消息创建 (允许自定义事务ID) ---
def create_binding_request(transaction_id=None):
    """
    创建一个STUN绑定请求报文。
    transaction_id: 可选的12字节事务ID，如果为None则随机生成。
    """
    message_type = STUN_MESSAGE_TYPE_BINDING_REQUEST
    message_length = 0 # 绑定请求通常没有属性，长度为0
    magic_cookie = STUN_MAGIC_COOKIE
    if transaction_id is None:
        transaction_id = random.getrandbits(96).to_bytes(12, 'big')
    elif isinstance(transaction_id, int): # 如果传入整数，则转换为字节
        transaction_id = transaction_id.to_bytes(12, 'big')

    # STUN 头部: 类型 (2字节), 长度 (2字节), 魔术Cookie (4字节), 事务ID (12字节)
    header = struct.pack('!HHII', message_type, message_length, magic_cookie,
                         int.from_bytes(transaction_id[0:4], 'big')) + \
             struct.pack('!II', int.from_bytes(transaction_id[4:8], 'big'),
                         int.from_bytes(transaction_id[8:12], 'big'))
    return header, transaction_id

# --- STUN 消息解析 (增强版) ---
def parse_stun_response(data, expected_transaction_id):
    """
    解析STUN响应报文。
    返回 StunParseResult 对象。
    """
    if len(data) < STUN_HEADER_LENGTH:
        return StunParseResult(None, None, None, None, None, [], "响应过短")

    msg_type, msg_len, magic_cookie_received = struct.unpack('!HHI', data[0:8])
    transaction_id_received = data[8:20]

    # RFC 5389 Section 7.3. Responses:
    # "If the magic cookie is not present, the agent MUST treat the message
    # as a Classic STUN message [RFC3489] as described in Section 17."
    # Classic STUN error responses might not have the magic cookie.
    is_classic_stun = (magic_cookie_received != STUN_MAGIC_COOKIE)

    if transaction_id_received != expected_transaction_id:
        return StunParseResult(None, None, None, None, None, [], "事务ID不匹配")

    public_ip, public_port, software, error_code, error_reason_str = None, None, None, None, None
    attributes_found = []
    offset = STUN_HEADER_LENGTH
    remaining_length = msg_len # 这是属性的总长度

    while remaining_length > 0 and offset < len(data):
        if (offset + 4) > len(data): # 确保有足够的空间读取属性类型和长度
             break
        attr_type, attr_len = struct.unpack('!HH', data[offset:offset+4])
        attr_value_start = offset + 4
        attr_value_end = attr_value_start + attr_len

        if attr_value_end > len(data): # 属性值超出报文长度
            # print(f"警告: 属性类型 {hex(attr_type)} 长度 {attr_len} 超出消息边界。")
            break

        current_attr_value = data[attr_value_start:attr_value_end]
        attributes_found.append(StunAttribute(attr_type, attr_len, current_attr_value))

        if msg_type == STUN_MESSAGE_TYPE_BINDING_SUCCESS_RESPONSE:
            if attr_type == STUN_ATTRIBUTE_XOR_MAPPED_ADDRESS and not is_classic_stun:
                if attr_len >= 8: # IPv4至少需要8字节
                    family = current_attr_value[1] # 0字节是保留的，1是family
                    xor_port_val = struct.unpack('!H', current_attr_value[2:4])[0]
                    public_port = xor_port_val ^ (STUN_MAGIC_COOKIE >> 16)

                    if family == 0x01 and attr_len == 8: # IPv4
                        xor_ip_val = struct.unpack('!I', current_attr_value[4:8])[0]
                        actual_ip_val = xor_ip_val ^ STUN_MAGIC_COOKIE
                        public_ip = socket.inet_ntoa(struct.pack('!I', actual_ip_val))
                    elif family == 0x02 and attr_len == 20: # IPv6
                        public_ip = "IPv6 (XOR映射地址)" # 简化处理，不完整解析
                    # else: print(f"警告: XOR-MAPPED-ADDRESS 未知地址族 {family} 或长度 {attr_len}")

            elif attr_type == STUN_ATTRIBUTE_MAPPED_ADDRESS: # 旧版或经典STUN回退
                 if attr_len >=8:
                    family = current_attr_value[1]
                    public_port = struct.unpack('!H', current_attr_value[2:4])[0]
                    if family == 0x01 and attr_len == 8: # IPv4
                        public_ip = socket.inet_ntoa(current_attr_value[4:8])
                    elif family == 0x02 and attr_len == 20: # IPv6
                        public_ip = "IPv6 (映射地址)"

            elif attr_type == STUN_ATTRIBUTE_SOFTWARE:
                try:
                    software = current_attr_value.decode('utf-8', errors='ignore')
                except Exception:
                    software = "服务器软件 (解码失败)"

        # 错误响应也可能包含SOFTWARE属性
        if msg_type == STUN_MESSAGE_TYPE_BINDING_ERROR_RESPONSE or \
           (is_classic_stun and msg_type & 0x0100): # 经典STUN错误响应 (例如 0x0101 for request, 0x0111 for error indication in RFC3489)

            if attr_type == STUN_ATTRIBUTE_ERROR_CODE:
                if attr_len >= 4: # 错误代码属性至少4字节长
                    # 错误代码格式: 2字节保留, 1字节Class (百位), 1字节Number (十位和个位)
                    # 整个值是 0x0000CCNN (CC=Class*100, NN=Number)
                    # error_class_byte = current_attr_value[2]
                    # error_number_byte = current_attr_value[3]
                    # error_code = error_class_byte * 100 + error_number_byte
                    # RFC 5389 Error Code: The value of ERROR-CODE is a 32-bit an unsigned integer.
                    # Bits 0-7 are the number, bits 8-10 are the class. Other bits are 0.
                    error_code_raw = struct.unpack('!I', current_attr_value[:4])[0] # 读取完整的4字节
                    error_class = (error_code_raw >> 8) & 0x07 # Class 在 8-10 位 (3 bits)
                    error_number = error_code_raw & 0xFF      # Number 在 0-7 位
                    error_code = error_class * 100 + error_number


                    try:
                        error_reason_str = current_attr_value[4:].decode('utf-8', errors='ignore')
                    except Exception:
                        error_reason_str = "错误原因 (解码失败)"
            elif attr_type == STUN_ATTRIBUTE_SOFTWARE and not software: # 如果之前没解析到
                try:
                    software = current_attr_value.decode('utf-8', errors='ignore')
                except Exception:
                    software = "服务器软件 (解码失败)"


        # 移动到下一个属性，确保按4字节对齐
        padding = (4 - (attr_len % 4)) % 4
        offset += 4 + attr_len + padding
        remaining_length -= (4 + attr_len + padding)

    if public_ip and public_port and msg_type == STUN_MESSAGE_TYPE_BINDING_SUCCESS_RESPONSE and not is_classic_stun:
        return StunParseResult(public_ip, public_port, software, None, None, attributes_found, None)
    elif error_code is not None:
        return StunParseResult(None, None, software, error_code, error_reason_str, attributes_found, f"STUN错误 {error_code}: {error_reason_str}")
    elif msg_type != STUN_MESSAGE_TYPE_BINDING_SUCCESS_RESPONSE and not is_classic_stun :
         return StunParseResult(None, None, software, None, None, attributes_found, f"非成功响应 (类型: {hex(msg_type)})")
    elif is_classic_stun and public_ip and public_port: # 经典STUN成功 (MAPPED_ADDRESS)
        return StunParseResult(public_ip, public_port, software, None, None, attributes_found, None)


    return StunParseResult(None, None, software, None, None, attributes_found, "成功响应中未找到有效映射地址")

# --- 单项测试函数 ---
def perform_stun_test_udp(server_host, server_port, timeout=1.0):
    """执行单次UDP STUN测试"""
    client_socket = None
    try:
        client_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        client_socket.settimeout(timeout)
        # client_socket.bind(('0.0.0.0', 0)) # 如果需要显式绑定以获取getsockname

        local_ip_port_before_send = client_socket.getsockname() # 发送前获取，可能为 0.0.0.0:0

        request_packet, transaction_id = create_binding_request()

        start_time = time.monotonic()
        client_socket.sendto(request_packet, (server_host, server_port))

        # sendto后，如果未显式绑定，套接字会被隐式绑定
        local_ip, local_port = client_socket.getsockname()

        response_data, (response_addr_ip, response_addr_port) = client_socket.recvfrom(2048)
        end_time = time.monotonic()
        latency = (end_time - start_time) * 1000 # 毫秒

        parsed_response = parse_stun_response(response_data, transaction_id)

        return {
            "success": parsed_response.public_ip is not None and parsed_response.error_message is None,
            "latency_ms": latency if parsed_response.error_message is None else float('inf'),
            "public_ip": parsed_response.public_ip,
            "public_port": parsed_response.public_port,
            "local_port_used": local_port, # 本地使用的源端口
            "software": parsed_response.software,
            "error_code": parsed_response.error_code,
            "error_reason": parsed_response.error_reason,
            "response_from_ip": response_addr_ip, # 响应来源IP
            "raw_response_hex": response_data.hex() if response_data else None,
            "error_message": parsed_response.error_message
        }

    except socket.timeout:
        return {"success": False, "error_message": "UDP超时", "latency_ms": float('inf')}
    except socket.gaierror:
        return {"success": False, "error_message": f"UDP主机名解析失败: {server_host}", "latency_ms": float('inf')}
    except Exception as e:
        return {"success": False, "error_message": f"UDP套接字错误: {e}", "latency_ms": float('inf')}
    finally:
        if client_socket:
            client_socket.close()

def perform_stun_test_tcp(server_host, server_port, timeout=2.0): # TCP可能需要更长超时
    """执行单次TCP STUN测试"""
    client_socket = None
    try:
        client_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        client_socket.settimeout(timeout)

        start_time_connect = time.monotonic()
        client_socket.connect((server_host, server_port))
        connect_latency = (time.monotonic() - start_time_connect) * 1000

        request_packet, transaction_id = create_binding_request()

        client_socket.sendall(request_packet) # TCP直接发送STUN消息
        start_time_response = time.monotonic()

        # 首先读取STUN头部 (20字节)
        header_data = client_socket.recv(STUN_HEADER_LENGTH)
        if len(header_data) < STUN_HEADER_LENGTH:
            return {"success": False, "error_message": "TCP接收：STUN头部不完整", "latency_ms": float('inf')}

        # STUN消息长度在头部的第3、4字节，指的是属性部分的长度
        msg_type, msg_len_attr = struct.unpack_from('!HH', header_data, 0)

        attributes_data = b""
        if msg_len_attr > 0:
            bytes_to_read = msg_len_attr
            # STUN属性会填充到4字节边界，但msg_len_attr是精确长度
            # recv应该能获取精确数量的字节
            while bytes_to_read > 0 :
                chunk = client_socket.recv(min(bytes_to_read, 4096)) # 一次最多读4KB
                if not chunk: # 连接关闭
                    return {"success": False, "error_message": "TCP接收：读取属性时连接关闭", "latency_ms": float('inf')}
                attributes_data += chunk
                bytes_to_read -= len(chunk)

        response_data = header_data + attributes_data
        end_time_response = time.monotonic()
        response_latency = (end_time_response - start_time_response) * 1000
        total_latency = connect_latency + response_latency # 或仅用 response_latency (连接后延迟)

        parsed_response = parse_stun_response(response_data, transaction_id)

        return {
            "success": parsed_response.public_ip is not None and parsed_response.error_message is None,
            "latency_ms": total_latency if parsed_response.error_message is None else float('inf'), # 使用包含连接的总延迟
            "public_ip": parsed_response.public_ip,
            "public_port": parsed_response.public_port,
            "software": parsed_response.software,
            "error_code": parsed_response.error_code,
            "error_reason": parsed_response.error_reason,
            "raw_response_hex": response_data.hex() if response_data else None,
            "error_message": parsed_response.error_message
        }

    except socket.timeout:
        return {"success": False, "error_message": "TCP超时", "latency_ms": float('inf')}
    except socket.gaierror:
        return {"success": False, "error_message": f"TCP主机名解析失败: {server_host}", "latency_ms": float('inf')}
    except ConnectionRefusedError:
        return {"success": False, "error_message": "TCP连接被拒绝", "latency_ms": float('inf')}
    except Exception as e:
        return {"success": False, "error_message": f"TCP套接字错误: {e}", "latency_ms": float('inf')}
    finally:
        if client_socket:
            client_socket.close()


# --- 主要测试编排 ---
def test_single_server_detailed(server_host, server_port, num_runs=3, udp_timeout=1.0, tcp_timeout=2.0):
    """对单个服务器进行详细的STUN测试并收集10个指标"""
    print(f"\n--- 正在测试服务器: {server_host}:{server_port} ---")
    results_summary = {} # 用于存储各项指标的结果

    # 定义指标名称 (中文)
    metric_names = {
        "udp_avg_latency": "UDP STUN 平均延迟 (毫秒)",
        "udp_success_rate": "UDP STUN 成功率 (%)",
        "udp_reported_ips": "UDP STUN 报告的公网IP",
        "udp_reported_ports": "UDP STUN 报告的公网端口",
        "udp_port_preservation": "UDP STUN 端口保持性",
        "udp_response_source_consistency": "UDP 响应源IP一致性",
        "tcp_avg_latency": "TCP STUN 平均延迟 (毫秒)",
        "tcp_success_rate": "TCP STUN 成功率 (%)",
        "tcp_reported_ips": "TCP STUN 报告的公网IP", # TCP一般不直接用于NAT穿越的端口发现，但可测连通性
        "server_software": "服务器软件属性",
        "observed_error_codes": "观察到的STUN错误码"
    }

    # --- UDP 测试 ---
    udp_latencies = []
    udp_success_count = 0
    udp_public_ips = set()
    udp_public_ports = set()
    udp_port_preservation_matches = 0
    udp_software_versions = set()
    udp_response_source_consistent_flag = True # 假设一致，除非发现不一致
    udp_error_codes_collection = defaultdict(int)

    expected_response_ip = None
    try:
        # 解析一次主机名，用于检查响应源IP
        expected_response_ip = socket.gethostbyname(server_host)
    except socket.gaierror:
        expected_response_ip = server_host # 如果解析失败，则使用原始主机名（可能已经是IP）

    print("  正在执行 UDP STUN 测试...")
    for i in range(num_runs):
        # print(f"    UDP 第 {i+1}/{num_runs} 次运行...")
        res = perform_stun_test_udp(server_host, server_port, udp_timeout)
        if res["success"]:
            udp_success_count += 1
            udp_latencies.append(res["latency_ms"])
            if res["public_ip"]: udp_public_ips.add(res["public_ip"])
            if res["public_port"]: udp_public_ports.add(res["public_port"])
            if res["local_port_used"] and res["public_port"] and res["local_port_used"] == res["public_port"]:
                udp_port_preservation_matches += 1
            if res["software"]: udp_software_versions.add(res["software"])
            if res["response_from_ip"] != expected_response_ip:
                # print(f"    UDP 警告: 响应来自 {res['response_from_ip']}, 期望来自 {expected_response_ip}")
                udp_response_source_consistent_flag = False # 任何一次不一致都标记
        else:
            if res.get("error_code"):
                udp_error_codes_collection[res["error_code"]] += 1
            # print(f"    UDP 第 {i+1} 次运行失败: {res.get('error_message', '未知错误')}")
            # if res.get("raw_response_hex"): print(f"      原始UDP响应 (Hex): {res.get('raw_response_hex')}")


    results_summary[metric_names["udp_avg_latency"]] = MetricResult(sum(udp_latencies) / len(udp_latencies) if udp_latencies else float('inf'), f"{len(udp_latencies)} 次成功运行")
    results_summary[metric_names["udp_success_rate"]] = MetricResult((udp_success_count / num_runs) * 100 if num_runs > 0 else 0, f"{udp_success_count}/{num_runs} 次成功")
    results_summary[metric_names["udp_reported_ips"]] = MetricResult(", ".join(sorted(list(udp_public_ips))) if udp_public_ips else "无", "")
    results_summary[metric_names["udp_reported_ports"]] = MetricResult(", ".join(map(str, sorted(list(udp_public_ports)))) if udp_public_ports else "无", "")
    results_summary[metric_names["udp_port_preservation"]] = MetricResult(
        f"{udp_port_preservation_matches}/{udp_success_count} 次成功运行中保持了端口" if udp_success_count > 0 else "不可用 (无成功UDP测试)", ""
    )
    results_summary[metric_names["udp_response_source_consistency"]] = MetricResult("是" if udp_response_source_consistent_flag else "否" if udp_success_count > 0 else "不可用", f"期望来源 {expected_response_ip}")


    # --- TCP 测试 ---
    tcp_latencies = []
    tcp_success_count = 0
    tcp_public_ips = set() # TCP STUN 也会报告IP
    # tcp_public_ports = set() # TCP STUN 报告的端口通常与UDP不同，且更侧重连接本身
    tcp_software_versions = set()
    tcp_error_codes_collection = defaultdict(int)

    print("  正在执行 TCP STUN 测试 (尝试相同端口)...")
    for i in range(num_runs):
        # print(f"    TCP 第 {i+1}/{num_runs} 次运行...")
        res = perform_stun_test_tcp(server_host, server_port, tcp_timeout)
        if res["success"]:
            tcp_success_count += 1
            tcp_latencies.append(res["latency_ms"])
            if res["public_ip"]: tcp_public_ips.add(res["public_ip"])
            if res["software"]: tcp_software_versions.add(res["software"])
        else:
            if res.get("error_code"):
                tcp_error_codes_collection[res["error_code"]] += 1
            # print(f"    TCP 第 {i+1} 次运行失败: {res.get('error_message', '未知错误')}")
            # if res.get("raw_response_hex"): print(f"      原始TCP响应 (Hex): {res.get('raw_response_hex')}")


    results_summary[metric_names["tcp_avg_latency"]] = MetricResult(sum(tcp_latencies) / len(tcp_latencies) if tcp_latencies else float('inf'), f"{len(tcp_latencies)} 次成功运行")
    results_summary[metric_names["tcp_success_rate"]] = MetricResult((tcp_success_count / num_runs) * 100 if num_runs > 0 else 0, f"{tcp_success_count}/{num_runs} 次成功")
    results_summary[metric_names["tcp_reported_ips"]] = MetricResult(", ".join(sorted(list(tcp_public_ips))) if tcp_public_ips else "无", "TCP STUN报告的公网IP")


    # --- 综合/通用指标 ---
    all_software = udp_software_versions.union(tcp_software_versions)
    results_summary[metric_names["server_software"]] = MetricResult(", ".join(sorted(list(all_software))) if all_software else "无", "")

    combined_error_codes = defaultdict(int, udp_error_codes_collection)
    for code, count in tcp_error_codes_collection.items():
        combined_error_codes[code] += count
    error_summary_list = [f"错误码 {code}: {count} 次" for code, count in combined_error_codes.items()]
    results_summary[metric_names["observed_error_codes"]] = MetricResult("; ".join(error_summary_list) if error_summary_list else "无", "")


    # --- 打印此服务器的摘要 ---
    print(f"  --- 服务器 {server_host}:{server_port} 的测试结果 ---")
    max_key_len = 0
    if metric_names: # 动态计算指标名称的最大长度以对齐输出
        # 注意: 中文字符可能比英文字符宽，这里的长度计算可能不完美，但能大致对齐
        max_key_len = max(len(name) for name in metric_names.values()) + 2


    for metric_key_std, metric_name_cn in metric_names.items(): # 保证顺序与定义一致
        if metric_name_cn in results_summary:
            metric_val = results_summary[metric_name_cn]
            val_str = f"{metric_val.value:.2f}" if isinstance(metric_val.value, float) and metric_val.value != float('inf') else str(metric_val.value)

            # 尝试根据中文字符调整对齐，一个中文字符约等于两个英文字符宽度
            # 这只是一个粗略的估计，终端字体等因素会影响实际显示效果
            padding = max_key_len
            chinese_chars = sum(1 for char in metric_name_cn if '\u4e00' <= char <= '\u9fff')
            effective_len = len(metric_name_cn) + chinese_chars # 估计显示长度

            # print(f"    {metric_name_cn:<{padding}}: {val_str} {'('+metric_val.details+')' if metric_val.details else ''}")
            # 使用固定长度进行格式化，或者根据实际内容调整
            print(f"    {metric_name_cn.ljust(max_key_len - chinese_chars)}: {val_str} {'('+metric_val.details+')' if metric_val.details else ''}")
        else:
            # 处理 metric_names 中定义但 results_summary 中可能没有的指标（例如，如果一个测试阶段完全跳过）
            # print(f"    {metric_name_cn:<{max_key_len}}: 指标未收集") # 或其他占位符
            pass

    return results_summary


def load_stun_servers(filepath="stun_servers.txt"):
    """
    从文件加载STUN服务器列表。
    格式: host:port 或 host (默认端口3478), 每行一个。
    """
    servers = []
    try:
        with open(filepath, 'r', encoding='utf-8') as f: # 最好指定编码
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'): # 跳过空行和注释行
                    continue
                parts = line.split(':')
                if len(parts) == 2:
                    try:
                        host = parts[0]
                        port = int(parts[1])
                        servers.append((host, port))
                    except ValueError:
                        print(f"警告: 行内端口无效: {line}")
                elif len(parts) == 1 and parts[0]: # 只有主机名，尝试默认STUN端口
                     host = parts[0]
                     port = 3478 # STUN/TURN标准端口
                     servers.append((host,port))
                     print(f"信息: 为 {host} 假设使用默认STUN端口 {port}")
                else:
                    print(f"警告: 行格式无效 (应为 host:port 或 host): {line}")
    except FileNotFoundError:
        print(f"错误: STUN服务器列表文件 '{filepath}' 未找到。")
    return servers

# --- 主执行逻辑 ---
if __name__ == "__main__":
    server_list_file = "stun_servers.txt" # 确保此文件存在
    stun_servers_to_test = load_stun_servers(server_list_file)

    if not stun_servers_to_test:
        print("未加载任何STUN服务器。程序正在退出。")
        exit()

    print(f"已从 '{server_list_file}' 加载 {len(stun_servers_to_test)} 个STUN服务器。")
    print("开始详细测试 (适用情况下，每个指标运行3次取平均值)...")

    # --- 并发测试选项 (如果服务器列表很长，建议使用) ---
    # max_concurrent_servers = 5 # 同时测试的服务器数量上限
    # all_server_results_list = []
    # print(f"将使用最多 {max_concurrent_servers} 个线程并发测试服务器...")
    # with concurrent.futures.ThreadPoolExecutor(max_workers=max_concurrent_servers) as executor:
    #     future_to_server_map = {
    #         executor.submit(test_single_server_detailed, host, port, num_runs=3): (host, port)
    #         for host, port in stun_servers_to_test
    #     }
    #     for i, future_item in enumerate(concurrent.futures.as_completed(future_to_server_map)):
    #         server_id_tuple = future_to_server_map[future_item]
    #         server_display_name = f"{server_id_tuple[0]}:{server_id_tuple[1]}"
    #         print(f"\n({i+1}/{len(stun_servers_to_test)}) 完成对 {server_display_name} 的测试...")
    #         try:
    #             result_data = future_item.result()
    #             all_server_results_list.append({ "server": server_display_name, "metrics": result_data})
    #         except Exception as exc:
    #             print(f"测试服务器 {server_display_name} 时发生严重异常: {exc}")
    #             all_server_results_list.append({ "server": server_display_name, "metrics": {"错误": str(exc)}})

    # --- 顺序测试 (如果服务器数量不多，或者为了简化输出阅读) ---
    all_server_results_list = []
    for i, (host, port) in enumerate(stun_servers_to_test):
        server_display_name = f"{host}:{port}"
        print(f"\n({i+1}/{len(stun_servers_to_test)}) 开始测试服务器: {server_display_name}")
        try:
            result_data = test_single_server_detailed(host, port, num_runs=3)
            all_server_results_list.append({ "server": server_display_name, "metrics": result_data})
        except Exception as e:
            print(f"测试服务器 {server_display_name} 过程中发生严重错误: {e}")
            all_server_results_list.append({ "server": server_display_name, "metrics": {"错误": f"测试失败: {e}"}})


    print("\n\n--- 所有服务器测试摘要已完成 ---")
    # 此处可以进一步处理 `all_server_results_list`，例如进行排序、保存到文件等。
    # 当前，详细输出在每个服务器测试完成时已打印。