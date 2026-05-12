use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::Mutex;

pub struct GitState {
    pub repo_path: Mutex<Option<String>>,
}

impl GitState {
    pub fn new() -> Self {
        GitState {
            repo_path: Mutex::new(None),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatusEntry {
    pub status: String,       // " M", "M ", "??", etc.
    pub staged: bool,
    pub path: String,
    pub kind: String,         // "modified", "added", "deleted", "untracked", "renamed"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatusResult {
    pub branch: String,
    pub ahead: i32,
    pub behind: i32,
    pub entries: Vec<GitStatusEntry>,
    pub has_remote: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitLogEntry {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
    pub remote: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitDiffResult {
    pub filename: String,
    pub diff: String,
}

fn git(repo: &str, args: &[&str]) -> Result<String, String> {
    Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))
        .and_then(|o| {
            if o.status.success() {
                Ok(String::from_utf8_lossy(&o.stdout).to_string())
            } else {
                let stderr = String::from_utf8_lossy(&o.stderr).to_string();
                Err(stderr.trim().to_string())
            }
        })
}

fn parse_status_char(c: u8) -> &'static str {
    match c {
        b'M' => "modified",
        b'A' => "added",
        b'D' => "deleted",
        b'R' => "renamed",
        b'?' => "untracked",
        _ => "unknown",
    }
}

#[tauri::command]
pub fn git_set_repo_path(state: tauri::State<GitState>, path: String) -> Result<(), String> {
    let mut repo = state.repo_path.lock().map_err(|e| e.to_string())?;
    *repo = Some(path);
    Ok(())
}

#[tauri::command]
pub fn git_get_repo_path(state: tauri::State<GitState>) -> Result<String, String> {
    let repo = state.repo_path.lock().map_err(|e| e.to_string())?;
    repo.clone().ok_or_else(|| "No repository selected".to_string())
}

#[tauri::command]
pub fn git_check_repo(path: String) -> Result<String, String> {
    let output = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("无法执行 git 命令: {}", e))?;

    if output.status.success() {
        let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(root)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if stderr.contains("not a git repository") {
            Err(format!(
                "\"{}\" 不是一个 Git 仓库。\n\n请在对话框中选择包含 .git 目录的项目根目录。\n提示：在文件对话框中按 Cmd+Shift+. 可显示隐藏文件和目录。\n\n你也可以在当前目录初始化一个新的 Git 仓库。",
                path
            ))
        } else {
            Err(stderr.trim().to_string())
        }
    }
}

#[tauri::command]
pub fn git_init(path: String) -> Result<String, String> {
    let output = Command::new("git")
        .args(["init"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("无法执行 git init: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(stdout.trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(stderr.trim().to_string())
    }
}

#[tauri::command]
pub fn git_status(repo_path: String) -> Result<GitStatusResult, String> {
    let branch = git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();

    let status_raw = git(&repo_path, &["status", "--porcelain", "--branch"])?;
    let mut lines: Vec<&str> = status_raw.lines().collect();

    // Parse branch line: "## main...origin/main [ahead 1, behind 2]"
    let branch_line = if !lines.is_empty() && lines[0].starts_with("## ") {
        lines.remove(0)
    } else {
        ""
    };

    let mut ahead = 0i32;
    let mut behind = 0i32;
    let mut has_remote = false;
    if branch_line.starts_with("## ") {
        let rest = &branch_line[3..];
        has_remote = rest.contains("...");
        // Parse ahead/behind
        let lower = rest.to_lowercase();
        if let Some(pos) = lower.find("ahead ") {
            let num_str: String = lower[pos+6..].chars().take_while(|c| c.is_ascii_digit()).collect();
            ahead = num_str.parse().unwrap_or(0);
        }
        if let Some(pos) = lower.find("behind ") {
            let num_str: String = lower[pos+7..].chars().take_while(|c| c.is_ascii_digit()).collect();
            behind = num_str.parse().unwrap_or(0);
        }
    }

    let mut entries = Vec::new();
    for line in &lines {
        let line = line.trim_end();
        if line.is_empty() { continue; }
        let (status_str, path) = if line.len() > 3 {
            let (s, p) = line.split_at(2);
            (s, p.trim())
        } else {
            continue;
        };

        let bytes = status_str.as_bytes();
        let staged = bytes[0] != b' ';
        let unstaged = bytes[1] != b' ';
        let kind = if bytes[0] == b'?' && bytes[1] == b'?' {
            "untracked"
        } else if staged {
            parse_status_char(bytes[0])
        } else if unstaged {
            parse_status_char(bytes[1])
        } else {
            "unknown"
        };

        // For renamed, path is "old -> new"
        let display_path = if let Some(arrow) = path.find(" -> ") {
            &path[arrow + 4..]
        } else {
            path
        };

        entries.push(GitStatusEntry {
            status: status_str.to_string(),
            staged,
            path: display_path.to_string(),
            kind: kind.to_string(),
        });
    }

    Ok(GitStatusResult {
        branch,
        ahead,
        behind,
        entries,
        has_remote,
    })
}

#[tauri::command]
pub fn git_log(repo_path: String, max_count: Option<u32>) -> Result<Vec<GitLogEntry>, String> {
    let count = max_count.unwrap_or(50);
    let count_str = count.to_string();
    let raw = git(
        &repo_path,
        &[
            "log",
            "--pretty=format:%H|||%an|||%ai|||%s",
            &format!("-{}", count_str),
            "--no-color",
        ],
    )?;

    let entries = raw
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.splitn(4, "|||").collect();
            GitLogEntry {
                hash: parts.first().unwrap_or(&"").to_string(),
                author: parts.get(1).unwrap_or(&"").to_string(),
                date: parts.get(2).unwrap_or(&"").to_string(),
                message: parts.get(3).unwrap_or(&"").to_string(),
            }
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
pub fn git_diff(repo_path: String, file: Option<String>, staged: Option<bool>) -> Result<Vec<GitDiffResult>, String> {
    let mut args = vec!["diff"];
    if staged.unwrap_or(false) {
        args.push("--staged");
    }
    args.push("--no-color");

    if let Some(ref f) = file {
        args.push("--");
        args.push(f);
    }

    let raw = git(&repo_path, &args)?;

    let mut results = Vec::new();
    let mut current_file = String::new();
    let mut current_diff = String::new();

    for line in raw.lines() {
        if line.starts_with("diff --git ") {
            if !current_file.is_empty() {
                results.push(GitDiffResult {
                    filename: std::mem::take(&mut current_file),
                    diff: std::mem::take(&mut current_diff),
                });
            }
            // Extract filename from "diff --git a/file b/file"
            if let Some(b_part) = line.rsplit(" b/").next() {
                current_file = b_part.to_string();
            }
            current_diff.push_str(line);
            current_diff.push('\n');
        } else {
            current_diff.push_str(line);
            current_diff.push('\n');
        }
    }
    if !current_file.is_empty() {
        results.push(GitDiffResult {
            filename: current_file,
            diff: current_diff,
        });
    }

    Ok(results)
}

#[tauri::command]
pub fn git_stage(repo_path: String, files: Vec<String>) -> Result<(), String> {
    let mut args = vec!["add", "--"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);
    git(&repo_path, &args)?;
    Ok(())
}

#[tauri::command]
pub fn git_stage_all(repo_path: String) -> Result<(), String> {
    git(&repo_path, &["add", "-A"])?;
    Ok(())
}

#[tauri::command]
pub fn git_unstage(repo_path: String, files: Vec<String>) -> Result<(), String> {
    let mut args = vec!["restore", "--staged", "--"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);
    git(&repo_path, &args)?;
    Ok(())
}

#[tauri::command]
pub fn git_commit(repo_path: String, message: String) -> Result<(), String> {
    git(&repo_path, &["commit", "-m", &message])?;
    Ok(())
}

#[tauri::command]
pub fn git_push(repo_path: String, branch: Option<String>) -> Result<String, String> {
    let branch = branch.unwrap_or_default();
    if branch.is_empty() {
        let current = git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])?.trim().to_string();
        git(&repo_path, &["push", "-u", "origin", &current])?;
        Ok(format!("Pushed to origin/{}", current))
    } else {
        git(&repo_path, &["push", "-u", "origin", &branch])?;
        Ok(format!("Pushed to origin/{}", branch))
    }
}

#[tauri::command]
pub fn git_pull(repo_path: String, branch: Option<String>) -> Result<String, String> {
    let branch = branch.unwrap_or_default();
    if branch.is_empty() {
        let current = git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])?.trim().to_string();
        let output = git(&repo_path, &["pull", "origin", &current])?;
        Ok(output.trim().to_string())
    } else {
        let output = git(&repo_path, &["pull", "origin", &branch])?;
        Ok(output.trim().to_string())
    }
}

#[tauri::command]
pub fn git_branches(repo_path: String) -> Result<Vec<GitBranch>, String> {
    let raw = git(&repo_path, &["branch", "-a", "--no-color"])?;
    let mut branches = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        let current = line.starts_with('*');
        let name = line.trim_start_matches("* ").trim_start_matches(' ');

        // Check if it's a remote branch
        let (clean_name, remote) = if name.starts_with("remotes/") {
            let remote_name = name.trim_start_matches("remotes/");
            // Extract remote prefix (origin/...)
            if let Some(slash) = remote_name.find('/') {
                (name.to_string(), Some(remote_name[..slash].to_string()))
            } else {
                (name.to_string(), None)
            }
        } else {
            (name.to_string(), None)
        };

        branches.push(GitBranch {
            name: clean_name,
            current,
            remote,
        });
    }
    Ok(branches)
}

#[tauri::command]
pub fn git_checkout(repo_path: String, branch: String) -> Result<(), String> {
    git(&repo_path, &["checkout", &branch])?;
    Ok(())
}

#[tauri::command]
pub fn git_create_branch(repo_path: String, branch: String) -> Result<(), String> {
    git(&repo_path, &["checkout", "-b", &branch])?;
    Ok(())
}

#[tauri::command]
pub fn git_get_remote(repo_path: String) -> Result<String, String> {
    let remotes = git(&repo_path, &["remote", "-v"])?;
    // Extract first fetch/push URL
    if let Some(line) = remotes.lines().next() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            return Ok(parts[1].to_string());
        }
    }
    Err("No remote configured".to_string())
}

#[tauri::command]
pub fn git_fetch(repo_path: String) -> Result<(), String> {
    git(&repo_path, &["fetch", "--all", "--prune"])?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitBranchDiffFile {
    pub filename: String,
    pub added: u32,
    pub deleted: u32,
}

#[tauri::command]
pub fn git_branch_diff_files(
    repo_path: String,
    base: String,
    compare: String,
) -> Result<Vec<GitBranchDiffFile>, String> {
    let raw = git(&repo_path, &[
        "diff",
        &format!("{}...{}", base, compare),
        "--numstat",
    ])?;

    let files = raw
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(3, '\t').collect();
            if parts.len() < 3 { return None; }
            let added = parts[0].parse().unwrap_or(0);
            let deleted = parts[1].parse().unwrap_or(0);
            let filename = parts[2].to_string();
            Some(GitBranchDiffFile { filename, added, deleted })
        })
        .collect();

    Ok(files)
}

#[tauri::command]
pub fn git_branch_diff_content(
    repo_path: String,
    base: String,
    compare: String,
    file: String,
) -> Result<String, String> {
    let diff = git(&repo_path, &[
        "diff",
        &format!("{}...{}", base, compare),
        "--no-color",
        "--",
        &file,
    ])?;
    Ok(diff)
}

#[tauri::command]
pub fn git_commit_diff(repo_path: String, hash: String) -> Result<String, String> {
    let diff = git(&repo_path, &[
        "show",
        &hash,
        "--no-color",
        "--format=",
    ])?;
    Ok(diff)
}

#[tauri::command]
pub fn git_restore_file(repo_path: String, file: String) -> Result<(), String> {
    git(&repo_path, &["restore", &file])?;
    Ok(())
}
