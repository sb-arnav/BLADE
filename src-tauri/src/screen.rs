use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
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

    let monitor = monitors.into_iter().next().ok_or("No monitor found")?;

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
