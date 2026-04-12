use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use tauri::Manager;
use xcap::Monitor;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ScreenSnapshot {
    pub image_base64: String,
    pub width: u32,
    pub height: u32,
    pub fingerprint: u64,
}

fn compute_fingerprint(image: &image::RgbaImage) -> u64 {
    image
        .pixels()
        .step_by(4096)
        .fold(1469598103934665603u64, |acc, pixel| {
            let rgba = pixel.0;
            let mixed = ((rgba[0] as u64) << 24)
                ^ ((rgba[1] as u64) << 16)
                ^ ((rgba[2] as u64) << 8)
                ^ (rgba[3] as u64);
            acc.wrapping_mul(1099511628211).wrapping_add(mixed)
        })
}

pub(crate) fn capture_screen_snapshot_internal() -> Result<ScreenSnapshot, String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;
    let idx = user_monitor_index(monitors.len());
    let monitor = monitors.into_iter().nth(idx).ok_or("No monitor found")?;

    let image = monitor
        .capture_image()
        .map_err(|e| format!("Screenshot failed: {}", e))?;

    let width = image.width();
    let height = image.height();

    let mut png_data = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png_data);
    image::ImageEncoder::write_image(
        encoder,
        image.as_raw(),
        width,
        height,
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|e| format!("PNG encode failed: {}", e))?;

    let fingerprint = compute_fingerprint(&image);

    Ok(ScreenSnapshot {
        image_base64: B64.encode(&png_data),
        width,
        height,
        fingerprint,
    })
}

pub(crate) fn capture_screen_region_snapshot_internal(
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<ScreenSnapshot, String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;

    let monitor = monitors.into_iter().next().ok_or("No monitor found")?;
    let image = monitor
        .capture_image()
        .map_err(|e| format!("Screenshot failed: {}", e))?;

    let safe_width = width.min(image.width().saturating_sub(x));
    let safe_height = height.min(image.height().saturating_sub(y));

    let cropped = image::imageops::crop_imm(&image, x, y, safe_width, safe_height).to_image();

    let mut png_data = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png_data);
    image::ImageEncoder::write_image(
        encoder,
        cropped.as_raw(),
        cropped.width(),
        cropped.height(),
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|e| format!("PNG encode failed: {}", e))?;

    Ok(ScreenSnapshot {
        image_base64: B64.encode(&png_data),
        width: cropped.width(),
        height: cropped.height(),
        fingerprint: compute_fingerprint(&cropped),
    })
}

/// Capture the primary monitor screenshot and return as base64 PNG
#[tauri::command]
pub fn capture_screen() -> Result<String, String> {
    Ok(capture_screen_snapshot_internal()?.image_base64)
}

/// Pick the monitor index the user is actively working on.
/// When BLADE has a dedicated monitor (blade_dedicated_monitor >= 0), the user's workspace
/// is the first monitor that isn't BLADE's. Falls back to 0 for single-monitor setups.
pub(crate) fn user_monitor_index(monitor_count: usize) -> usize {
    let config = crate::config::load_config();
    let blade_idx = config.blade_dedicated_monitor;
    if blade_idx < 0 || monitor_count <= 1 {
        return 0;
    }
    let b = blade_idx as usize;
    // Return first index that isn't BLADE's dedicated screen
    if b == 0 { 1 } else { 0 }
}

/// Capture screen as JPEG (quality 0-100). Returns (full_jpeg, thumb_jpeg, width, height, fingerprint).
/// Always captures the user's workspace monitor (not BLADE's dedicated screen).
/// Used by the screen timeline to persist space-efficient screenshots.
pub fn capture_screen_as_jpeg(quality: u8) -> Result<(Vec<u8>, Vec<u8>, u32, u32, u64), String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;
    let idx = user_monitor_index(monitors.len());
    let monitor = monitors.into_iter().nth(idx).ok_or("No monitor found")?;
    let image = monitor
        .capture_image()
        .map_err(|e| format!("Screenshot failed: {}", e))?;

    let width = image.width();
    let height = image.height();
    let fingerprint = compute_fingerprint(&image);

    // JPEG doesn't support alpha — convert RGBA → RGB
    let rgb = image::DynamicImage::ImageRgba8(image).to_rgb8();

    // Encode full JPEG
    let mut jpeg_data: Vec<u8> = Vec::new();
    {
        let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_data, quality);
        image::ImageEncoder::write_image(enc, rgb.as_raw(), width, height, image::ExtendedColorType::Rgb8)
            .map_err(|e| format!("JPEG encode failed: {}", e))?;
    }

    // Thumbnail: 320px wide, proportional height
    let thumb_w = 320u32;
    let thumb_h = ((height as f32 * thumb_w as f32) / width as f32).max(1.0) as u32;
    let thumb = image::imageops::resize(&rgb, thumb_w, thumb_h, image::imageops::FilterType::Triangle);

    let mut thumb_data: Vec<u8> = Vec::new();
    {
        let enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut thumb_data, quality);
        image::ImageEncoder::write_image(enc, thumb.as_raw(), thumb_w, thumb_h, image::ExtendedColorType::Rgb8)
            .map_err(|e| format!("Thumbnail encode failed: {}", e))?;
    }

    Ok((jpeg_data, thumb_data, width, height, fingerprint))
}

/// Monitor info returned to frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct MonitorInfo {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
}

/// List all connected monitors with position and size.
#[tauri::command]
pub async fn get_monitors(app: tauri::AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .iter()
        .enumerate()
        .map(|(i, m)| MonitorInfo {
            index: i,
            name: m.name().cloned().unwrap_or_else(|| format!("Monitor {}", i)),
            width: m.size().width,
            height: m.size().height,
            x: m.position().x,
            y: m.position().y,
            is_primary: m.position().x == 0 && m.position().y == 0,
        })
        .collect())
}

/// Move the main BLADE window to a given monitor index and center it there.
/// Call with monitor_index=1 to claim the second monitor as BLADE's JARVIS screen.
#[tauri::command]
pub async fn move_to_monitor(app: tauri::AppHandle, monitor_index: usize) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let target = monitors
        .get(monitor_index)
        .ok_or_else(|| format!("Monitor {} not found ({} monitors available)", monitor_index, monitors.len()))?;

    let pos = target.position();
    let size = target.size();

    // Get current window size so we center BLADE on the new monitor
    let win_size = window.inner_size().map_err(|e| e.to_string())?;
    let w = win_size.width as i32;
    let h = win_size.height as i32;

    let x = pos.x + ((size.width as i32 - w) / 2).max(0);
    let y = pos.y + ((size.height as i32 - h) / 2).max(0);

    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;

    // Persist so God Mode knows which monitor belongs to the user
    {
        let mut config = crate::config::load_config();
        config.blade_dedicated_monitor = monitor_index as i32;
        let _ = crate::config::save_config(&config);
    }

    // Bring BLADE to focus on the new monitor
    let _ = window.show();
    let _ = window.set_focus();

    Ok(())
}

/// Capture a specific region of the screen
#[tauri::command]
pub fn capture_screen_region(x: u32, y: u32, width: u32, height: u32) -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;

    let monitor = monitors.into_iter().next().ok_or("No monitor found")?;

    let image = monitor
        .capture_image()
        .map_err(|e| format!("Screenshot failed: {}", e))?;

    let cropped = image::imageops::crop_imm(
        &image,
        x,
        y,
        width.min(image.width().saturating_sub(x)),
        height.min(image.height().saturating_sub(y)),
    )
    .to_image();

    let mut png_data = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png_data);
    image::ImageEncoder::write_image(
        encoder,
        cropped.as_raw(),
        cropped.width(),
        cropped.height(),
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|e| format!("PNG encode failed: {}", e))?;

    let b64 = B64.encode(&png_data);
    Ok(b64)
}
