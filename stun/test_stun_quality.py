import socket
import struct
import time
import random
import concurrent.futures
from collections import namedtuple

# 定义STUN消息类型和属性
STUN_MESSAGE_TYPE_BINDING_REQUEST = 0x0001
STUN_MESSAGE_TYPE_BINDING_SUCCESS_RESPONSE = 0x0101
STUN_MAGIC_COOKIE = 0x2112A442

STUN_ATTRIBUTE_XOR_MAPPED_ADDRESS = 0x0020

# STUN报文头部长度
STUN_HEADER_LENGTH = 20

# 定义结果元组
StunResult = namedtuple('StunResult', ['server', 'port', 'latency', 'public_ip', 'public_port', 'error'])

def create_binding_request():
    """
    创建一个STUN绑定请求报文。
    参考 RFC 5389
    """
    message_type = STUN_MESSAGE_TYPE_BINDING_REQUEST
    message_length = 0  # 绑定请求没有STUN属性，所以长度为0
    magic_cookie = STUN_MAGIC_COOKIE
    # 事务ID (Transaction ID): 12字节的随机数
    transaction_id = random.getrandbits(96).to_bytes(12, 'big')

    # STUN header: type (2 bytes), length (2 bytes), magic cookie (4 bytes), transaction ID (12 bytes)
    header = struct.pack('!HHII', message_type, message_length, magic_cookie,
                         int.from_bytes(transaction_id[0:4], 'big')) + \
             struct.pack('!II', int.from_bytes(transaction_id[4:8], 'big'),
                         int.from_bytes(transaction_id[8:12], 'big'))

    return header, transaction_id

def parse_binding_response(data, expected_transaction_id):
    """
    解析STUN绑定响应报文。
    返回 (public_ip, public_port) 或 None
    """
    if len(data) < STUN_HEADER_LENGTH:
        return None, None, "Response too short"

    # 解析STUN header
    msg_type, msg_len, magic_cookie = struct.unpack('!HHI', data[0:8])
    transaction_id_received = data[8:20]

    if magic_cookie != STUN_MAGIC_COOKIE:
        return None, None, "Invalid STUN Magic Cookie"
    if msg_type != STUN_MESSAGE_TYPE_BINDING_SUCCESS_RESPONSE:
        # 可能是错误响应或非绑定响应
        return None, None, f"Not a success binding response (type: {hex(msg_type)})"
    if transaction_id_received != expected_transaction_id:
        return None, None, "Transaction ID mismatch"

    # 解析属性
    offset = STUN_HEADER_LENGTH
    while offset < len(data):
        if (offset + 4) > len(data): # 确保有足够的空间读取属性类型和长度
            break
        attr_type, attr_len = struct.unpack('!HH', data[offset:offset+4])
        attr_value_start = offset + 4
        attr_value_end = attr_value_start + attr_len

        if attr_value_end > len(data): # 属性值超出报文长度
            break

        if attr_type == STUN_ATTRIBUTE_XOR_MAPPED_ADDRESS:
            # XOR-MAPPED-ADDRESS 格式: 1 byte reserved, 1 byte family, 2 bytes port, 4 or 16 bytes address
            # family (1 byte), port (2 bytes), address (4 bytes for IPv4, 16 for IPv6)
            # Port XORed with (MAGIC_COOKIE >> 16)
            # IP XORed with MAGIC_COOKIE for IPv4, (MAGIC_COOKIE + Transaction ID) for IPv6

            family, xor_port = struct.unpack('!BH', data[attr_value_start+1:attr_value_start+4]) # family is at offset 1, port at 2
            xor_address_bytes = data[attr_value_start+4:attr_value_end]

            actual_port = xor_port ^ (STUN_MAGIC_COOKIE >> 16)

            if family == 0x01: # IPv4
                xor_ip = struct.unpack('!I', xor_address_bytes)[0]
                actual_ip = xor_ip ^ STUN_MAGIC_COOKIE
                public_ip = socket.inet_ntoa(struct.pack('!I', actual_ip))
            elif family == 0x02: # IPv6
                # IPv6 XORing is more complex: IP XORed with (MAGIC_COOKIE + Transaction ID)
                # But for our simple test, we only need to know it received a response.
                public_ip = "IPv6 (Parse not implemented)" # Simplified for this script
            else:
                return None, None, "Unsupported IP Family" # Unknown family

            return public_ip, actual_port, None

        # 移动到下一个属性，确保按4字节对齐
        offset += 4 + attr_len
        # STUN属性必须是32位对齐的，如果属性长度不是4的倍数，需要填充
        if attr_len % 4 != 0:
            offset += (4 - (attr_len % 4))

    return None, None, "XOR-MAPPED-ADDRESS attribute not found"

def test_stun_server(server_host, server_port, timeout=1.0, retries=2):
    """
    测试单个STUN服务器。
    返回 (latency, public_ip, public_port, error_message)
    """
    total_latency = 0
    public_ip = None
    public_port = None
    last_error = "No response"

    for attempt in range(retries):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(timeout)

            request_packet, transaction_id = create_binding_request()

            start_time = time.monotonic()
            sock.sendto(request_packet, (server_host, server_port))

            response_data, _ = sock.recvfrom(2048) # STUN max message size is typically less than 1500 bytes (MTU)
            end_time = time.monotonic()

            latency = (end_time - start_time) * 1000 # 毫秒

            p_ip, p_port, error = parse_binding_response(response_data, transaction_id)

            sock.close()

            if error:
                last_error = f"Parse Error: {error}"
            else:
                total_latency += latency
                public_ip = p_ip
                public_port = p_port
                return StunResult(server_host, server_port, latency, public_ip, public_port, None)

        except socket.timeout:
            last_error = "Timeout"
        except socket.gaierror:
            last_error = f"Hostname resolution failed: {server_host}"
            break # No need to retry if hostname cannot be resolved
        except Exception as e:
            last_error = f"Socket Error: {e}"
        finally:
            if 'sock' in locals() and sock.fileno() != -1: # Ensure socket is closed if it was opened
                sock.close()

    return StunResult(server_host, server_port, float('inf'), None, None, last_error) # Use infinity for failed tests

def load_stun_servers(filepath="stun_servers.txt"):
    """
    从文件中加载STUN服务器列表。
    格式: host:port, 每行一个。
    """
    servers = []
    try:
        with open(filepath, 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                parts = line.split(':')
                if len(parts) == 2:
                    try:
                        host = parts[0]
                        port = int(parts[1])
                        servers.append((host, port))
                    except ValueError:
                        print(f"Warning: Invalid port in line: {line}")
                else:
                    print(f"Warning: Invalid format in line (expected host:port): {line}")
    except FileNotFoundError:
        print(f"Error: STUN server list file '{filepath}' not found.")
    return servers

def run_tests(servers, max_workers=10, num_runs_per_server=3):
    """
    使用线程池并发测试所有STUN服务器。
    """
    results = {} # { (host, port): [latency1, latency2, ...], 'public_ip': .., 'public_port': .. }

    servers_to_test = []
    for host, port in servers:
        for _ in range(num_runs_per_server):
            servers_to_test.append((host, port))

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_server = {executor.submit(test_stun_server, s[0], s[1]): s for s in servers_to_test}

        for future in concurrent.futures.as_completed(future_to_server):
            server_info = future_to_server[future]
            host, port = server_info
            try:
                result = future.result()
                if (host, port) not in results:
                    results[(host, port)] = {'latencies': [], 'public_ip': None, 'public_port': None, 'errors': []}

                if result.error:
                    results[(host, port)]['errors'].append(result.error)
                else:
                    results[(host, port)]['latencies'].append(result.latency)
                    # 只记录一次公共IP和端口，假定它们在多次测试中是稳定的
                    if not results[(host, port)]['public_ip']:
                        results[(host, port)]['public_ip'] = result.public_ip
                        results[(host, port)]['public_port'] = result.public_port

                print(f"Tested {host}:{port} - Latency: {result.latency:.2f}ms, Error: {result.error if result.error else 'None'}")

            except Exception as exc:
                print(f"{server_info[0]}:{server_info[1]} generated an exception: {exc}")
                if (host, port) not in results:
                    results[(host, port)] = {'latencies': [], 'public_ip': None, 'public_port': None, 'errors': []}
                results[(host, port)]['errors'].append(str(exc))

    return results

if __name__ == "__main__":
    server_list_file = "stun_servers.txt"
    stun_servers = load_stun_servers(server_list_file)

    if not stun_servers:
        print("No STUN servers found. Please check 'stun_servers.txt'.")
        exit()

    print(f"Loaded {len(stun_servers)} STUN servers from {server_list_file}. Starting tests...")

    # 每个服务器运行3次，取平均值，以减少网络波动的影响
    test_results = run_tests(stun_servers, num_runs_per_server=3)

    final_results = []
    for (host, port), data in test_results.items():
        if data['latencies']:
            avg_latency = sum(data['latencies']) / len(data['latencies'])
            success_rate = len(data['latencies']) / 3.0 # Assuming num_runs_per_server = 3
            final_results.append({
                'server': host,
                'port': port,
                'avg_latency': avg_latency,
                'success_rate': success_rate,
                'public_ip': data['public_ip'],
                'public_port': data['public_port'],
                'errors': data['errors']
            })
        else:
            # 如果没有成功响应，则将其视为无限大延迟，以便排序时排在最后
            final_results.append({
                'server': host,
                'port': port,
                'avg_latency': float('inf'),
                'success_rate': 0,
                'public_ip': None,
                'public_port': None,
                'errors': data['errors']
            })

    # 根据平均延迟排序，成功率高的优先，然后延迟低的优先
    final_results.sort(key=lambda x: (-x['success_rate'], x['avg_latency']))

    print("\n--- Top 10 Best STUN Servers ---")
    count = 0
    for i, res in enumerate(final_results):
        if res['avg_latency'] == float('inf'):
            # 过滤掉完全失败的服务器
            continue

        print(f"{count + 1}. {res['server']}:{res['port']}")
        print(f"   Avg Latency: {res['avg_latency']:.2f} ms")
        print(f"   Success Rate: {res['success_rate'] * 100:.2f}%")
        if res['public_ip'] and res['public_port']:
            print(f"   Public IP: {res['public_ip']}:{res['public_port']}")
        if res['errors']:
            print(f"   Errors: {', '.join(set(res['errors']))}") # Use set to show unique errors
        print("-" * 20)
        count += 1
        if count >= 10:
            break

    if count == 0 and final_results:
        print("\nNo successful STUN server tests found in the top results.")
    elif count < 10 and final_results:
        print(f"\n--- Remaining STUN Servers ({len(final_results) - count} total successful servers) ---")
        for i, res in enumerate(final_results[count:]):
            if res['avg_latency'] == float('inf'):
                print(f"   {res['server']}:{res['port']} - Failed (Errors: {', '.join(set(res['errors'])) if res['errors'] else 'None'})")
            else:
                print(f"   {res['server']}:{res['port']} - Avg Latency: {res['avg_latency']:.2f} ms, Success Rate: {res['success_rate'] * 100:.2f}%")