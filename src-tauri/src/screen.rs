use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use xcap::Monitor;

/// Capture the primary monitor screenshot and return as base64 PNG
#[tauri::command]
pub fn capture_screen() -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;

    let monitor = monitors
        .into_iter()
        .next()
        .ok_or("No monitor found")?;

    let image = monitor
        .capture_image()
        .map_err(|e| format!("Screenshot failed: {}", e))?;

    let mut png_data = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png_data);
    image::ImageEncoder::write_image(
        encoder,
        image.as_raw(),
        image.width(),
        image.height(),
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|e| format!("PNG encode failed: {}", e))?;

    let b64 = B64.encode(&png_data);
    Ok(b64)
}

/// Capture a specific region of the screen
#[tauri::command]
pub fn capture_screen_region(x: u32, y: u32, width: u32, height: u32) -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {}", e))?;

    let monitor = monitors
        .into_iter()
        .next()
        .ok_or("No monitor found")?;

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
