//! Windows installations keep all product data next to the executable in `data`.
//! Debug previews retain the isolated/relocatable developer profile.
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub(crate) const DATA_DIR_NAME: &str = ".openagent";
pub(crate) const POINTER_FILE_NAME: &str = "data-dir.json";

fn select_home(
    override_home: Option<OsString>,
    system_home: impl FnOnce() -> Option<PathBuf>,
) -> Option<PathBuf> {
    match override_home {
        Some(raw) => {
            let path = PathBuf::from(raw);
            path.is_absolute().then_some(path)
        }
        None => system_home(),
    }
}

pub(crate) fn isolation_requested() -> bool {
    cfg!(debug_assertions) && std::env::var_os("OPENAGENT_DEV_HOME").is_some()
}

pub(crate) fn home_dir() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    let explicit = std::env::var_os("OPENAGENT_DEV_HOME");
    #[cfg(not(debug_assertions))]
    let explicit = None;
    select_home(explicit, dirs::home_dir)
}

/// Windows release builds keep application data next to the installed executable.
pub(crate) fn install_local() -> bool {
    cfg!(all(windows, not(debug_assertions)))
}

fn installation_data_root(executable: &Path) -> Option<PathBuf> {
    if !executable.is_absolute() { return None; }
    executable.parent().map(|parent| parent.join("data"))
}

pub(crate) fn prepare_install_data() -> std::io::Result<()> {
    if !install_local() { return Ok(()); }
    let root = data_root().ok_or_else(|| std::io::Error::other("无法确定安装目录"))?;
    std::fs::create_dir_all(&root)?;
    let probe = root.join(format!(".write-check-{}", std::process::id()));
    let file = std::fs::OpenOptions::new().create_new(true).write(true).open(&probe)?;
    drop(file);
    std::fs::remove_file(probe)
}

pub(crate) fn default_data_root() -> Option<PathBuf> {
    if install_local() {
        return installation_data_root(&std::env::current_exe().ok()?);
    }
    home_dir().map(|home| home.join(DATA_DIR_NAME))
}

#[derive(serde::Serialize, serde::Deserialize)]
struct DataDirPointer {
    path: PathBuf,
}

/// Reads the relocation pointer stored in `default_root`. Missing, unreadable or
/// non-absolute pointers resolve to `None` (the default root stays in use).
pub(crate) fn read_pointer(default_root: &Path) -> Option<PathBuf> {
    let raw = std::fs::read(default_root.join(POINTER_FILE_NAME)).ok()?;
    let pointer = match serde_json::from_slice::<DataDirPointer>(&raw) {
        Ok(pointer) => pointer,
        Err(error) => {
            eprintln!("ignoring invalid {POINTER_FILE_NAME}: {error}");
            return None;
        }
    };
    (pointer.path.is_absolute() && pointer.path != default_root).then_some(pointer.path)
}

/// Records `target` as the data root; `None` (or the default root itself)
/// removes the pointer. Written via a temp file + rename so a crash never
/// leaves a truncated pointer behind.
pub(crate) fn write_pointer(default_root: &Path, target: Option<&Path>) -> std::io::Result<()> {
    let path = default_root.join(POINTER_FILE_NAME);
    match target.filter(|target| *target != default_root) {
        None => match std::fs::remove_file(&path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        },
        Some(target) => {
            std::fs::create_dir_all(default_root)?;
            let body = serde_json::to_vec_pretty(&DataDirPointer {
                path: target.to_path_buf(),
            })
            .map_err(std::io::Error::other)?;
            let tmp = default_root.join(format!("{POINTER_FILE_NAME}.tmp"));
            std::fs::write(&tmp, body)?;
            std::fs::rename(&tmp, &path)
        }
    }
}

fn resolve_data_root(
    env: impl Fn(&str) -> Option<OsString>,
    default: impl FnOnce() -> Option<PathBuf>,
) -> Option<PathBuf> {
    select_home(
        env("OPENAGENT_CONFIG_DIR").or_else(|| env("OPENAGENT_HOME")),
        default,
    )
}

static DATA_ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Installed Windows releases always use `<installation directory>/data`.
/// Other builds use environment overrides, then the relocation pointer, then
/// `<home>/.openagent`. Cached so every subsystem agrees until the app restarts.
/// Invalid explicit paths fail closed; legacy products cannot redirect this root.
pub(crate) fn data_root() -> Option<PathBuf> {
    DATA_ROOT
        .get_or_init(|| {
            // Installed Windows builds cannot be redirected by developer variables
            // or a stale relocation pointer from a preview installation.
            if install_local() { return default_data_root(); }
            resolve_data_root(
                |name| std::env::var_os(name),
                || {
                    let default_root = default_data_root()?;
                    Some(read_pointer(&default_root).unwrap_or(default_root))
                },
            )
        })
        .clone()
}

/// Environment variables that pin the data location and therefore disable
/// relocation from settings.
pub(crate) fn data_root_env_override() -> Option<&'static str> {
    if install_local() { return None; }
    ["OPENAGENT_CONFIG_DIR", "OPENAGENT_HOME"]
        .into_iter()
        .find(|name| std::env::var_os(name).is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_data_is_alongside_executable_even_with_spaces() {
        let install = std::env::temp_dir().join("openAgent installed");
        assert_eq!(installation_data_root(&install.join("openAgent.exe")), Some(install.join("data")));
        assert_eq!(installation_data_root(Path::new("openAgent.exe")), None);
    }

    #[test]
    fn debug_preview_does_not_switch_existing_profile() {
        assert!(!install_local());
    }


    #[test]
    fn openagent_ignores_other_products_environment() {
        let own_root = std::env::temp_dir().join("openagent-data-test");
        let resolved = resolve_data_root(
            |name| match name {
                "LIVEAGENT_CONFIG_DIR" | "LIVEAGENT_HOME" | "K_BRAIN_HOME" => {
                    Some(std::env::temp_dir().join("other-product").into_os_string())
                }
                _ => None,
            },
            || Some(own_root.clone()),
        );
        assert_eq!(resolved, Some(own_root));
        assert_eq!(DATA_DIR_NAME, ".openagent");
    }

    #[test]
    fn explicit_openagent_root_has_consistent_priority() {
        let config_root = std::env::temp_dir().join("openagent-config-test");
        let other_root = std::env::temp_dir().join("openagent-home-test");
        let resolved = resolve_data_root(
            |name| match name {
                "OPENAGENT_CONFIG_DIR" => Some(config_root.clone().into_os_string()),
                "OPENAGENT_HOME" => Some(other_root.clone().into_os_string()),
                _ => None,
            },
            || panic!("unexpected default root lookup"),
        );
        assert_eq!(resolved, Some(config_root));
    }

    #[test]
    fn invalid_openagent_root_never_falls_back() {
        for raw in ["", "relative/data"] {
            let resolved = resolve_data_root(
                |name| (name == "OPENAGENT_HOME").then(|| OsString::from(raw)),
                || panic!("invalid override reached personal data"),
            );
            assert_eq!(resolved, None);
        }
    }

    #[test]
    fn pointer_round_trips_and_default_target_removes_it() {
        let temp = tempfile::tempdir().unwrap();
        let default_root = temp.path().join(".openagent");
        assert_eq!(read_pointer(&default_root), None);

        let target = temp.path().join("elsewhere");
        write_pointer(&default_root, Some(&target)).unwrap();
        assert_eq!(read_pointer(&default_root), Some(target));

        write_pointer(&default_root, Some(&default_root)).unwrap();
        assert!(!default_root.join(POINTER_FILE_NAME).exists());
        write_pointer(&default_root, None).unwrap();
    }

    #[test]
    fn invalid_pointer_keeps_default_root() {
        let temp = tempfile::tempdir().unwrap();
        let default_root = temp.path().to_path_buf();
        for body in ["not json", r#"{"path":"relative/dir"}"#] {
            std::fs::write(default_root.join(POINTER_FILE_NAME), body).unwrap();
            assert_eq!(read_pointer(&default_root), None);
        }
    }

    #[test]
    fn isolated_home_never_resolves_personal_home() {
        let directory = std::env::temp_dir().join("liveagent-isolated-home-test");
        let selected = select_home(Some(directory.clone().into_os_string()), || {
            panic!("personal home lookup")
        });
        assert_eq!(selected, Some(directory));
    }

    #[test]
    fn invalid_override_does_not_fall_back_to_personal_data() {
        for raw in ["", "relative/home"] {
            assert_eq!(
                select_home(Some(OsString::from(raw)), || panic!("personal fallback")),
                None
            );
        }
    }

    #[test]
    fn ordinary_launch_retains_system_home() {
        let directory = std::env::temp_dir().join("normal-home-test");
        assert_eq!(
            select_home(None, || Some(directory.clone())),
            Some(directory)
        );
    }
}
