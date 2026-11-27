use crate::runtime::project_path::project_path_key as normalize_project_path_key;

pub(crate) fn required_project_key(project_path_key: String) -> Result<String, String> {
    let project_key = normalize_project_path_key(&project_path_key);
    if project_key.is_empty() {
        return Err("project_path_key is required".to_string());
    }
    Ok(project_key)
}
