use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

// --- Types ---

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NoteType {
    Note,
    Code,
    Todo,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    Pending,
    Done,
    Cancelled,
    Deferred,
}

impl Default for TodoStatus {
    fn default() -> Self {
        TodoStatus::Pending
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoItem {
    pub text: String,
    #[serde(default)]
    pub status: TodoStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteItem {
    pub id: String,
    pub note_type: NoteType,
    pub title: String,
    pub content: String,
    pub language: Option<String>,
    pub todos: Option<Vec<TodoItem>>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub archived: bool,
}

/// Metadata stored in index.json — excludes content/todos (those go in per-note files).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct IndexEntry {
    id: String,
    note_type: NoteType,
    title: String,
    language: Option<String>,
    created_at: i64,
    updated_at: i64,
    #[serde(default)]
    archived: bool,
}

// --- State ---

pub struct NotesState {
    pub notes: Mutex<Vec<NoteItem>>,
}

impl NotesState {
    pub fn new() -> Self {
        let notes = load_notes().unwrap_or_default();
        Self {
            notes: Mutex::new(notes),
        }
    }
}

// --- Paths ---

fn app_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let dir = home.join(".dioptase");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create app data dir: {}", e))?;
    Ok(dir)
}

fn notes_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("notes");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create notes dir: {}", e))?;
    Ok(dir)
}

fn index_file() -> Result<PathBuf, String> {
    Ok(notes_dir()?.join("index.json"))
}

fn old_notes_file() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("notes.json"))
}

fn note_body_path(id: &str, note_type: &NoteType) -> Result<PathBuf, String> {
    let ext = match note_type {
        NoteType::Todo => "json",
        _ => "txt",
    };
    Ok(notes_dir()?.join(format!("{}.{}", id, ext)))
}

// --- Persistence: index ---

fn load_index() -> Result<Vec<IndexEntry>, String> {
    let path = index_file()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("Cannot read index: {}", e))?;
    Ok(serde_json::from_str(&content).unwrap_or_default())
}

fn save_index(entries: &[IndexEntry]) -> Result<(), String> {
    let content =
        serde_json::to_string_pretty(entries).map_err(|e| format!("Cannot serialize index: {}", e))?;
    fs::write(index_file()?, content).map_err(|e| format!("Cannot write index: {}", e))?;
    Ok(())
}

fn to_index_entry(note: &NoteItem) -> IndexEntry {
    IndexEntry {
        id: note.id.clone(),
        note_type: note.note_type.clone(),
        title: note.title.clone(),
        language: note.language.clone(),
        created_at: note.created_at,
        updated_at: note.updated_at,
        archived: note.archived,
    }
}

// --- Persistence: note body files ---

fn read_note_body(id: &str, note_type: &NoteType) -> Result<(String, Option<Vec<TodoItem>>), String> {
    let path = note_body_path(id, note_type)?;
    if !path.exists() {
        return Ok((String::new(), None));
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read note body {}: {}", id, e))?;
    match note_type {
        NoteType::Todo => {
            let todos: Vec<TodoItem> = serde_json::from_str(&raw).unwrap_or_default();
            Ok((String::new(), Some(todos)))
        }
        _ => Ok((raw, None)),
    }
}

fn write_note_body(id: &str, note_type: &NoteType, content: &str, todos: &Option<Vec<TodoItem>>) -> Result<(), String> {
    let path = note_body_path(id, note_type)?;
    match note_type {
        NoteType::Todo => {
            let json = serde_json::to_string_pretty(todos.as_ref().unwrap_or(&vec![]))
                .map_err(|e| format!("Cannot serialize todos: {}", e))?;
            fs::write(&path, json).map_err(|e| format!("Cannot write note body {}: {}", id, e))?;
        }
        _ => {
            fs::write(&path, content).map_err(|e| format!("Cannot write note body {}: {}", id, e))?;
        }
    }
    Ok(())
}

fn delete_note_body(id: &str, note_type: &NoteType) {
    if let Ok(path) = note_body_path(id, note_type) {
        let _ = fs::remove_file(path);
    }
}

// --- Persistence: load / save all ---

fn load_notes() -> Result<Vec<NoteItem>, String> {
    // Migrate from old notes.json if needed
    let old = old_notes_file()?;
    let index = index_file()?;
    if old.exists() && !index.exists() {
        migrate_from_old(&old)?;
    }

    let entries = load_index()?;
    let mut notes = Vec::with_capacity(entries.len());
    for e in entries {
        let (content, todos) = read_note_body(&e.id, &e.note_type)?;
        notes.push(NoteItem {
            id: e.id,
            note_type: e.note_type,
            title: e.title,
            content,
            language: e.language,
            todos,
            created_at: e.created_at,
            updated_at: e.updated_at,
            archived: e.archived,
        });
    }
    Ok(notes)
}

fn save_all_notes(notes: &[NoteItem]) -> Result<(), String> {
    let entries: Vec<IndexEntry> = notes.iter().map(to_index_entry).collect();
    save_index(&entries)?;
    for note in notes {
        write_note_body(&note.id, &note.note_type, &note.content, &note.todos)?;
    }
    Ok(())
}

// --- Migration ---

fn migrate_from_old(old_path: &std::path::Path) -> Result<(), String> {
    let raw = fs::read_to_string(old_path).map_err(|e| format!("Cannot read old notes: {}", e))?;
    let notes: Vec<NoteItem> = serde_json::from_str(&raw).unwrap_or_default();
    save_all_notes(&notes)?;
    // Rename old file as backup instead of deleting
    let backup = old_path.with_extension("json.bak");
    let _ = fs::rename(old_path, backup);
    Ok(())
}

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

// --- Commands ---

#[tauri::command]
pub fn list_notes(state: State<'_, NotesState>) -> Vec<NoteItem> {
    state.notes.lock().unwrap().clone()
}

#[tauri::command]
pub fn create_note(
    note_type: String,
    title: String,
    content: String,
    language: Option<String>,
    todos: Option<Vec<TodoItem>>,
    state: State<'_, NotesState>,
) -> Result<Vec<NoteItem>, String> {
    let note_type = match note_type.as_str() {
        "note" => NoteType::Note,
        "code" => NoteType::Code,
        "todo" => NoteType::Todo,
        other => return Err(format!("Unknown note_type: {}", other)),
    };
    let ts = now_ts();
    let item = NoteItem {
        id: uuid::Uuid::new_v4().to_string(),
        note_type,
        title,
        content,
        language,
        todos,
        created_at: ts,
        updated_at: ts,
        archived: false,
    };
    let mut notes = state.notes.lock().unwrap();
    notes.push(item);
    save_all_notes(&notes)?;
    Ok(notes.clone())
}

#[tauri::command]
pub fn update_note(
    id: String,
    title: String,
    content: String,
    language: Option<String>,
    todos: Option<Vec<TodoItem>>,
    state: State<'_, NotesState>,
) -> Result<Vec<NoteItem>, String> {
    let mut notes = state.notes.lock().unwrap();
    if let Some(note) = notes.iter_mut().find(|n| n.id == id) {
        note.title = title;
        note.content = content;
        note.language = language;
        note.todos = todos;
        note.updated_at = now_ts();
    }
    let entries: Vec<IndexEntry> = notes.iter().map(to_index_entry).collect();
    save_index(&entries)?;
    if let Some(note) = notes.iter().find(|n| n.id == id) {
        write_note_body(&note.id, &note.note_type, &note.content, &note.todos)?;
    }
    Ok(notes.clone())
}

#[tauri::command]
pub fn delete_note(id: String, state: State<'_, NotesState>) -> Result<Vec<NoteItem>, String> {
    let mut notes = state.notes.lock().unwrap();
    if let Some(note) = notes.iter().find(|n| n.id == id) {
        let note_type = note.note_type.clone();
        delete_note_body(&id, &note_type);
    }
    notes.retain(|n| n.id != id);
    let entries: Vec<IndexEntry> = notes.iter().map(to_index_entry).collect();
    save_index(&entries)?;
    Ok(notes.clone())
}

#[tauri::command]
pub fn archive_note(id: String, state: State<'_, NotesState>) -> Result<Vec<NoteItem>, String> {
    let mut notes = state.notes.lock().unwrap();
    if let Some(note) = notes.iter_mut().find(|n| n.id == id) {
        note.archived = true;
        note.updated_at = now_ts();
        let entries: Vec<IndexEntry> = notes.iter().map(to_index_entry).collect();
        save_index(&entries)?;
    }
    Ok(notes.clone())
}

#[tauri::command]
pub fn unarchive_note(id: String, state: State<'_, NotesState>) -> Result<Vec<NoteItem>, String> {
    let mut notes = state.notes.lock().unwrap();
    if let Some(note) = notes.iter_mut().find(|n| n.id == id) {
        note.archived = false;
        note.updated_at = now_ts();
        let entries: Vec<IndexEntry> = notes.iter().map(to_index_entry).collect();
        save_index(&entries)?;
    }
    Ok(notes.clone())
}
