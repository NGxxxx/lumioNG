//! Atlas Search / Vector Search index management through the driver (`createSearchIndexes`,
//! `updateSearchIndex`, `dropSearchIndex`, `$listSearchIndexes`). Only Atlas (and Atlas Local)
//! serves these; a plain mongod answers with an error that the frontend recognizes and reports
//! as "not supported on this server".
use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
use crate::json_bson::canonical_string_to_doc;
use crate::state::AppState;
use futures::stream::TryStreamExt;
use mongodb::bson::{doc, Document};
use mongodb::{SearchIndexModel, SearchIndexType};
use tauri::State;

/// `"search"` / `"vectorSearch"` (the two server-defined types); `None` lets the server default to `search`.
fn parse_index_type(t: Option<&str>) -> Result<Option<SearchIndexType>, AppError> {
    match t.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some("search") => Ok(Some(SearchIndexType::Search)),
        Some("vectorSearch") => Ok(Some(SearchIndexType::VectorSearch)),
        Some(other) => Err(AppError::Parse(format!("unknown search index type '{}' (use 'search' or 'vectorSearch')", other.chars().take(40).collect::<String>()))),
    }
}

fn parse_definition(definition: &str) -> Result<Document, AppError> {
    let d = canonical_string_to_doc(definition)?;
    if d.is_empty() {
        return Err(AppError::Parse("the index definition is empty".into()));
    }
    Ok(d)
}

fn build_model(name: Option<String>, index_type: Option<&str>, definition: &str) -> Result<SearchIndexModel, AppError> {
    let name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    Ok(SearchIndexModel::builder().definition(parse_definition(definition)?).name(name).index_type(parse_index_type(index_type)?).build())
}

fn search_index_name(name: &str) -> Result<&str, AppError> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::Parse("a search index name is required".into()));
    }
    Ok(n)
}

async fn list_core(client: &mongodb::Client, db: &str, coll: &str) -> Result<Vec<String>, AppError> {
    let mut cursor = client.database(db).collection::<Document>(coll).list_search_indexes().await?;
    let mut out = Vec::new();
    while let Some(d) = cursor.try_next().await? {
        out.push(doc_to_canonical_string(d)?);
    }
    Ok(out)
}

async fn create_core(client: &mongodb::Client, db: &str, coll: &str, model: SearchIndexModel) -> Result<String, AppError> {
    Ok(client.database(db).collection::<Document>(coll).create_search_index(model).await?)
}

async fn update_core(client: &mongodb::Client, db: &str, coll: &str, name: String, definition: Document) -> Result<(), AppError> {
    client.database(db).collection::<Document>(coll).update_search_index(name, definition).await?;
    Ok(())
}

async fn drop_core(client: &mongodb::Client, db: &str, coll: &str, name: String) -> Result<(), AppError> {
    client.database(db).collection::<Document>(coll).drop_search_index(name).await?;
    Ok(())
}

/// Whether the server serves search indexes without being a named Atlas deployment (Atlas Local
/// has no `atlasVersion`): `$listSearchIndexes` on a collection that does not exist answers with an
/// empty list (or NamespaceNotFound) there, and with "only allowed on MongoDB Atlas" / "unrecognized
/// stage" on a plain mongod. Any other failure (auth, network) counts as "no".
async fn search_capable(client: &mongodb::Client) -> bool {
    match list_core(client, "local", "__lumio_search_probe").await {
        Ok(_) => true,
        Err(AppError::Server { code, .. }) => code == 26,
        Err(_) => false,
    }
}

/// `Some(version)` when the server is Atlas (`atlasVersion` answers; `"search"` for a server that
/// has no such command but serves search indexes, e.g. Atlas Local), `None` otherwise. A failure of
/// the probe itself is "not Atlas", never an error: the UI also checks the host name.
#[tauri::command]
pub async fn atlas_version(session_id: String, state: State<'_, AppState>) -> Result<Option<String>, AppError> {
    let client = state.client(&session_id).await?;
    if let Ok(r) = client.database("admin").run_command(doc! { "atlasVersion": 1 }).await {
        return Ok(Some(r.get_str("atlasVersion").unwrap_or("").to_string()));
    }
    Ok(search_capable(&client).await.then(|| "search".to_string()))
}

/// The collection's search indexes (`$listSearchIndexes`), one canonical ExtJSON document each.
#[tauri::command]
pub async fn list_search_indexes(session_id: String, db: String, coll: String, state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
    let client = state.client(&session_id).await?;
    list_core(&client, &db, &coll).await
}

/// Creates a search index and returns its name. `index_type` is `"search"` or `"vectorSearch"`;
/// `definition` is the index definition (`{ mappings: … }` or `{ fields: [ … ] }`) as ExtJSON.
#[tauri::command]
pub async fn create_search_index(
    session_id: String,
    db: String,
    coll: String,
    name: Option<String>,
    index_type: Option<String>,
    definition: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.writable_client(&session_id).await?;
    let model = build_model(name, index_type.as_deref(), &definition)?;
    state
        .audited(&session_id, crate::audit::SOURCE_UI, "create_search_index", &format!("{db}.{coll}"), None, |_| None, async {
            create_core(&client, &db, &coll, model).await
        })
        .await
}

#[tauri::command]
pub async fn update_search_index(
    session_id: String,
    db: String,
    coll: String,
    name: String,
    definition: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.writable_client(&session_id).await?;
    let name = search_index_name(&name)?.to_string();
    let definition = parse_definition(&definition)?;
    state
        .audited(&session_id, crate::audit::SOURCE_UI, "update_search_index", &format!("{db}.{coll}"), None, |_| None, async {
            update_core(&client, &db, &coll, name, definition).await
        })
        .await
}

#[tauri::command]
pub async fn drop_search_index(session_id: String, db: String, coll: String, name: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let client = state.writable_client(&session_id).await?;
    let name = search_index_name(&name)?.to_string();
    state
        .audited(&session_id, crate::audit::SOURCE_UI, "drop_search_index", &format!("{db}.{coll}"), None, |_| None, async {
            drop_core(&client, &db, &coll, name).await
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_types_are_limited_to_the_two_server_types() {
        assert!(matches!(parse_index_type(None), Ok(None)));
        assert!(matches!(parse_index_type(Some(" ")), Ok(None)));
        assert!(matches!(parse_index_type(Some("search")), Ok(Some(SearchIndexType::Search))));
        assert!(matches!(parse_index_type(Some("vectorSearch")), Ok(Some(SearchIndexType::VectorSearch))));
        assert!(parse_index_type(Some("graph")).is_err());
    }

    #[test]
    fn model_carries_trimmed_name_type_and_definition() {
        let m = build_model(Some("  default ".into()), Some("search"), r#"{"mappings":{"dynamic":true}}"#).unwrap();
        assert_eq!(m.name.as_deref(), Some("default"));
        assert_eq!(m.definition, doc! { "mappings": { "dynamic": true } });
        assert!(matches!(m.index_type, Some(SearchIndexType::Search)));
        assert_eq!(build_model(Some("".into()), None, r#"{"a":1}"#).unwrap().name, None);
    }

    #[test]
    fn bad_definitions_are_refused_before_any_server_call() {
        assert!(build_model(None, None, "{").is_err());
        assert!(build_model(None, None, "{}").is_err());
        assert!(build_model(None, None, "[1]").is_err());
        assert!(search_index_name("  ").is_err());
        assert_eq!(search_index_name(" vec ").unwrap(), "vec");
    }

    /// Search index CRUD against a real Atlas deployment or `mongodb/mongodb-atlas-local`.
    /// `LUMIO_ATLAS_LOCAL_URI=mongodb://localhost:27019/?directConnection=true cargo test atlas_local -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn atlas_local_search_index_crud() {
        let uri = std::env::var("LUMIO_ATLAS_LOCAL_URI").expect("set LUMIO_ATLAS_LOCAL_URI");
        let client = mongodb::Client::with_uri_str(&uri).await.unwrap();
        let (db, coll) = ("lumio_search_it", "docs");
        client.database(db).collection::<Document>(coll).drop().await.unwrap();
        client.database(db).create_collection(coll).await.unwrap();
        client.database(db).collection::<Document>(coll).insert_one(doc! { "title": "hello", "embedding": [0.1, 0.2, 0.3] }).await.unwrap();

        assert!(search_capable(&client).await, "Atlas Local must be detected as search capable");

        let wait_listed = |name: &'static str, present: bool| {
            let client = client.clone();
            async move {
                for _ in 0..60 {
                    let rows = list_core(&client, db, coll).await.unwrap();
                    if rows.iter().any(|r| r.contains(&format!("\"name\":\"{name}\""))) == present {
                        return rows;
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
                panic!("search index {name} never became {}", if present { "visible" } else { "absent" });
            }
        };

        let m = build_model(Some("dyn".into()), Some("search"), r#"{"mappings":{"dynamic":true}}"#).unwrap();
        assert_eq!(create_core(&client, db, coll, m).await.unwrap(), "dyn");
        let vm = build_model(Some("vec".into()), Some("vectorSearch"), r#"{"fields":[{"type":"vector","path":"embedding","numDimensions":3,"similarity":"cosine"}]}"#).unwrap();
        assert_eq!(create_core(&client, db, coll, vm).await.unwrap(), "vec");
        let rows = wait_listed("vec", true).await;
        println!("{rows:#?}");

        update_core(&client, db, coll, "dyn".into(), parse_definition(r#"{"mappings":{"dynamic":false,"fields":{"title":{"type":"string"}}}}"#).unwrap()).await.unwrap();
        for _ in 0..60 {
            let rows = list_core(&client, db, coll).await.unwrap();
            if rows.iter().any(|r| r.contains("\"dynamic\":false")) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
        assert!(list_core(&client, db, coll).await.unwrap().iter().any(|r| r.contains("\"dynamic\":false")), "update was not applied");

        drop_core(&client, db, coll, "dyn".into()).await.unwrap();
        drop_core(&client, db, coll, "vec".into()).await.unwrap();
        wait_listed("dyn", false).await;
        wait_listed("vec", false).await;
        client.database(db).drop().await.unwrap();
    }

    /// A plain mongod must answer in a way the UI recognizes as "not supported".
    /// `LUMIO_PLAIN_MONGO_URI=mongodb://localhost:27017/?directConnection=true cargo test plain_mongod -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn plain_mongod_reports_search_indexes_as_unsupported() {
        let uri = std::env::var("LUMIO_PLAIN_MONGO_URI").expect("set LUMIO_PLAIN_MONGO_URI");
        let client = mongodb::Client::with_uri_str(&uri).await.unwrap();
        let e = list_core(&client, "lumio_search_it", "docs").await.unwrap_err();
        println!("plain mongod says: {e}");
        let probe = client.database("admin").run_command(doc! { "atlasVersion": 1 }).await;
        assert!(probe.is_err(), "atlasVersion must fail on a plain server");
        assert!(!search_capable(&client).await, "a plain server is not search capable");
    }
}
