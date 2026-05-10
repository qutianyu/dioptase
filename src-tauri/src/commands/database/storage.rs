use std::fs;
use std::path::PathBuf;
use crate::commands::database::types::SavedConnection;

pub fn get_app_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let dir = home.join(".dioptase");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create app data dir: {}", e))?;
    Ok(dir)
}

pub fn get_connections_file_path() -> Result<PathBuf, String> {
    let dir = get_app_data_dir()?;
    Ok(dir.join("db_connections.json"))
}

pub fn load_connections() -> Result<Vec<SavedConnection>, String> {
    let path = get_connections_file_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("Cannot read connections: {}", e))?;
    let connections: Vec<SavedConnection> =
        serde_json::from_str(&content).unwrap_or_default();
    Ok(connections)
}

pub fn save_connections(connections: &[SavedConnection]) -> Result<(), String> {
    let path = get_connections_file_path()?;
    let content = serde_json::to_string_pretty(connections)
        .map_err(|e| format!("Cannot serialize connections: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Cannot write connections: {}", e))?;
    Ok(())
}