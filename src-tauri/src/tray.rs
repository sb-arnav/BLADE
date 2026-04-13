use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App,
};

pub const TRAY_ID: &str = "blade_main";

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BladeStatus {
    Idle,
    Processing,
    Error,
    Recording,
}

impl BladeStatus {
    pub fn tooltip(&self) -> &'static str {
        match self {
            BladeStatus::Idle => "Blade — Ready",
            BladeStatus::Processing => "Blade — Thinking...",
            BladeStatus::Error => "Blade — Error",
            BladeStatus::Recording => "Blade — Listening...",
        }
    }
}

pub fn create_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let quit = MenuItem::with_id(app, "quit", "Quit Blade", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show / Hide  (Alt+Space)", true, None::<&str>)?;
    let pulse = MenuItem::with_id(app, "pulse", "Pulse thought now", true, None::<&str>)?;
    let reminders = MenuItem::with_id(app, "reminders", "My reminders", true, None::<&str>)?;
    let screenshot = MenuItem::with_id(app, "screenshot", "Send screenshot to Blade", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &pulse, &reminders, &screenshot, &quit])?;

    let icon = tauri::image::Image::from_path("icons/32x32.png")
        .or_else(|_| tauri::image::Image::from_path("icons/icon.png"))
        .ok();

    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Blade — Ready");

    if let Some(icon) = icon {
        tray_builder = tray_builder.icon(icon);
    }

    let handle = app.handle().clone();
    let handle2 = app.handle().clone();

    tray_builder
        .on_menu_event(move |_app, event| match event.id.as_ref() {
            "quit" => _app.exit(0),
            "show" => crate::toggle_window(&handle),
            "pulse" => {
                let app_clone = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::pulse::pulse_now(app_clone).await;
                });
            }
            "reminders" => {
                // Show BLADE window and emit event to open reminders panel
                crate::toggle_window(&handle);
                use tauri::Emitter;
                let _ = handle.emit("open_settings_tab", "integrations");
            }
            "screenshot" => {
                use tauri::Emitter;
                crate::toggle_window(&handle);
                let _ = handle.emit("tray_screenshot_requested", ());
            }
            _ => {}
        })
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::toggle_window(&handle2);
            }
        })
        .build(app)?;

    Ok(())
}

#[tauri::command]
pub fn set_tray_status(app: tauri::AppHandle, status: BladeStatus) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(status.tooltip()));
    }
}
