use base64::Engine;
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

fn get_image_png(clipboard: &mut arboard::Clipboard) -> Option<(String, u64, u64)> {
    let image = clipboard.get_image().ok()?;
    let img = image::RgbaImage::from_raw(image.width as u32, image.height as u32, image.bytes.to_vec())?;
    let mut png_buf: Vec<u8> = Vec::new();
    let dyn_img = image::DynamicImage::ImageRgba8(img);
    dyn_img
        .write_to(&mut std::io::Cursor::new(&mut png_buf), image::ImageFormat::Png)
        .ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_buf);
    Some((b64, image.width as u64, image.height as u64))
}

fn now_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn make_text_item(content: String) -> ClipboardItem {
    ClipboardItem {
        id: uuid::Uuid::new_v4().to_string(),
        content,
        content_type: "text".to_string(),
        timestamp: now_ts(),
        pinned: false,
    }
}

fn make_image_item(b64: String, _width: u64, _height: u64) -> ClipboardItem {
    ClipboardItem {
        id: uuid::Uuid::new_v4().to_string(),
        content: format!("data:image/png;base64,{}", b64),
        content_type: "image/png".to_string(),
        timestamp: now_ts(),
        pinned: false,
    }
}

fn is_different(items: &[ClipboardItem], new_content: &str) -> bool {
    items.first().map_or(true, |last| last.content != new_content)
}

#[tauri::command]
pub fn get_clipboard_items(state: State<'_, ClipboardState>) -> Vec<ClipboardItem> {
    let mut items = state.items.lock().unwrap();
    let max_unpinned_items = *state.max_unpinned_items.lock().unwrap();

    *state.watching.lock().unwrap() = true;

    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        // Try text first
        if let Ok(text) = clipboard.get_text() {
            if !text.is_empty() && is_different(&items, &text) {
                items.insert(0, make_text_item(text));
                trim_unpinned_items(&mut items, max_unpinned_items);
                if let Err(e) = save_clipboard_store(&items, max_unpinned_items) {
                    eprintln!("{}", e);
                }
            }
        } else if let Some((b64, w, h)) = get_image_png(&mut clipboard) {
            // No text, try image
            let content = format!("data:image/png;base64,{}", b64);
            if is_different(&items, &content) {
                items.insert(0, make_image_item(b64, w, h));
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

#[tauri::command]
pub fn write_clipboard_item(content: String, content_type: String) -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("Clipboard error: {}", e))?;

    if content_type.starts_with("image/") {
        // Decode base64 PNG data URI: "data:image/png;base64,..."
        let b64 = content
            .strip_prefix("data:image/png;base64,")
            .unwrap_or(&content);
        let png_bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("Base64 decode error: {}", e))?;

        let img = image::load_from_memory(&png_bytes)
            .map_err(|e| format!("Image decode error: {}", e))?;
        let rgba = img.to_rgba8();
        let (width, height) = rgba.dimensions();
        let image_data = arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: rgba.into_raw().into(),
        };
        clipboard
            .set_image(image_data)
            .map_err(|e| format!("Clipboard image write error: {}", e))?;
    } else {
        clipboard
            .set_text(&content)
            .map_err(|e| format!("Clipboard write error: {}", e))?;
    }

    Ok("Written to clipboard".to_string())
}
