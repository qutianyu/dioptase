use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const MAX_SCAN_DEPTH: usize = 8;
const LARGE_FILE_MIN_SIZE: u64 = 100 * 1024 * 1024;
const LARGE_FILE_MAX_RESULTS: usize = 80;

#[derive(Serialize, Clone)]
pub struct CleanerCategory {
    pub id: String,
    pub name: String,
    pub description: String,
    pub size: u64,
    pub item_count: usize,
    pub safe_by_default: bool,
}

#[derive(Serialize, Clone)]
pub struct CleanerItem {
    pub id: String,
    pub category_id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified_at: Option<u64>,
    pub removable: bool,
    pub selected_by_default: bool,
}

#[derive(Serialize)]
pub struct CleanerScanResult {
    pub total_size: u64,
    pub reclaimable_size: u64,
    pub categories: Vec<CleanerCategory>,
    pub items: Vec<CleanerItem>,
}

#[derive(Deserialize)]
pub struct DeleteRequest {
    pub paths: Vec<String>,
}

#[derive(Serialize)]
pub struct DeleteResult {
    pub deleted_size: u64,
    pub deleted_count: usize,
    pub failed: Vec<DeleteFailure>,
}

#[derive(Serialize)]
pub struct DeleteFailure {
    pub path: String,
    pub reason: String,
}

#[derive(Clone)]
struct ScanTarget {
    category_id: &'static str,
    path: PathBuf,
    safe_by_default: bool,
    include_children: bool,
}

#[derive(Clone)]
struct CategoryMeta {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    safe_by_default: bool,
}

fn user_home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "无法获取当前用户目录".to_string())
}

fn modified_at(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
}

fn is_hidden_or_system(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name == "." || name == ".." || name == ".DS_Store")
        .unwrap_or(false)
}

fn dir_size(path: &Path, depth: usize) -> u64 {
    if depth > MAX_SCAN_DEPTH || is_hidden_or_system(path) {
        return 0;
    }

    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return 0,
    };

    if metadata.file_type().is_symlink() {
        return 0;
    }

    if metadata.is_file() {
        return metadata.len();
    }

    if !metadata.is_dir() {
        return 0;
    }

    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };

    entries
        .filter_map(Result::ok)
        .map(|entry| dir_size(&entry.path(), depth + 1))
        .sum()
}

fn item_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.display().to_string())
}

fn cleaner_targets(home: &Path) -> Vec<ScanTarget> {
    let library = home.join("Library");
    vec![
        ScanTarget {
            category_id: "user_cache",
            path: library.join("Caches"),
            safe_by_default: true,
            include_children: true,
        },
        ScanTarget {
            category_id: "logs",
            path: library.join("Logs"),
            safe_by_default: true,
            include_children: true,
        },
        ScanTarget {
            category_id: "logs",
            path: library.join("Application Support").join("CrashReporter"),
            safe_by_default: true,
            include_children: false,
        },
        ScanTarget {
            category_id: "trash",
            path: home.join(".Trash"),
            safe_by_default: true,
            include_children: true,
        },
        ScanTarget {
            category_id: "developer",
            path: library.join("Developer").join("Xcode").join("DerivedData"),
            safe_by_default: true,
            include_children: true,
        },
        ScanTarget {
            category_id: "developer",
            path: library.join("Developer").join("Xcode").join("iOS DeviceSupport"),
            safe_by_default: false,
            include_children: true,
        },
        ScanTarget {
            category_id: "developer",
            path: library.join("Developer").join("CoreSimulator").join("Caches"),
            safe_by_default: true,
            include_children: true,
        },
        ScanTarget {
            category_id: "developer",
            path: library.join("Caches").join("Homebrew"),
            safe_by_default: true,
            include_children: true,
        },
        ScanTarget {
            category_id: "mail_downloads",
            path: library
                .join("Containers")
                .join("com.apple.mail")
                .join("Data")
                .join("Library")
                .join("Mail Downloads"),
            safe_by_default: false,
            include_children: true,
        },
        ScanTarget {
            category_id: "temporary",
            path: std::env::temp_dir(),
            safe_by_default: true,
            include_children: true,
        },
    ]
}

fn large_file_roots(home: &Path) -> Vec<PathBuf> {
    ["Downloads", "Desktop", "Documents"]
        .iter()
        .map(|name| home.join(name))
        .collect()
}

fn category_meta() -> Vec<CategoryMeta> {
    vec![
        CategoryMeta {
            id: "user_cache",
            name: "用户缓存",
            description: "应用缓存、浏览器缓存和系统为当前用户生成的临时缓存。",
            safe_by_default: true,
        },
        CategoryMeta {
            id: "logs",
            name: "日志与崩溃报告",
            description: "应用日志、诊断日志和崩溃报告，通常可在排障结束后清理。",
            safe_by_default: true,
        },
        CategoryMeta {
            id: "trash",
            name: "废纸篓",
            description: "当前用户废纸篓中的文件。",
            safe_by_default: true,
        },
        CategoryMeta {
            id: "developer",
            name: "开发缓存",
            description: "Xcode DerivedData、模拟器缓存和 Homebrew 下载缓存。",
            safe_by_default: true,
        },
        CategoryMeta {
            id: "mail_downloads",
            name: "邮件下载",
            description: "Apple Mail 保存的附件下载副本。",
            safe_by_default: false,
        },
        CategoryMeta {
            id: "temporary",
            name: "临时文件",
            description: "当前用户临时目录中的可清理文件。",
            safe_by_default: true,
        },
        CategoryMeta {
            id: "large_files",
            name: "大文件",
            description: "下载、桌面和文稿中的大文件，仅用于发现，默认不选择。",
            safe_by_default: false,
        },
    ]
}

fn scan_target(target: &ScanTarget) -> Vec<CleanerItem> {
    if !target.path.exists() {
        return Vec::new();
    }

    let paths: Vec<PathBuf> = if target.include_children {
        fs::read_dir(&target.path)
            .ok()
            .into_iter()
            .flat_map(|entries| entries.filter_map(Result::ok).map(|entry| entry.path()))
            .collect()
    } else {
        vec![target.path.clone()]
    };

    paths
        .into_iter()
        .filter(|path| !is_hidden_or_system(path))
        .filter(|path| {
            !(target.category_id == "user_cache"
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.eq_ignore_ascii_case("Homebrew"))
                    .unwrap_or(false))
        })
        .filter_map(|path| {
            let metadata = fs::symlink_metadata(&path).ok()?;
            let size = dir_size(&path, 0);
            if size == 0 {
                return None;
            }

            Some(CleanerItem {
                id: format!("{}:{}", target.category_id, path.display()),
                category_id: target.category_id.to_string(),
                name: item_name(&path),
                path: path.display().to_string(),
                size,
                modified_at: modified_at(&metadata),
                removable: true,
                selected_by_default: target.safe_by_default,
            })
        })
        .collect()
}

fn scan_large_files(root: &Path, items: &mut Vec<CleanerItem>) {
    if !root.exists() {
        return;
    }

    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.filter_map(Result::ok) {
        let large_file_count = items
            .iter()
            .filter(|item| item.category_id == "large_files")
            .count();
        if large_file_count >= LARGE_FILE_MAX_RESULTS {
            break;
        }

        let path = entry.path();
        if is_hidden_or_system(&path) {
            continue;
        }

        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };

        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_file() && metadata.len() >= LARGE_FILE_MIN_SIZE {
            items.push(CleanerItem {
                id: format!("large_files:{}", path.display()),
                category_id: "large_files".to_string(),
                name: item_name(&path),
                path: path.display().to_string(),
                size: metadata.len(),
                modified_at: modified_at(&metadata),
                removable: true,
                selected_by_default: false,
            });
        }
    }
}

fn allowed_delete_roots(home: &Path) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = cleaner_targets(home).into_iter().map(|target| target.path).collect();
    roots.extend(large_file_roots(home));
    roots
}

fn canonical_parent(path: &Path) -> Result<PathBuf, String> {
    path.parent()
        .ok_or_else(|| "路径没有父目录".to_string())?
        .canonicalize()
        .map_err(|err| format!("无法解析父目录: {err}"))
}

fn is_path_allowed(path: &Path, roots: &[PathBuf]) -> bool {
    let parent = match canonical_parent(path) {
        Ok(parent) => parent,
        Err(_) => return false,
    };

    roots.iter().any(|root| {
        let canonical_root = match root.canonicalize() {
            Ok(canonical_root) => canonical_root,
            Err(_) => return false,
        };

        let path_allowed = path
            .canonicalize()
            .map(|canonical_path| canonical_path.starts_with(&canonical_root))
            .unwrap_or(false);

        path_allowed || parent.starts_with(canonical_root)
    })
}

fn remove_path(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|err| err.to_string())?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).map_err(|err| err.to_string())
    } else {
        fs::remove_file(path).map_err(|err| err.to_string())
    }
}

#[tauri::command]
pub fn scan_mac_cleanup() -> Result<CleanerScanResult, String> {
    let home = user_home()?;
    let mut items: Vec<CleanerItem> = cleaner_targets(&home)
        .iter()
        .flat_map(scan_target)
        .collect();

    for root in large_file_roots(&home) {
        scan_large_files(&root, &mut items);
    }

    items.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.name.cmp(&b.name)));

    let mut categories = category_meta()
        .into_iter()
        .map(|meta| {
            let category_items: Vec<&CleanerItem> = items
                .iter()
                .filter(|item| item.category_id == meta.id)
                .collect();

            CleanerCategory {
                id: meta.id.to_string(),
                name: meta.name.to_string(),
                description: meta.description.to_string(),
                size: category_items.iter().map(|item| item.size).sum(),
                item_count: category_items.len(),
                safe_by_default: meta.safe_by_default,
            }
        })
        .collect::<Vec<_>>();

    categories.retain(|category| category.item_count > 0);

    let total_size = items.iter().map(|item| item.size).sum();
    let reclaimable_size = items
        .iter()
        .filter(|item| item.selected_by_default)
        .map(|item| item.size)
        .sum();

    Ok(CleanerScanResult {
        total_size,
        reclaimable_size,
        categories,
        items,
    })
}

#[tauri::command]
pub fn delete_mac_cleanup_items(request: DeleteRequest) -> Result<DeleteResult, String> {
    let home = user_home()?;
    let roots = allowed_delete_roots(&home);
    let mut seen = HashSet::new();
    let mut deleted_size = 0;
    let mut deleted_count = 0;
    let mut failed = Vec::new();

    for raw_path in request.paths {
        if !seen.insert(raw_path.clone()) {
            continue;
        }

        let path = PathBuf::from(&raw_path);
        if !path.is_absolute() || !is_path_allowed(&path, &roots) {
            failed.push(DeleteFailure {
                path: raw_path,
                reason: "路径不在允许清理的目录中".to_string(),
            });
            continue;
        }

        if !path.exists() {
            continue;
        }

        let size = dir_size(&path, 0);
        match remove_path(&path) {
            Ok(()) => {
                deleted_size += size;
                deleted_count += 1;
            }
            Err(reason) => failed.push(DeleteFailure {
                path: raw_path,
                reason,
            }),
        }
    }

    Ok(DeleteResult {
        deleted_size,
        deleted_count,
        failed,
    })
}
