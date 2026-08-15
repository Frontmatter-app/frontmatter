pub const WORKSPACE_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS workspace_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    file_path TEXT,
    stage TEXT NOT NULL DEFAULT 'write',
    focus_mode INTEGER NOT NULL DEFAULT 0,
    cloud_id TEXT,
    cloud_synced INTEGER NOT NULL DEFAULT 0,
    cloud_path TEXT,
    offline_enabled INTEGER NOT NULL DEFAULT 0,
    last_cloud_sync TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_versions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    snapshot BLOB NOT NULL,
    created_at TEXT NOT NULL,
    label TEXT,
    word_count INTEGER,
    author TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    start_pos TEXT NOT NULL,
    end_pos TEXT NOT NULL,
    selected_text TEXT NOT NULL,
    note TEXT NOT NULL,
    author_id TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    replies TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS draft_nodes (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    level INTEGER NOT NULL,
    title TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS collaborators (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
    id TEXT PRIMARY KEY,
    last_synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_index (
    path TEXT PRIMARY KEY,
    file_hash TEXT NOT NULL,
    last_modified TEXT NOT NULL,
    document_id TEXT,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS metrics_daily (
    uid TEXT NOT NULL,
    date TEXT NOT NULL,
    edits INTEGER NOT NULL DEFAULT 0,
    writing_time_seconds INTEGER NOT NULL DEFAULT 0,
    hourly_buckets TEXT NOT NULL DEFAULT '[]',
    focus_sessions_total INTEGER NOT NULL DEFAULT 0,
    focus_sessions_avg_min INTEGER NOT NULL DEFAULT 0,
    avg_wpm INTEGER NOT NULL DEFAULT 0,
    peak_wpm INTEGER NOT NULL DEFAULT 0,
    wpm_sample_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (uid, date)
);

-- One row per workspace per day: what the documentation set looked like that
-- day. Keyed by workspace rather than by author, because a stale page or a
-- broken link belongs to the docs, not to whoever last touched them.
CREATE TABLE IF NOT EXISTS doc_health_daily (
    date TEXT PRIMARY KEY,
    documents INTEGER NOT NULL DEFAULT 0,
    words INTEGER NOT NULL DEFAULT 0,
    stale_docs INTEGER NOT NULL DEFAULT 0,
    broken_links INTEGER NOT NULL DEFAULT 0,
    missing_alt_text INTEGER NOT NULL DEFAULT 0,
    empty_sections INTEGER NOT NULL DEFAULT 0,
    unclosed_fences INTEGER NOT NULL DEFAULT 0,
    undefined_acronyms INTEGER NOT NULL DEFAULT 0,
    hard_sentences INTEGER NOT NULL DEFAULT 0,
    passives INTEGER NOT NULL DEFAULT 0,
    inclusive_issues INTEGER NOT NULL DEFAULT 0,
    median_grade INTEGER NOT NULL DEFAULT 0,
    docs_over_grade_target INTEGER NOT NULL DEFAULT 0,
    review_open INTEGER NOT NULL DEFAULT 0,
    review_resolved INTEGER NOT NULL DEFAULT 0,
    oldest_open_review_days INTEGER NOT NULL DEFAULT 0,
    defects INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS objects (
    uuid TEXT PRIMARY KEY,
    object_type TEXT NOT NULL,
    name TEXT NOT NULL,
    document_path TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    start_col INTEGER NOT NULL DEFAULT 0,
    end_col INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outputs (
    uuid TEXT PRIMARY KEY,
    parent_object_uuid TEXT NOT NULL,
    output_type TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    file_path TEXT,
    content TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(parent_object_uuid) REFERENCES objects(uuid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS doc_references (
    id TEXT PRIMARY KEY,
    document_path TEXT NOT NULL,
    line INTEGER NOT NULL,
    col INTEGER NOT NULL,
    object_uuid TEXT,
    output_uuid TEXT,
    marker_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(object_uuid) REFERENCES objects(uuid) ON DELETE SET NULL,
    FOREIGN KEY(output_uuid) REFERENCES outputs(uuid) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS runtime_settings (
    id TEXT PRIMARY KEY,
    language TEXT NOT NULL,
    runtime_type TEXT NOT NULL DEFAULT 'system',
    executable_path TEXT NOT NULL,
    managed_path TEXT,
    version TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transclusion_hashes (
    uuid TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"#;

use sqlx::{Row, SqlitePool};

pub async fn migrate_database(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(WORKSPACE_SCHEMA).execute(pool).await?;

    let rows = sqlx::query("PRAGMA table_info(documents)").fetch_all(pool).await?;
    let mut flags = [false; 7];
    for row in &rows {
        if let Ok(name) = row.try_get::<String, _>("name") {
            match name.as_str() {
                "content" => flags[0] = true, "focus_mode" => flags[1] = true,
                "cloud_id" => flags[2] = true, "cloud_synced" => flags[3] = true,
                "cloud_path" => flags[4] = true, "offline_enabled" => flags[5] = true,
                "last_cloud_sync" => flags[6] = true, _ => {}
            }
        }
    }
    let cols = [
        "content TEXT NOT NULL DEFAULT ''", "focus_mode INTEGER NOT NULL DEFAULT 0",
        "cloud_id TEXT", "cloud_synced INTEGER NOT NULL DEFAULT 0",
        "cloud_path TEXT", "offline_enabled INTEGER NOT NULL DEFAULT 0",
        "last_cloud_sync TEXT",
    ];
    for (i, col) in cols.iter().enumerate() {
        if !flags[i] { sqlx::query(&format!("ALTER TABLE documents ADD COLUMN {col}")).execute(pool).await?; }
    }

    let vrows = sqlx::query("PRAGMA table_info(document_versions)").fetch_all(pool).await?;
    let mut vflags = [false; 3];
    for row in &vrows {
        if let Ok(name) = row.try_get::<String, _>("name") {
            match name.as_str() {
                "label" => vflags[0] = true, "word_count" => vflags[1] = true, "author" => vflags[2] = true, _ => {}
            }
        }
    }
    let vcols = ["label TEXT", "word_count INTEGER", "author TEXT"];
    for (i, col) in vcols.iter().enumerate() {
        if !vflags[i] { sqlx::query(&format!("ALTER TABLE document_versions ADD COLUMN {col}")).execute(pool).await?; }
    }

    // New columns on documents: word_count, excerpt, file_created_at
    let drows = sqlx::query("PRAGMA table_info(documents)").fetch_all(pool).await?;
    let mut dflags = [false; 3];
    for row in &drows {
        if let Ok(name) = row.try_get::<String, _>("name") {
            match name.as_str() {
                "word_count" => dflags[0] = true,
                "excerpt" => dflags[1] = true,
                "file_created_at" => dflags[2] = true,
                _ => {}
            }
        }
    }
    let dcols = [
        "word_count INTEGER NOT NULL DEFAULT 0",
        "excerpt TEXT",
        "file_created_at TEXT",
    ];
    for (i, col) in dcols.iter().enumerate() {
        if !dflags[i] { sqlx::query(&format!("ALTER TABLE documents ADD COLUMN {col}")).execute(pool).await?; }
    }

    // Replies on annotations. They lived only in the Yjs document before, so a
    // local file lost every reply the moment the document was reloaded.
    let arows = sqlx::query("PRAGMA table_info(annotations)").fetch_all(pool).await?;
    let has_replies = arows.iter().any(|row| {
        row.try_get::<String, _>("name").map(|name| name == "replies").unwrap_or(false)
    });
    if !has_replies {
        sqlx::query("ALTER TABLE annotations ADD COLUMN replies TEXT NOT NULL DEFAULT '[]'")
            .execute(pool)
            .await?;
    }

    // Net words and fixed prose issues per day. The edit counter next to them
    // counts Yjs change events, which is a number about the editor rather than
    // about the writing; these two are the ones that mean something on their
    // own.
    let mrows = sqlx::query("PRAGMA table_info(metrics_daily)").fetch_all(pool).await?;
    let mut mflags = [false; 2];
    for row in &mrows {
        if let Ok(name) = row.try_get::<String, _>("name") {
            match name.as_str() {
                "words_written" => mflags[0] = true,
                "issues_resolved" => mflags[1] = true,
                _ => {}
            }
        }
    }
    let mcols = [
        "words_written INTEGER NOT NULL DEFAULT 0",
        "issues_resolved INTEGER NOT NULL DEFAULT 0",
    ];
    for (i, col) in mcols.iter().enumerate() {
        if !mflags[i] { sqlx::query(&format!("ALTER TABLE metrics_daily ADD COLUMN {col}")).execute(pool).await?; }
    }

    // Focus sessions table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS focus_sessions (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            words_written INTEGER NOT NULL DEFAULT 0,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
        )"
    ).execute(pool).await?;

    Ok(())
}
