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

    # Retries are handled by num_runs_per_server in run_tests.
    # This function now performs a single attempt.
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(timeout)

        request_packet, transaction_id = create_binding_request()

        start_time = time.monotonic()
        sock.sendto(request_packet, (server_host, server_port))

        response_data, _ = sock.recvfrom(2048)
        end_time = time.monotonic()

        latency = (end_time - start_time) * 1000 # 毫秒

        p_ip, p_port, error = parse_binding_response(response_data, transaction_id)

        sock.close()

        if error:
            last_error = f"Parse Error: {error}"
            return StunResult(server_host, server_port, float('inf'), None, None, last_error)
        else:
            return StunResult(server_host, server_port, latency, p_ip, p_port, None)

    except socket.timeout:
        last_error = "Timeout"
    except socket.gaierror:
        last_error = f"Hostname resolution failed: {server_host}"
    except Exception as e:
        last_error = f"Socket Error: {e}"
    finally:
        if 'sock' in locals() and hasattr(sock, 'fileno') and sock.fileno() != -1:
            sock.close()

    return StunResult(server_host, server_port, float('inf'), None, None, last_error)

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

def run_tests(servers, max_workers=20, num_runs_per_server=3, timeout_per_run=1.0):
    """
    使用线程池并发测试所有STUN服务器。
    """
    results = {} # { (host, port): {'latencies': [], 'public_ip': .., 'public_port': .., 'errors': []} }

    servers_to_test_tasks = []
    for host, port in servers:
        for _ in range(num_runs_per_server):
            servers_to_test_tasks.append((host, port))

    print(f"Starting {len(servers_to_test_tasks)} test runs ({len(servers)} servers x {num_runs_per_server} runs each)...")

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_server_run = {
            executor.submit(test_stun_server, s[0], s[1], timeout=timeout_per_run): s
            for s in servers_to_test_tasks
        }

        completed_count = 0
        total_tasks = len(future_to_server_run)

        for future in concurrent.futures.as_completed(future_to_server_run):
            server_info = future_to_server_run[future]
            host, port = server_info
            completed_count += 1
            try:
                result = future.result()
                if (host, port) not in results:
                    results[(host, port)] = {'latencies': [], 'public_ip': None, 'public_port': None, 'errors': []}

                if result.error:
                    results[(host, port)]['errors'].append(result.error)
                    # print(f"[{completed_count}/{total_tasks}] Test fail {host}:{port} - Error: {result.error}")
                else:
                    results[(host, port)]['latencies'].append(result.latency)
                    if not results[(host, port)]['public_ip'] and result.public_ip:
                        results[(host, port)]['public_ip'] = result.public_ip
                        results[(host, port)]['public_port'] = result.public_port
                    # print(f"[{completed_count}/{total_tasks}] Test OK   {host}:{port} - Latency: {result.latency:.2f}ms")


                # Simple progress indicator
                if completed_count % (max(1, total_tasks // 20)) == 0 or completed_count == total_tasks : # Print progress roughly 20 times or on completion
                    print(f"Progress: {completed_count}/{total_tasks} runs completed ({ (completed_count/total_tasks)*100 :.1f}%)")


            except Exception as exc:
                print(f"Exception during test for {host}:{port}: {exc}")
                if (host, port) not in results:
                    results[(host, port)] = {'latencies': [], 'public_ip': None, 'public_port': None, 'errors': []}
                results[(host, port)]['errors'].append(str(exc))
    print("All test runs completed.")
    return results

if __name__ == "__main__":
    server_list_file = "stun_servers.txt" # Make sure this file exists and is populated
    num_top_servers_to_show = 40 # Changed from 10 to 40
    runs_per_server = 3 # Number of times to test each server for averaging
    worker_threads = 25 # Number of concurrent test threads
    single_run_timeout = 1.0 # Timeout for each individual STUN request in seconds

    stun_servers_to_check = load_stun_servers(server_list_file)

    if not stun_servers_to_check:
        print(f"No STUN servers loaded from '{server_list_file}'. Please check the file.")
        exit()

    print(f"Loaded {len(stun_servers_to_check)} STUN servers from {server_list_file}.")

    test_results_raw = run_tests(stun_servers_to_check,
                                 max_workers=worker_threads,
                                 num_runs_per_server=runs_per_server,
                                 timeout_per_run=single_run_timeout)

    final_processed_results = []
    for (host, port), data in test_results_raw.items():
        if data['latencies']:
            avg_latency = sum(data['latencies']) / len(data['latencies'])
            # Success rate is based on num_runs_per_server
            success_rate = len(data['latencies']) / float(runs_per_server)
            final_processed_results.append({
                'server': host,
                'port': port,
                'avg_latency': avg_latency,
                'success_rate': success_rate,
                'public_ip': data['public_ip'],
                'public_port': data['public_port'],
                'successful_runs': len(data['latencies']),
                'total_runs': runs_per_server,
                'errors': list(set(data['errors'])) # Unique errors
            })
        else:
            final_processed_results.append({
                'server': host,
                'port': port,
                'avg_latency': float('inf'),
                'success_rate': 0.0,
                'public_ip': None,
                'public_port': None,
                'successful_runs': 0,
                'total_runs': runs_per_server,
                'errors': list(set(data['errors'])) # Unique errors
            })

    # Sort: 1. Success rate (desc), 2. Avg latency (asc)
    final_processed_results.sort(key=lambda x: (-x['success_rate'], x['avg_latency']))

    print(f"\n--- Top {num_top_servers_to_show} Best STUN Servers (Detailed Results) ---")
    successful_servers_for_file = []
    displayed_count = 0
    for i, res in enumerate(final_processed_results):
        if res['avg_latency'] == float('inf') and displayed_count >= num_top_servers_to_show :
            # If we've already shown enough good servers, don't show more failed ones
            # unless we haven't even found num_top_servers_to_show successful ones.
            pass # We'll list all failed ones later if needed.

        if displayed_count < num_top_servers_to_show :
            print(f"{displayed_count + 1}. {res['server']}:{res['port']}")
            if res['avg_latency'] != float('inf'):
                print(f"   Avg Latency: {res['avg_latency']:.2f} ms")
                print(f"   Success: {res['successful_runs']}/{res['total_runs']} ({res['success_rate'] * 100:.2f}%)")
                if res['public_ip'] and res['public_port']:
                    print(f"   Public IP: {res['public_ip']}:{res['public_port']}")
                if res['errors']: # Show errors even for partially successful ones
                     print(f"   Reported Errors: {', '.join(res['errors'])}")
                successful_servers_for_file.append(f"{res['server']}:{res['port']}")
            else:
                print(f"   FAILED - Success: {res['successful_runs']}/{res['total_runs']} (0%)")
                if res['errors']:
                    print(f"   Errors: {', '.join(res['errors'])}")
            print("-" * 20)
            displayed_count += 1
        elif res['avg_latency'] != float('inf') : # if we already showed 40, but there are more successful ones
            successful_servers_for_file.append(f"{res['server']}:{res['port']}")


    if displayed_count == 0:
        print("\nNo STUN servers responded successfully.")
    elif displayed_count < num_top_servers_to_show and displayed_count < len(final_processed_results):
        print(f"\n--- Remaining Tested STUN Servers ({len(final_processed_results) - displayed_count} total) ---")
        for res in final_processed_results[displayed_count:]:
            if res['avg_latency'] == float('inf'):
                print(f"   {res['server']}:{res['port']} - FAILED (Errors: {', '.join(res['errors']) if res['errors'] else 'N/A'})")
            else: # Should not happen if sorting is correct and num_top_servers_to_show is reasonable
                print(f"   {res['server']}:{res['port']} - Avg Latency: {res['avg_latency']:.2f} ms, Success: {res['successful_runs']}/{res['total_runs']}")


    # --- Output for file replacement ---
    print(f"\n\n{'='*60}")
    print(f"--- Content to replace '{server_list_file}' (Top {min(num_top_servers_to_show, len(successful_servers_for_file))} performing servers) ---")
    print(f"{'='*60}")
    if successful_servers_for_file:
        # Take up to num_top_servers_to_show from the successful_servers_for_file list
        for i, server_line in enumerate(successful_servers_for_file):
            if i < num_top_servers_to_show:
                 print(server_line)
            else:
                break # stop after num_top_servers_to_show
        if len(successful_servers_for_file) < num_top_servers_to_show:
            print(f"\n# Note: Only {len(successful_servers_for_file)} servers were successful enough to be listed.")
        elif len(successful_servers_for_file) > num_top_servers_to_show:
             print(f"\n# Note: Showing top {num_top_servers_to_show} out of {len(successful_servers_for_file)} successful servers.")
    else:
        print(f"# No STUN servers responded successfully. Your '{server_list_file}' would be empty.")
    print(f"{'='*60}")
    print(f"--- End of content for '{server_list_file}' ---")