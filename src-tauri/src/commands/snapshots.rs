use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;

const MAX_SNAPSHOTS: i32 = 50;

#[derive(Serialize, Deserialize, Clone)]
pub struct SnapshotMeta {
    pub id: String,
    pub document_id: String,
    pub created_at: String,
    pub label: Option<String>,
    pub word_count: Option<i32>,
    pub author: Option<String>,
}

#[tauri::command]
pub async fn save_snapshot(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    document_id: String,
    snapshot: Vec<u8>,
    label: Option<String>,
    word_count: Option<i32>,
    author: Option<String>,
) -> Result<SnapshotMeta, String> {
    let label_str = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;

    let path = ws_guard
        .get(label_str)
        .ok_or("No workspace open for this window")?;
    let pool = db_guard
        .get(path)
        .ok_or("No database pool for this workspace")?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO document_versions (id, document_id, snapshot, created_at, label, word_count, author) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&document_id)
    .bind(&snapshot)
    .bind(&now)
    .bind(&label)
    .bind(&word_count)
    .bind(&author)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    drop((db_guard, ws_guard));
    prune_old_snapshots(&window, &state, &document_id).await?;

    Ok(SnapshotMeta {
        id,
        document_id,
        created_at: now,
        label,
        word_count,
        author,
    })
}

async fn prune_old_snapshots(
    window: &tauri::Window,
    state: &State<'_, crate::AppState>,
    document_id: &str,
) -> Result<(), String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;

    let path = ws_guard
        .get(label)
        .ok_or("No workspace open for this window")?;
    let pool = db_guard
        .get(path)
        .ok_or("No database pool for this workspace")?;

    prune_in_pool(pool, document_id).await
}

/// Drops the oldest automatic snapshots once a document has more than the cap.
///
/// A labelled version is one a person deliberately created, so it is neither
/// counted against the cap nor eligible for eviction. Counting the two kinds
/// together meant a few minutes of typing evicted every named checkpoint in the
/// document, which is the one thing history is for.
///
/// Split from the command so it can be exercised against a pool directly.
async fn prune_in_pool(pool: &sqlx::SqlitePool, document_id: &str) -> Result<(), String> {
    let count: i32 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM document_versions WHERE document_id = ? AND label IS NULL",
    )
    .bind(document_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    if count > MAX_SNAPSHOTS {
        let excess = count - MAX_SNAPSHOTS;
        let rows = sqlx::query("SELECT id FROM document_versions WHERE document_id = ? AND label IS NULL ORDER BY created_at ASC LIMIT ?")
            .bind(document_id)
            .bind(excess)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

        for row in rows {
            let old_id: String = row.get("id");
            sqlx::query("DELETE FROM document_versions WHERE id = ?")
                .bind(&old_id)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_snapshots(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    document_id: String,
) -> Result<Vec<SnapshotMeta>, String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;

    let path = ws_guard
        .get(label)
        .ok_or("No workspace open for this window")?;
    let pool = db_guard
        .get(path)
        .ok_or("No database pool for this workspace")?;

    let rows = sqlx::query("SELECT id, document_id, created_at, label, word_count, author FROM document_versions WHERE document_id = ? ORDER BY created_at DESC")
        .bind(document_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut metas = Vec::new();
    for row in rows {
        metas.push(SnapshotMeta {
            id: row.get::<Option<String>, _>("id").unwrap_or_default(),
            document_id: row
                .get::<Option<String>, _>("document_id")
                .unwrap_or_default(),
            created_at: row
                .get::<Option<String>, _>("created_at")
                .unwrap_or_default(),
            label: row.get("label"),
            word_count: row.get("word_count"),
            author: row.get("author"),
        });
    }

    Ok(metas)
}

#[tauri::command]
pub async fn get_snapshot_data(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    id: String,
) -> Result<Vec<u8>, String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;

    let path = ws_guard
        .get(label)
        .ok_or("No workspace open for this window")?;
    let pool = db_guard
        .get(path)
        .ok_or("No database pool for this workspace")?;

    let row = sqlx::query("SELECT snapshot FROM document_versions WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(row.get("snapshot"))
}

#[tauri::command]
pub async fn delete_snapshot(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    id: String,
) -> Result<(), String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;

    let path = ws_guard
        .get(label)
        .ok_or("No workspace open for this window")?;
    let pool = db_guard
        .get(path)
        .ok_or("No database pool for this workspace")?;

    sqlx::query("DELETE FROM document_versions WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn clear_document_history(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    document_id: String,
) -> Result<(), String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;

    let path = ws_guard
        .get(label)
        .ok_or("No workspace open for this window")?;
    let pool = db_guard
        .get(path)
        .ok_or("No database pool for this workspace")?;

    sqlx::query("DELETE FROM document_versions WHERE document_id = ?")
        .bind(document_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn create_snapshot(
    window: tauri::Window,
    state: State<'_, crate::AppState>,
    document_id: String,
    snapshot: Vec<u8>,
    label: Option<String>,
    word_count: Option<i32>,
    author: Option<String>,
) -> Result<SnapshotMeta, String> {
    save_snapshot(window, state, document_id, snapshot, label, word_count, author).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool_with_schema() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .expect("in-memory database");
        for statement in crate::schema::WORKSPACE_SCHEMA.split(';') {
            if statement.trim().is_empty() {
                continue;
            }
            sqlx::query(statement).execute(&pool).await.expect("schema");
        }
        // `document_versions` has a foreign key onto `documents`.
        for id in ["doc1", "doc2"] {
            sqlx::query("INSERT INTO documents (id, title, created_at, updated_at) VALUES (?, 'T', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')")
                .bind(id)
                .execute(&pool)
                .await
                .expect("seed document");
        }
        pool
    }

    /// `created_at` is the pruning order, so it has to be distinct and ascending.
    async fn insert(pool: &sqlx::SqlitePool, id: &str, seq: u32, label: Option<&str>) {
        sqlx::query(
            "INSERT INTO document_versions (id, document_id, snapshot, created_at, label) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind("doc1")
        .bind(Vec::<u8>::new())
        .bind(format!("2026-01-01T00:00:{:02}Z", seq))
        .bind(label)
        .execute(pool)
        .await
        .expect("insert");
    }

    async fn ids(pool: &sqlx::SqlitePool) -> Vec<String> {
        sqlx::query_scalar("SELECT id FROM document_versions ORDER BY created_at ASC")
            .fetch_all(pool)
            .await
            .expect("select")
    }

    #[tokio::test]
    async fn keeps_everything_below_the_cap() {
        let pool = pool_with_schema().await;
        for seq in 0..10 {
            insert(&pool, &format!("auto{}", seq), seq, None).await;
        }

        prune_in_pool(&pool, "doc1").await.expect("prune");

        assert_eq!(ids(&pool).await.len(), 10);
    }

    #[tokio::test]
    async fn drops_the_oldest_automatic_snapshots_over_the_cap() {
        let pool = pool_with_schema().await;
        let total = (MAX_SNAPSHOTS + 5) as u32;
        for seq in 0..total {
            insert(&pool, &format!("auto{}", seq), seq, None).await;
        }

        prune_in_pool(&pool, "doc1").await.expect("prune");

        let remaining = ids(&pool).await;
        assert_eq!(remaining.len(), MAX_SNAPSHOTS as usize);
        assert_eq!(remaining[0], "auto5");
    }

    #[tokio::test]
    async fn never_evicts_a_named_checkpoint() {
        // The reported failure: automatic snapshots counted against the same cap
        // and were pruned oldest-first, so a checkpoint created at the start of a
        // session was the first thing deleted.
        let pool = pool_with_schema().await;
        insert(&pool, "checkpoint", 0, Some("before the rewrite")).await;
        for seq in 1..(MAX_SNAPSHOTS as u32 + 20) {
            insert(&pool, &format!("auto{}", seq), seq, None).await;
        }

        prune_in_pool(&pool, "doc1").await.expect("prune");

        let remaining = ids(&pool).await;
        assert!(remaining.contains(&"checkpoint".to_string()));
        // The checkpoint is exempt, so the cap applies to the automatic ones alone.
        assert_eq!(remaining.len(), MAX_SNAPSHOTS as usize + 1);
    }

    #[tokio::test]
    async fn an_unnamed_checkpoint_is_still_a_checkpoint() {
        // Creating one and declining to name it sends an empty label, not null.
        let pool = pool_with_schema().await;
        insert(&pool, "checkpoint", 0, Some("")).await;
        for seq in 1..(MAX_SNAPSHOTS as u32 + 20) {
            insert(&pool, &format!("auto{}", seq), seq, None).await;
        }

        prune_in_pool(&pool, "doc1").await.expect("prune");

        assert!(ids(&pool).await.contains(&"checkpoint".to_string()));
    }

    #[tokio::test]
    async fn leaves_other_documents_alone() {
        let pool = pool_with_schema().await;
        for seq in 0..(MAX_SNAPSHOTS as u32 + 5) {
            insert(&pool, &format!("auto{}", seq), seq, None).await;
        }
        sqlx::query("INSERT INTO document_versions (id, document_id, snapshot, created_at) VALUES ('other', 'doc2', ?, '2026-01-01T00:00:00Z')")
            .bind(Vec::<u8>::new())
            .execute(&pool)
            .await
            .expect("insert");

        prune_in_pool(&pool, "doc1").await.expect("prune");

        assert!(ids(&pool).await.contains(&"other".to_string()));
    }
}
