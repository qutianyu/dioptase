use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardItem {
    pub id: String,
    pub content: String,
    pub content_type: String,
    pub timestamp: u64,
    #[serde(default)]
    pub pinned: bool,
}

pub struct ClipboardState {
    pub items: Mutex<Vec<ClipboardItem>>,
    pub watching: Mutex<bool>,
    pub max_unpinned_items: Mutex<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ClipboardStore {
    #[serde(default)]
    items: Vec<ClipboardItem>,
    #[serde(default = "default_max_unpinned_items")]
    max_unpinned_items: usize,
}

impl Default for ClipboardStore {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            max_unpinned_items: default_max_unpinned_items(),
        }
    }
}

impl ClipboardState {
    pub fn new() -> Self {
        let mut store = load_clipboard_store().unwrap_or_default();
        let max_unpinned_items = store.max_unpinned_items.clamp(1, 500);
        trim_unpinned_items(&mut store.items, max_unpinned_items);

        Self {
            items: Mutex::new(store.items),
            watching: Mutex::new(true),
            max_unpinned_items: Mutex::new(max_unpinned_items),
        }
    }
}

fn default_max_unpinned_items() -> usize {
    50
}

fn app_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let dir = home.join(".dioptase");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create app data dir: {}", e))?;
    Ok(dir)
}

fn clipboard_store_file() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("clipboard.json"))
}

fn load_clipboard_store() -> Result<ClipboardStore, String> {
    let path = clipboard_store_file()?;
    if !path.exists() {
        return Ok(ClipboardStore::default());
    }

    let content = fs::read_to_string(path).map_err(|e| format!("Cannot read clipboard store: {}", e))?;
    Ok(serde_json::from_str(&content).unwrap_or_default())
}

fn save_clipboard_store(items: &[ClipboardItem], max_unpinned_items: usize) -> Result<(), String> {
    let store = ClipboardStore {
        items: items.to_vec(),
        max_unpinned_items,
    };
    let content = serde_json::to_string_pretty(&store)
        .map_err(|e| format!("Cannot serialize clipboard store: {}", e))?;
    fs::write(clipboard_store_file()?, content).map_err(|e| format!("Cannot write clipboard store: {}", e))?;
    Ok(())
}

fn trim_unpinned_items(items: &mut Vec<ClipboardItem>, max_unpinned_items: usize) {
    let mut unpinned_seen = 0usize;
    items.retain(|item| {
        if item.pinned {
            return true;
        }

        unpinned_seen += 1;
        unpinned_seen <= max_unpinned_items
    });
}

fn sorted_items(items: &[ClipboardItem]) -> Vec<ClipboardItem> {
    let mut result = items.to_vec();
    result.sort_by(|a, b| b.pinned.cmp(&a.pinned).then_with(|| b.timestamp.cmp(&a.timestamp)));
    result
}

#[tauri::command]
pub fn start_clipboard_watch(state: State<'_, ClipboardState>) -> Result<String, String> {
    *state.watching.lock().unwrap() = true;
    Ok("Clipboard watching started".to_string())
}

#[tauri::command]
pub fn stop_clipboard_watch(state: State<'_, ClipboardState>) -> Result<String, String> {
    *state.watching.lock().unwrap() = false;
    Ok("Clipboard watching stopped".to_string())
}

#[tauri::command]
pub fn get_clipboard_items(state: State<'_, ClipboardState>) -> Vec<ClipboardItem> {
    let mut items = state.items.lock().unwrap();
    let max_unpinned_items = *state.max_unpinned_items.lock().unwrap();

    *state.watching.lock().unwrap() = true;

    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        if let Ok(text) = clipboard.get_text() {
            let last = items.first();
            let should_add = match last {
                None => true,
                Some(item) => item.content != text,
            };
            if should_add && !text.is_empty() {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                items.insert(
                    0,
                    ClipboardItem {
                        id: uuid::Uuid::new_v4().to_string(),
                        content: text,
                        content_type: "text".to_string(),
                        timestamp: now,
                        pinned: false,
                    },
                );
                trim_unpinned_items(&mut items, max_unpinned_items);
                if let Err(e) = save_clipboard_store(&items, max_unpinned_items) {
                    eprintln!("{}", e);
                }
            }
        }
    }
    sorted_items(&items)
}

#[tauri::command]
pub fn clear_clipboard_items(state: State<'_, ClipboardState>) -> Result<String, String> {
    state.items.lock().unwrap().clear();
    let max_unpinned_items = *state.max_unpinned_items.lock().unwrap();
    save_clipboard_store(&[], max_unpinned_items)?;
    Ok("Clipboard items cleared".to_string())
}

#[tauri::command]
pub fn delete_clipboard_item(id: String, state: State<'_, ClipboardState>) -> Result<String, String> {
    let mut items = state.items.lock().unwrap();
    let original_len = items.len();
    items.retain(|item| item.id != id);

    if items.len() == original_len {
        return Err("Clipboard item not found".to_string());
    }

    let max_unpinned_items = *state.max_unpinned_items.lock().unwrap();
    save_clipboard_store(&items, max_unpinned_items)?;

    Ok("Clipboard item deleted".to_string())
}

#[tauri::command]
pub fn toggle_clipboard_item_pin(
    id: String,
    pinned: bool,
    state: State<'_, ClipboardState>,
) -> Result<Vec<ClipboardItem>, String> {
    let max_unpinned_items = *state.max_unpinned_items.lock().unwrap();
    let mut items = state.items.lock().unwrap();
    let item = items
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or("Clipboard item not found")?;

    item.pinned = pinned;
    trim_unpinned_items(&mut items, max_unpinned_items);
    save_clipboard_store(&items, max_unpinned_items)?;

    Ok(sorted_items(&items))
}

#[tauri::command]
pub fn get_clipboard_config(state: State<'_, ClipboardState>) -> usize {
    *state.max_unpinned_items.lock().unwrap()
}

#[tauri::command]
pub fn set_clipboard_max_items(
    max_items: usize,
    state: State<'_, ClipboardState>,
) -> Result<Vec<ClipboardItem>, String> {
    if !(1..=500).contains(&max_items) {
        return Err("Clipboard max items must be between 1 and 500".to_string());
    }

    *state.max_unpinned_items.lock().unwrap() = max_items;

    let mut items = state.items.lock().unwrap();
    trim_unpinned_items(&mut items, max_items);
    save_clipboard_store(&items, max_items)?;

    Ok(sorted_items(&items))
}

#[tauri::command]
pub fn write_clipboard(content: String) -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("Clipboard error: {}", e))?;
    clipboard.set_text(&content).map_err(|e| format!("Clipboard write error: {}", e))?;
    Ok("Written to clipboard".to_string())
}
