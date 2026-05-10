use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter, State};

// ── Types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub key_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SshOutputEvent {
    pub session_id: String,
    pub stream: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SftpFileEntry {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub modified: String,
    pub permissions: String,
}

// ── PTY sessions (shell) ──

type PtyWriter = Arc<Mutex<Box<dyn Write + Send>>>;

struct SshSession {
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
    writer: PtyWriter,
}

// ── SFTP sessions (russh) ──

struct RusshClient;

impl russh::client::Handler for RusshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

struct RusshSftpSession {
    #[allow(dead_code)]
    handle: russh::client::Handle<RusshClient>,
    sftp: russh_sftp::client::SftpSession,
}

pub struct SshState {
    sessions: Mutex<HashMap<String, SshSession>>,
    sftp_sessions: tokio::sync::Mutex<HashMap<String, RusshSftpSession>>,
}

impl SshState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            sftp_sessions: tokio::sync::Mutex::new(HashMap::new()),
        }
    }
}

// ── Helpers ──

fn app_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let dir = home.join(".dioptase");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create app data dir: {}", e))?;
    Ok(dir)
}

fn connections_file() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("ssh_connections.json"))
}

fn load_connections() -> Result<Vec<SshConnection>, String> {
    let path = connections_file()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| format!("Cannot read SSH connections: {}", e))?;
    Ok(serde_json::from_str(&content).unwrap_or_default())
}

fn save_connections(connections: &[SshConnection]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(connections)
        .map_err(|e| format!("Cannot serialize SSH connections: {}", e))?;
    fs::write(connections_file()?, content).map_err(|e| format!("Cannot write SSH connections: {}", e))?;
    Ok(())
}

fn pty_reader(
    app: AppHandle,
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    writer: PtyWriter,
    password: Option<String>,
) {
    let mut buffer = [0u8; 4096];
    let mut auth_buffer = String::new();
    let mut password_sent = false;
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => {
                let _ = app.emit(
                    "ssh-output",
                    SshOutputEvent {
                        session_id: session_id.clone(),
                        stream: "stdout".to_string(),
                        data: "\r\n[disconnected]\r\n".to_string(),
                    },
                );
                break;
            }
            Ok(n) => {
                let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                if !password_sent {
                    if let Some(password) = password.as_ref() {
                        auth_buffer.push_str(&data);
                        if auth_buffer.len() > 2048 {
                            let mut keep_from = auth_buffer.len() - 2048;
                            while !auth_buffer.is_char_boundary(keep_from) {
                                keep_from += 1;
                            }
                            auth_buffer.drain(..keep_from);
                        }

                        if auth_buffer.to_ascii_lowercase().contains("password:") {
                            if let Ok(mut writer) = writer.lock() {
                                let _ = writer.write_all(format!("{}\r", password).as_bytes());
                                let _ = writer.flush();
                            }
                            password_sent = true;
                        }
                    }
                }

                let _ = app.emit(
                    "ssh-output",
                    SshOutputEvent {
                        session_id: session_id.clone(),
                        stream: "stdout".to_string(),
                        data,
                    },
                );
            }
            Err(_) => break,
        }
    }
}

// ── Connection CRUD ──

#[tauri::command]
pub fn list_ssh_connections() -> Result<Vec<SshConnection>, String> {
    load_connections()
}

#[tauri::command]
pub fn save_ssh_connection(mut connection: SshConnection) -> Result<SshConnection, String> {
    let mut connections = load_connections()?;
    if connection.id.trim().is_empty() {
        connection.id = uuid::Uuid::new_v4().to_string();
    }
    if let Some(existing) = connections.iter_mut().find(|c| c.id == connection.id) {
        *existing = connection.clone();
    } else {
        connections.push(connection.clone());
    }
    save_connections(&connections)?;
    Ok(connection)
}

#[tauri::command]
pub fn delete_ssh_connection(id: String) -> Result<(), String> {
    let mut connections = load_connections()?;
    connections.retain(|c| c.id != id);
    save_connections(&connections)
}

// ── PTY Shell ──

#[tauri::command]
pub fn start_ssh_session(
    connection: SshConnection,
    app: AppHandle,
    state: State<'_, SshState>,
) -> Result<String, String> {
    let session_id = uuid::Uuid::new_v4().to_string();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to create PTY: {}", e))?;

    let target = format!("{}@{}", connection.username, connection.host);
    let mut cmd = CommandBuilder::new("ssh");
    cmd.arg("-tt");
    cmd.arg("-p");
    cmd.arg(connection.port.to_string());

    if !connection.key_path.trim().is_empty() {
        cmd.arg("-i");
        cmd.arg(&connection.key_path);
    }

    cmd.arg(target);
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to start ssh: {}", e))?;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to create PTY reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to create PTY writer: {}", e))?;
    let writer = Arc::new(Mutex::new(writer));
    let reader_writer = Arc::clone(&writer);
    let password = if connection.password.trim().is_empty() {
        None
    } else {
        Some(connection.password.clone())
    };

    let app_clone = app.clone();
    let sid_clone = session_id.clone();
    thread::spawn(move || {
        pty_reader(app_clone, sid_clone, reader, reader_writer, password);
    });

    state.sessions.lock().unwrap().insert(
        session_id.clone(),
        SshSession {
            master: pair.master,
            child,
            writer,
        },
    );

    Ok(session_id)
}

#[tauri::command]
pub fn write_ssh_session(
    session_id: String,
    data: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions.get_mut(&session_id).ok_or("SSH session not found")?;
    session
        .writer
        .lock()
        .map_err(|_| "SSH writer lock poisoned".to_string())?
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write ssh input: {}", e))?;
    session
        .writer
        .lock()
        .map_err(|_| "SSH writer lock poisoned".to_string())?
        .flush()
        .map_err(|e| format!("Failed to flush ssh input: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn stop_ssh_session(session_id: String, state: State<'_, SshState>) -> Result<(), String> {
    if let Some(mut session) = state.sessions.lock().unwrap().remove(&session_id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    state.sftp_sessions.lock().await.remove(&session_id);
    Ok(())
}

#[tauri::command]
pub fn resize_ssh_session(
    session_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, SshState>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&session_id).ok_or("SSH session not found")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize PTY: {}", e))?;
    Ok(())
}

// ── SFTP (russh) ──

#[tauri::command]
pub async fn sftp_start_session(
    connection: SshConnection,
    state: State<'_, SshState>,
) -> Result<String, String> {
    let session_id = uuid::Uuid::new_v4().to_string();

    let config = Arc::new(russh::client::Config::default());
    let handler = RusshClient;

    let mut handle = russh::client::connect(config, (connection.host.as_str(), connection.port), handler)
        .await
        .map_err(|e| format!("SSH connection failed: {}", e))?;

    let auth_result = if !connection.key_path.trim().is_empty() {
        let key = russh::keys::load_secret_key(&connection.key_path, None)
            .map_err(|e| format!("Failed to load key: {}", e))?;
        let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), None);
        handle
            .authenticate_publickey(&connection.username, key_with_hash)
            .await
            .map_err(|e| format!("Public key auth failed: {}", e))?
    } else if !connection.password.trim().is_empty() {
        handle
            .authenticate_password(&connection.username, &connection.password)
            .await
            .map_err(|e| format!("Password auth failed: {}", e))?
    } else {
        return Err("No authentication method provided. Please set password or key path.".to_string());
    };

    if !auth_result.success() {
        return Err("SSH authentication failed".to_string());
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("Failed to start SFTP subsystem: {}", e))?;

    let sftp = russh_sftp::client::SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

    state.sftp_sessions.lock().await.insert(
        session_id.clone(),
        RusshSftpSession { handle, sftp },
    );

    Ok(session_id)
}

#[tauri::command]
pub async fn sftp_list_dir(
    session_id: String,
    path: String,
    state: State<'_, SshState>,
) -> Result<Vec<SftpFileEntry>, String> {
    let mut sessions = state.sftp_sessions.lock().await;
    let session = sessions.get_mut(&session_id).ok_or("SFTP session not found")?;

    let read_dir = session
        .sftp
        .read_dir(&path)
        .await
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut files: Vec<SftpFileEntry> = read_dir
        .map(|entry| {
            let meta = entry.metadata();
            let is_dir = meta.is_dir();
            let size = if is_dir { 0 } else { meta.len() };
            let modified = meta.mtime.map_or_else(
                || "".to_string(),
                |t| {
                    chrono::DateTime::from_timestamp(t as i64, 0)
                        .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                        .unwrap_or_default()
                },
            );
            let permissions = meta.permissions().to_string();

            SftpFileEntry {
                name: entry.file_name(),
                size,
                is_dir,
                modified,
                permissions,
            }
        })
        .collect();

    files.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    Ok(files)
}

#[tauri::command]
pub async fn sftp_mkdir(
    session_id: String,
    path: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    let mut sessions = state.sftp_sessions.lock().await;
    let session = sessions.get_mut(&session_id).ok_or("SFTP session not found")?;
    session
        .sftp
        .create_dir(&path)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_remove(
    session_id: String,
    path: String,
    is_dir: bool,
    state: State<'_, SshState>,
) -> Result<(), String> {
    let mut sessions = state.sftp_sessions.lock().await;
    let session = sessions.get_mut(&session_id).ok_or("SFTP session not found")?;
    if is_dir {
        session
            .sftp
            .remove_dir(&path)
            .await
            .map_err(|e| format!("Failed to remove directory: {}", e))?;
    } else {
        session
            .sftp
            .remove_file(&path)
            .await
            .map_err(|e| format!("Failed to remove file: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn stop_sftp_session(session_id: String, state: State<'_, SshState>) -> Result<(), String> {
    state.sftp_sessions.lock().await.remove(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn sftp_upload(
    session_id: String,
    local_path: String,
    remote_path: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    let data = fs::read(&local_path).map_err(|e| format!("Failed to read local file: {}", e))?;
    let mut sessions = state.sftp_sessions.lock().await;
    let session = sessions.get_mut(&session_id).ok_or("SFTP session not found")?;
    let mut file = session
        .sftp
        .create(&remote_path)
        .await
        .map_err(|e| format!("Failed to create remote file: {}", e))?;
    use tokio::io::AsyncWriteExt;
    file.write_all(&data)
        .await
        .map_err(|e| format!("Failed to write data: {}", e))?;
    file.shutdown()
        .await
        .map_err(|e| format!("Failed to close file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_create_file(
    session_id: String,
    path: String,
    state: State<'_, SshState>,
) -> Result<(), String> {
    let mut sessions = state.sftp_sessions.lock().await;
    let session = sessions.get_mut(&session_id).ok_or("SFTP session not found")?;
    let mut file = session
        .sftp
        .create(&path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;
    use tokio::io::AsyncWriteExt;
    file.shutdown()
        .await
        .map_err(|e| format!("Failed to close file: {}", e))?;
    Ok(())
}
