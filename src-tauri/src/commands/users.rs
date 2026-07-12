use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
use crate::json_bson::canonical_string_to_doc_array;
use crate::state::AppState;
use mongodb::bson::{doc, Document};
use tauri::State;

/// Parse a Canonical ExtJSON array of `{role, db}` documents (used by both the "roles a user
/// has" and "roles a custom role inherits" fields).
fn parse_role_refs(json: &str) -> Result<Vec<Document>, AppError> {
    canonical_string_to_doc_array(
        json,
        "roles must be an array",
        "each role must be a document",
    )
}

#[tauri::command]
pub async fn list_users(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    // usersInfo has no cursor form — the whole response (with its `users` array) comes back as
    // one document, same shape as `currentOp` in commands/server.rs. `forAllDBs: true` makes
    // this cluster-wide regardless of which db context we run it on.
    let resp = client
        .database("admin")
        .run_command(doc! { "usersInfo": 1, "forAllDBs": true })
        .await?;
    doc_to_canonical_string(resp)
}

#[tauri::command]
pub async fn create_user(
    session_id: String,
    db: String,
    username: String,
    password: String,
    roles: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    let roles_docs = parse_role_refs(&roles)?;
    client
        .database(&db)
        .run_command(doc! {
            "createUser": &username,
            "pwd": &password,
            "roles": roles_docs,
        })
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn update_user_roles(
    session_id: String,
    db: String,
    username: String,
    roles: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    let roles_docs = parse_role_refs(&roles)?;
    client
        .database(&db)
        .run_command(doc! {
            "updateUser": &username,
            "roles": roles_docs,
        })
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn change_user_password(
    session_id: String,
    db: String,
    username: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    // Separate command from update_user_roles: overwriting roles and changing a password are
    // independent operations, and this keeps the UI from ever needing to round-trip a password.
    client
        .database(&db)
        .run_command(doc! {
            "updateUser": &username,
            "pwd": &password,
        })
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn drop_user(
    session_id: String,
    db: String,
    username: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    client
        .database(&db)
        .run_command(doc! { "dropUser": &username })
        .await?;
    Ok(())
}

/// Parse a Canonical ExtJSON array of privilege documents (`{resource, actions}`).
fn parse_privileges(json: &str) -> Result<Vec<Document>, AppError> {
    canonical_string_to_doc_array(
        json,
        "privileges must be an array",
        "each privilege must be a document",
    )
}

#[tauri::command]
pub async fn list_roles(
    session_id: String,
    db: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    // Unlike usersInfo, rolesInfo has no forAllDBs flag — `db` is caller-supplied (defaults to
    // "admin" in the UI, but is a real editable field; see the design spec's Decisions section).
    let resp = client
        .database(&db)
        .run_command(doc! {
            "rolesInfo": 1,
            "showPrivileges": true,
            "showBuiltinRoles": true,
        })
        .await?;
    doc_to_canonical_string(resp)
}

#[tauri::command]
pub async fn create_role(
    session_id: String,
    db: String,
    role_name: String,
    privileges: String,
    roles: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    let priv_docs = parse_privileges(&privileges)?;
    let roles_docs = parse_role_refs(&roles)?;
    client
        .database(&db)
        .run_command(doc! {
            "createRole": &role_name,
            "privileges": priv_docs,
            "roles": roles_docs,
        })
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn update_role(
    session_id: String,
    db: String,
    role_name: String,
    privileges: String,
    roles: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    let priv_docs = parse_privileges(&privileges)?;
    let roles_docs = parse_role_refs(&roles)?;
    client
        .database(&db)
        .run_command(doc! {
            "updateRole": &role_name,
            "privileges": priv_docs,
            "roles": roles_docs,
        })
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn drop_role(
    session_id: String,
    db: String,
    role_name: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    client
        .database(&db)
        .run_command(doc! { "dropRole": &role_name })
        .await?;
    Ok(())
}
