//! Atlas Admin API browser: Service Account credentials in the credential store (or sealed by the
//! vault), project and cluster listings. The client secret goes in from the form once and is never
//! returned; the bearer token never leaves `atlas::AtlasClient`.
use crate::atlas::{AtlasClient, AtlasCluster, AtlasProject};
use crate::commands::connection::vault_ctx;
use crate::error::AppError;
use crate::proxy::ProxyConfig;
use crate::secrets::{self, AtlasSecretOutcome, OsKeychain};
use crate::vault::VaultSession;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

type ProxyKey = Option<(String, String, u16, String, String)>;

fn proxy_key(p: Option<&ProxyConfig>) -> ProxyKey {
    p.map(|p| (p.kind.clone(), p.host.clone(), p.port, p.user.clone(), p.password.clone()))
}

/// One client per Service Account for the app's lifetime, so its token cache survives between calls.
/// A client is rebuilt when the proxy it was built with changes, and every client (secret and token
/// included) is dropped when the vault is reset.
#[derive(Default)]
pub struct AtlasState {
    clients: Mutex<HashMap<String, (ProxyKey, Arc<AtlasClient>)>>,
}

impl AtlasState {
    fn get(&self, client_id: &str, proxy: Option<&ProxyConfig>) -> Option<Arc<AtlasClient>> {
        let g = self.clients.lock().ok()?;
        let (key, c) = g.get(client_id)?;
        (*key == proxy_key(proxy)).then(|| c.clone())
    }
    fn put(&self, client: Arc<AtlasClient>, proxy: Option<&ProxyConfig>) {
        if let Ok(mut g) = self.clients.lock() {
            g.insert(client.client_id().to_string(), (proxy_key(proxy), client));
        }
    }
    fn drop_client(&self, client_id: &str) {
        if let Ok(mut g) = self.clients.lock() {
            g.remove(client_id);
        }
    }
    /// Forgets every cached client (their secrets are zeroized once the last use ends).
    pub fn clear(&self) {
        if let Ok(mut g) = self.clients.lock() {
            g.clear();
        }
    }
}

fn check_client_id(client_id: &str) -> Result<(), AppError> {
    if client_id.trim().is_empty() || client_id.len() > 200 || client_id.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(AppError::Parse("invalid Service Account client ID".into()));
    }
    Ok(())
}

/// The client for `client_id`, reading the stored secret when none is cached yet.
fn client_for(
    app: &AppHandle,
    vault: &VaultSession,
    atlas: &AtlasState,
    client_id: &str,
    proxy: Option<&ProxyConfig>,
) -> Result<Arc<AtlasClient>, AppError> {
    check_client_id(client_id)?;
    if let Some(c) = atlas.get(client_id, proxy) {
        return Ok(c);
    }
    let ctx = vault_ctx(app, vault)?;
    let Some(secret) = secrets::atlas_secret_load(&OsKeychain, &ctx, client_id) else {
        return Err(if secrets::atlas_secret_exists(&OsKeychain, &ctx, client_id) {
            AppError::Vault("vault_locked".into())
        } else {
            AppError::Query("No client secret is stored for this Service Account".into())
        });
    };
    let client = Arc::new(AtlasClient::new(client_id, &secret, proxy)?);
    atlas.put(client.clone(), proxy);
    Ok(client)
}

/// Whether a client secret is stored for `client_id` (true for a sealed one even while the vault is locked).
#[tauri::command]
pub fn atlas_has_credentials(app: AppHandle, vault: State<'_, VaultSession>, client_id: String) -> Result<bool, AppError> {
    check_client_id(&client_id)?;
    Ok(secrets::atlas_secret_exists(&OsKeychain, &vault_ctx(&app, &vault)?, &client_id))
}

/// Checks the credentials against Atlas (a token request), then stores the secret. A wrong secret is
/// never stored. Returns where it ended up: `"keychain"` or `"vault"`. Without a credential store and with a
/// locked or missing vault the error is of kind `Vault` (`vault_locked` / `vault_uninitialized`).
#[tauri::command]
pub async fn atlas_save_credentials(
    app: AppHandle,
    vault: State<'_, VaultSession>,
    atlas: State<'_, AtlasState>,
    client_id: String,
    client_secret: String,
    proxy: Option<ProxyConfig>,
) -> Result<&'static str, AppError> {
    check_client_id(&client_id)?;
    let secret = zeroize::Zeroizing::new(client_secret);
    if secret.is_empty() {
        return Err(AppError::Parse("the client secret is empty".into()));
    }
    // Refuse early (before any network call) when the secret could not be stored.
    {
        let ctx = vault_ctx(&app, &vault)?;
        if !secrets::NamedSecretStore::named_available(&OsKeychain) && !ctx.session.is_unlocked() {
            return Err(AppError::Vault(match crate::vault::read_file(&ctx.path) {
                Ok(None) => "vault_uninitialized".into(),
                _ => "vault_locked".into(),
            }));
        }
    }
    let client = Arc::new(AtlasClient::new(&client_id, &secret, proxy.as_ref())?);
    client.token().await?;
    let outcome = secrets::atlas_secret_save(&OsKeychain, &vault_ctx(&app, &vault)?, &client_id, &secret)?;
    atlas.put(client, proxy.as_ref());
    Ok(match outcome {
        AtlasSecretOutcome::Keychain => "keychain",
        AtlasSecretOutcome::Vault => "vault",
    })
}

#[tauri::command]
pub fn atlas_forget_credentials(
    app: AppHandle,
    vault: State<'_, VaultSession>,
    atlas: State<'_, AtlasState>,
    client_id: String,
) -> Result<(), AppError> {
    check_client_id(&client_id)?;
    secrets::atlas_secret_forget(&OsKeychain, &vault_ctx(&app, &vault)?, &client_id);
    atlas.drop_client(&client_id);
    Ok(())
}

#[tauri::command]
pub async fn atlas_list_projects(
    app: AppHandle,
    vault: State<'_, VaultSession>,
    atlas: State<'_, AtlasState>,
    client_id: String,
    proxy: Option<ProxyConfig>,
) -> Result<Vec<AtlasProject>, AppError> {
    client_for(&app, &vault, &atlas, &client_id, proxy.as_ref())?.list_projects().await
}

#[tauri::command]
pub async fn atlas_list_clusters(
    app: AppHandle,
    vault: State<'_, VaultSession>,
    atlas: State<'_, AtlasState>,
    client_id: String,
    group_id: String,
    proxy: Option<ProxyConfig>,
) -> Result<Vec<AtlasCluster>, AppError> {
    client_for(&app, &vault, &atlas, &client_id, proxy.as_ref())?.list_clusters(&group_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_ids_with_whitespace_or_controls_are_refused() {
        assert!(check_client_id("mdb_sa_id_65f").is_ok());
        for bad in ["", "  ", "a b", "a\nb", &"x".repeat(201)] {
            assert!(check_client_id(bad).is_err(), "{bad:?}");
        }
    }

    fn proxy(host: &str) -> ProxyConfig {
        ProxyConfig { kind: "http".into(), host: host.into(), port: 8080, user: String::new(), password: String::new() }
    }

    #[test]
    fn cached_clients_are_rebuilt_when_the_proxy_changes_and_cleared_on_vault_reset() {
        let st = AtlasState::default();
        let direct = Arc::new(AtlasClient::new("id", "secret", None).unwrap());
        st.put(direct.clone(), None);
        assert!(Arc::ptr_eq(&st.get("id", None).unwrap(), &direct));
        assert!(st.get("id", Some(&proxy("p1"))).is_none(), "a different proxy needs a new client");
        let via = Arc::new(AtlasClient::new("id", "secret", Some(&proxy("p1"))).unwrap());
        st.put(via.clone(), Some(&proxy("p1")));
        assert!(Arc::ptr_eq(&st.get("id", Some(&proxy("p1"))).unwrap(), &via));
        assert!(st.get("id", Some(&proxy("p2"))).is_none());
        st.clear();
        assert!(st.get("id", Some(&proxy("p1"))).is_none() && st.get("id", None).is_none());
    }
}
