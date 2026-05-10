use screenshots::Screen;

#[tauri::command]
pub fn capture_screenshot() -> Result<String, String> {
    let screen = Screen::all()
        .map_err(|e| format!("Failed to get screens: {}", e))?
        .into_iter()
        .next()
        .ok_or("No screen found")?;

    let image = screen
        .capture()
        .map_err(|e| format!("Failed to capture screen: {}", e))?;

    let mut png_data = Vec::new();
    image
        .write_to(
            &mut std::io::Cursor::new(&mut png_data),
            screenshots::image::ImageFormat::Png,
        )
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&png_data))
}

#[tauri::command]
pub fn capture_selected_screenshot() -> Result<String, String> {
    use base64::Engine;

    let path = std::env::temp_dir().join(format!(
        "dioptase-selected-screenshot-{}.png",
        uuid::Uuid::new_v4()
    ));

    let output = std::process::Command::new("screencapture")
        .arg("-i")
        .arg("-s")
        .arg("-x")
        .arg("-t")
        .arg("png")
        .arg(&path)
        .output()
        .map_err(|e| format!("Failed to start macOS screenshot tool: {}", e))?;

    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let lower_message = message.to_lowercase();
        if lower_message.contains("permission")
            || lower_message.contains("not authorized")
            || lower_message.contains("could not create image from display")
        {
            return Err(format!("SCREEN_CAPTURE_PERMISSION_REQUIRED: {}", message));
        }
        return Err(if message.is_empty() {
            "Screenshot cancelled".to_string()
        } else {
            format!("Screenshot failed: {}", message)
        });
    }

    let png_data = std::fs::read(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Screenshot cancelled".to_string()
        } else {
            format!("Failed to read selected screenshot: {}", e)
        }
    })?;

    let _ = std::fs::remove_file(&path);

    if png_data.is_empty() {
        return Err("Screenshot cancelled".to_string());
    }

    Ok(base64::engine::general_purpose::STANDARD.encode(&png_data))
}

#[tauri::command]
pub fn save_screenshot(data: String, path: String) -> Result<String, String> {
    use base64::Engine;
    let png_bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    std::fs::write(&path, png_bytes).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(path)
}
