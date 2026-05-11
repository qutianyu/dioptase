use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use sysinfo::{Disks, Networks, System};

#[derive(Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_usage: f32,
    pub memory: u64,
    pub memory_percent: f32,
    pub disk_read_rate: u64,
    pub disk_write_rate: u64,
    pub run_time: u64,
    pub status: String,
    pub energy_impact: f32,
}

#[derive(Serialize)]
pub struct NetworkInterfaceInfo {
    pub name: String,
    pub received_rate: u64,
    pub transmitted_rate: u64,
    pub total_received: u64,
    pub total_transmitted: u64,
}

#[derive(Serialize)]
pub struct SystemStats {
    pub cpu_usage: f32,
    pub memory_total: u64,
    pub memory_used: u64,
    pub memory_percent: f32,
    pub cpu_name: String,
    pub cpu_cores: usize,
    pub uptime: u64,
    pub disk_total: u64,
    pub disk_available: u64,
    pub disk_used: u64,
    pub disk_percent: f32,
    pub disk_count: usize,
    pub disk_read_rate: f64,
    pub disk_write_rate: f64,
    pub process_count: usize,
    pub thread_count: usize,
    pub network_received_rate: u64,
    pub network_transmitted_rate: u64,
    pub network_total_received: u64,
    pub network_total_transmitted: u64,
    pub energy_impact: f32,
    pub processes: Vec<ProcessInfo>,
    pub network_interfaces: Vec<NetworkInterfaceInfo>,
}

#[derive(Default)]
struct DiskIoSnapshot {
    read_bytes: u64,
    write_bytes: u64,
    timestamp: Option<Instant>,
}

static DISK_IO_SNAPSHOT: OnceLock<Mutex<DiskIoSnapshot>> = OnceLock::new();
static SYSTEM_SNAPSHOT: OnceLock<Mutex<System>> = OnceLock::new();
static NETWORK_SNAPSHOT: OnceLock<Mutex<Networks>> = OnceLock::new();

fn extract_all_ioreg_values(text: &str, key: &str) -> Vec<u64> {
    let mut values = Vec::new();
    let mut search_start = 0;
    let key_len = key.len();

    while let Some(pos) = text[search_start..].find(key) {
        let abs_pos = search_start + pos;
        let after_key = &text[abs_pos + key_len..];

        if let Some(digit_pos) = after_key.find(|c: char| c.is_numeric()) {
            let num_start = &after_key[digit_pos..];
            let num_str: String = num_start.chars().take_while(|c| c.is_numeric()).collect();
            if let Ok(val) = num_str.parse::<u64>() {
                values.push(val);
            }
        }

        search_start = abs_pos + key_len;
    }

    values
}

fn get_macos_block_io_bytes() -> Option<(u64, u64)> {
    let output = std::process::Command::new("ioreg")
        .args(["-c", "IOBlockStorageDriver", "-w", "0"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let reads = extract_all_ioreg_values(&text, "Bytes (Read)");
    let writes = extract_all_ioreg_values(&text, "Bytes (Write)");

    let total_read: u64 = reads.iter().sum();
    let total_write: u64 = writes.iter().sum();

    if total_read > 0 || total_write > 0 {
        Some((total_read, total_write))
    } else {
        None
    }
}

fn get_disk_io_rate() -> (f64, f64) {
    let snapshot = DISK_IO_SNAPSHOT.get_or_init(|| Mutex::new(DiskIoSnapshot::default()));
    let mut snap = snapshot.lock().unwrap();

    let (total_read, total_write) = get_macos_block_io_bytes().unwrap_or((0, 0));

    let now = Instant::now();
    let (read_rate, write_rate) = if let Some(last) = snap.timestamp {
        let elapsed = now.duration_since(last).as_secs_f64();
        if elapsed > 0.0 && total_read >= snap.read_bytes && total_write >= snap.write_bytes {
            let read_diff = total_read.saturating_sub(snap.read_bytes);
            let write_diff = total_write.saturating_sub(snap.write_bytes);
            ((read_diff as f64) / elapsed, (write_diff as f64) / elapsed)
        } else {
            (0.0, 0.0)
        }
    } else {
        (0.0, 0.0)
    };

    snap.read_bytes = total_read;
    snap.write_bytes = total_write;
    snap.timestamp = Some(now);

    (read_rate, write_rate)
}

fn get_thread_count() -> usize {
    // Use sysctl kern.num_threads (the standard macOS API for total system threads)
    std::process::Command::new("sysctl")
        .args(["-n", "kern.num_threads"])
        .output()
        .ok()
        .and_then(|output| {
            let s = String::from_utf8_lossy(&output.stdout);
            s.trim().parse::<usize>().ok()
        })
        .unwrap_or(0)
}

fn energy_score(cpu_percent: f32, memory_percent: f32, disk_rate: f64, network_rate: f64) -> f32 {
    let disk_mb = disk_rate / (1024.0 * 1024.0);
    let network_mb = network_rate / (1024.0 * 1024.0);
    let score = cpu_percent * 0.7
        + memory_percent * 0.12
        + (disk_mb.min(200.0) as f32) * 0.1
        + (network_mb.min(200.0) as f32) * 0.08;
    score.clamp(0.0, 100.0)
}

fn get_network_stats() -> (u64, u64, u64, u64, Vec<NetworkInterfaceInfo>) {
    let networks_snapshot = NETWORK_SNAPSHOT.get_or_init(|| Mutex::new(Networks::new_with_refreshed_list()));
    let mut networks = networks_snapshot.lock().unwrap();
    networks.refresh(true);

    let mut interfaces: Vec<NetworkInterfaceInfo> = networks
        .iter()
        .map(|(name, data)| NetworkInterfaceInfo {
            name: name.clone(),
            received_rate: data.received(),
            transmitted_rate: data.transmitted(),
            total_received: data.total_received(),
            total_transmitted: data.total_transmitted(),
        })
        .collect();

    interfaces.sort_by(|a, b| {
        let a_total = a.received_rate.saturating_add(a.transmitted_rate);
        let b_total = b.received_rate.saturating_add(b.transmitted_rate);
        b_total.cmp(&a_total)
    });

    let received_rate = interfaces.iter().map(|item| item.received_rate).sum();
    let transmitted_rate = interfaces.iter().map(|item| item.transmitted_rate).sum();
    let total_received = interfaces.iter().map(|item| item.total_received).sum();
    let total_transmitted = interfaces.iter().map(|item| item.total_transmitted).sum();

    interfaces.truncate(6);

    (
        received_rate,
        transmitted_rate,
        total_received,
        total_transmitted,
        interfaces,
    )
}

fn get_processes(sys: &System, memory_total: u64) -> Vec<ProcessInfo> {
    let mut processes: Vec<ProcessInfo> = sys
        .processes()
        .values()
        .map(|process| {
            let disk_usage = process.disk_usage();
            let memory = process.memory();
            let memory_percent = if memory_total > 0 {
                (memory as f32 / memory_total as f32) * 100.0
            } else {
                0.0
            };
            let disk_rate = disk_usage
                .read_bytes
                .saturating_add(disk_usage.written_bytes) as f64;
            let impact = energy_score(process.cpu_usage(), memory_percent, disk_rate, 0.0);

            ProcessInfo {
                pid: process.pid().as_u32(),
                name: process.name().to_string_lossy().into_owned(),
                cpu_usage: process.cpu_usage(),
                memory,
                memory_percent,
                disk_read_rate: disk_usage.read_bytes,
                disk_write_rate: disk_usage.written_bytes,
                run_time: process.run_time(),
                status: process.status().to_string(),
                energy_impact: impact,
            }
        })
        .collect();

    processes.sort_by(|a, b| {
        b.cpu_usage
            .partial_cmp(&a.cpu_usage)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.memory.cmp(&a.memory))
    });
    processes.truncate(12);
    processes
}

#[tauri::command]
pub fn get_system_stats() -> SystemStats {
    let sys_snapshot = SYSTEM_SNAPSHOT.get_or_init(|| Mutex::new(System::new_all()));
    let mut sys = sys_snapshot.lock().unwrap();
    sys.refresh_all();

    let cpu_usage = sys.global_cpu_usage();
    let memory_total = sys.total_memory();
    let memory_used = sys.used_memory();
    let memory_percent = if memory_total > 0 {
        (memory_used as f32 / memory_total as f32) * 100.0
    } else {
        0.0
    };

    let cpu_name = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let cpu_cores = System::physical_core_count().unwrap_or(0);
    let uptime = System::uptime();
    let disks = Disks::new_with_refreshed_list();
    let disk_total: u64 = disks.iter().map(|disk| disk.total_space()).sum();
    let disk_available: u64 = disks.iter().map(|disk| disk.available_space()).sum();
    let disk_used = disk_total.saturating_sub(disk_available);
    let disk_percent = if disk_total > 0 {
        (disk_used as f32 / disk_total as f32) * 100.0
    } else {
        0.0
    };
    let disk_count = disks.len();
    let (disk_read_rate, disk_write_rate) = get_disk_io_rate();
    let process_count = sys.processes().len();
    let thread_count = get_thread_count();
    let (
        network_received_rate,
        network_transmitted_rate,
        network_total_received,
        network_total_transmitted,
        network_interfaces,
    ) = get_network_stats();
    let energy_impact = energy_score(
        cpu_usage,
        memory_percent,
        disk_read_rate + disk_write_rate,
        (network_received_rate + network_transmitted_rate) as f64,
    );
    let processes = get_processes(&sys, memory_total);

    SystemStats {
        cpu_usage,
        memory_total,
        memory_used,
        memory_percent,
        cpu_name,
        cpu_cores,
        uptime,
        disk_total,
        disk_available,
        disk_used,
        disk_percent,
        disk_count,
        disk_read_rate,
        disk_write_rate,
        process_count,
        thread_count,
        network_received_rate,
        network_transmitted_rate,
        network_total_received,
        network_total_transmitted,
        energy_impact,
        processes,
        network_interfaces,
    }
}
