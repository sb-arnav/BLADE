//! Utility for spawning subprocesses without a flash console window on Windows.

use std::ffi::OsStr;
use std::process::Command;

/// Create a `Command` with `CREATE_NO_WINDOW` set on Windows so no terminal
/// window flashes when the process is spawned.
///
/// Accepts anything `Command::new` accepts (e.g. `&str`, `String`, `&Path`, `PathBuf`).
pub fn silent_cmd<S: AsRef<OsStr>>(program: S) -> Command {
    let mut c = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}
