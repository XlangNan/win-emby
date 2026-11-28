// DLNA 设备搜索（SSDP）：向 239.255.255.250:1900 发 M-SEARCH，把收到的原始回应交给前端解析。
// 每个本机 IPv4 网卡各发一次（多网卡 / 虚拟网卡 / VPN 时，只走默认网卡常常搜不到设备）。
// 安卓的搜索在 Kotlin 里（需要 MulticastLock），这里的安卓版只是占位。

#[cfg(not(target_os = "android"))]
mod imp {
    use std::net::{IpAddr, Ipv4Addr, SocketAddrV4, UdpSocket};
    use std::time::{Duration, Instant};

    const QUERIES: [&str; 2] = [
        "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:service:AVTransport:1\r\n\r\n",
        "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n",
    ];

    fn one(ip: Ipv4Addr, ms: u64) -> Vec<String> {
        let sock = match UdpSocket::bind(SocketAddrV4::new(ip, 0)) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let _ = sock.set_multicast_ttl_v4(4);
        let _ = sock.set_read_timeout(Some(Duration::from_millis(250)));
        let dst = SocketAddrV4::new(Ipv4Addr::new(239, 255, 255, 250), 1900);
        // UDP 可能丢包：整套查询发两遍
        for round in 0..2 {
            for q in QUERIES.iter() {
                let _ = sock.send_to(q.as_bytes(), dst);
            }
            if round == 0 {
                std::thread::sleep(Duration::from_millis(120));
            }
        }
        let end = Instant::now() + Duration::from_millis(ms);
        let mut buf = [0u8; 2048];
        let mut out = Vec::new();
        while Instant::now() < end {
            if let Ok((n, _)) = sock.recv_from(&mut buf) {
                out.push(String::from_utf8_lossy(&buf[..n]).into_owned());
            }
        }
        out
    }

    pub fn search(ms: u64) -> Vec<String> {
        let mut ips: Vec<Ipv4Addr> = Vec::new();
        if let Ok(list) = if_addrs::get_if_addrs() {
            for i in list {
                if i.is_loopback() {
                    continue;
                }
                if let IpAddr::V4(v4) = i.ip() {
                    if v4.is_link_local() {
                        continue;
                    }
                    ips.push(v4);
                }
            }
        }
        if ips.is_empty() {
            ips.push(Ipv4Addr::UNSPECIFIED);
        }
        let handles: Vec<_> = ips.into_iter().map(|ip| std::thread::spawn(move || one(ip, ms))).collect();
        let mut out = Vec::new();
        for h in handles {
            if let Ok(mut v) = h.join() {
                out.append(&mut v);
            }
        }
        out
    }
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn ssdp_search(timeout_ms: u64) -> Result<Vec<String>, String> {
    let ms = timeout_ms.clamp(500, 8000);
    tauri::async_runtime::spawn_blocking(move || imp::search(ms))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn ssdp_search(_timeout_ms: u64) -> Result<Vec<String>, String> {
    Err("安卓端的搜索由原生桥完成".to_string())
}
