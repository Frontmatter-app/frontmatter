use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyMetricsRow {
    pub uid: String,
    pub date: String,
    pub edits: i32,
    pub writing_time_seconds: i32,
    pub hourly_buckets: String,
    pub focus_sessions_total: i32,
    pub focus_sessions_avg_min: i32,
    pub avg_wpm: i32,
    pub peak_wpm: i32,
    pub wpm_sample_count: i32,
    pub words_written: i32,
    pub issues_resolved: i32,
}

#[derive(Debug, Deserialize)]
pub struct GetMetricsDateRangeArgs {
    pub uid: String,
    pub start_date: String,
    pub end_date: String,
}

#[derive(Debug, Deserialize)]
pub struct SaveDailyMetricsArgs {
    pub uid: String,
    pub date: String,
    pub edits: i32,
    pub writing_time_seconds: i32,
    pub hourly_buckets: String,
    pub focus_sessions_total: i32,
    pub focus_sessions_avg_min: i32,
    pub avg_wpm: i32,
    pub peak_wpm: i32,
    pub wpm_sample_count: i32,
    pub words_written: i32,
    pub issues_resolved: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocHealthRow {
    pub date: String,
    pub documents: i32,
    pub words: i32,
    pub stale_docs: i32,
    pub broken_links: i32,
    pub missing_alt_text: i32,
    pub empty_sections: i32,
    pub unclosed_fences: i32,
    pub undefined_acronyms: i32,
    pub hard_sentences: i32,
    pub passives: i32,
    pub inclusive_issues: i32,
    pub median_grade: i32,
    pub docs_over_grade_target: i32,
    pub review_open: i32,
    pub review_resolved: i32,
    pub oldest_open_review_days: i32,
    pub defects: i32,
}

#[derive(Debug, Deserialize)]
pub struct SaveDocHealthArgs {
    pub snapshot: DocHealthRow,
}

#[derive(Debug, Deserialize)]
pub struct GetDocHealthRangeArgs {
    pub start_date: String,
    pub end_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewBacklogRow {
    pub open: i32,
    pub resolved: i32,
    pub oldest_open_days: i32,
}

#[tauri::command]
pub async fn get_metrics_date_range(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    args: GetMetricsDateRangeArgs,
) -> Result<Vec<DailyMetricsRow>, String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;
    let path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };
    let pool = match db_guard.get(path) {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };

    let rows = sqlx::query(
        r#"
        SELECT uid, date, edits, writing_time_seconds, hourly_buckets,
               focus_sessions_total, focus_sessions_avg_min,
               avg_wpm, peak_wpm, wpm_sample_count,
               words_written, issues_resolved
        FROM metrics_daily
        WHERE uid = ?1 AND date >= ?2 AND date <= ?3
        ORDER BY date ASC
        "#,
    )
    .bind(&args.uid)
    .bind(&args.start_date)
    .bind(&args.end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        result.push(DailyMetricsRow {
            uid: row.get("uid"),
            date: row.get("date"),
            edits: row.get("edits"),
            writing_time_seconds: row.get("writing_time_seconds"),
            hourly_buckets: row.get("hourly_buckets"),
            focus_sessions_total: row.get("focus_sessions_total"),
            focus_sessions_avg_min: row.get("focus_sessions_avg_min"),
            avg_wpm: row.get("avg_wpm"),
            peak_wpm: row.get("peak_wpm"),
            wpm_sample_count: row.get("wpm_sample_count"),
            words_written: row.get("words_written"),
            issues_resolved: row.get("issues_resolved"),
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn save_daily_metrics(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    args: SaveDailyMetricsArgs,
) -> Result<(), String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;
    let path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Ok(()),
    };
    let pool = match db_guard.get(path) {
        Some(p) => p,
        None => return Ok(()),
    };

    // Every column is an absolute value the caller has already reconciled
    // against what it read, so every column is replaced.
    //
    // `wpm_sample_count` used to accumulate here — `= metrics_daily.wpm_sample_count
    // + excluded.wpm_sample_count` — while the caller sent its running total
    // rather than a delta. The count therefore grew by the whole history on
    // every flush, and since the caller rewrote all 170 stored days each time,
    // it did that to every row at once. Average WPM is weighted by this count,
    // so the average froze within a few minutes of typing: the denominator was
    // growing geometrically and no new sample could move it.
    sqlx::query(
        r#"
        INSERT INTO metrics_daily (
            uid, date, edits, writing_time_seconds, hourly_buckets,
            focus_sessions_total, focus_sessions_avg_min,
            avg_wpm, peak_wpm, wpm_sample_count,
            words_written, issues_resolved, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        ON CONFLICT(uid, date) DO UPDATE SET
            edits = excluded.edits,
            writing_time_seconds = excluded.writing_time_seconds,
            hourly_buckets = excluded.hourly_buckets,
            focus_sessions_total = excluded.focus_sessions_total,
            focus_sessions_avg_min = excluded.focus_sessions_avg_min,
            avg_wpm = excluded.avg_wpm,
            peak_wpm = MAX(metrics_daily.peak_wpm, excluded.peak_wpm),
            wpm_sample_count = excluded.wpm_sample_count,
            words_written = excluded.words_written,
            issues_resolved = excluded.issues_resolved,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&args.uid)
    .bind(&args.date)
    .bind(args.edits)
    .bind(args.writing_time_seconds)
    .bind(&args.hourly_buckets)
    .bind(args.focus_sessions_total)
    .bind(args.focus_sessions_avg_min)
    .bind(args.avg_wpm)
    .bind(args.peak_wpm)
    .bind(args.wpm_sample_count)
    .bind(args.words_written)
    .bind(args.issues_resolved)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn save_doc_health_daily(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    args: SaveDocHealthArgs,
) -> Result<(), String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;
    let path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Ok(()),
    };
    let pool = match db_guard.get(path) {
        Some(p) => p,
        None => return Ok(()),
    };

    let s = &args.snapshot;
    sqlx::query(
        r#"
        INSERT INTO doc_health_daily (
            date, documents, words, stale_docs, broken_links, missing_alt_text,
            empty_sections, unclosed_fences, undefined_acronyms, hard_sentences,
            passives, inclusive_issues, median_grade, docs_over_grade_target,
            review_open, review_resolved, oldest_open_review_days, defects, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
        ON CONFLICT(date) DO UPDATE SET
            documents = excluded.documents,
            words = excluded.words,
            stale_docs = excluded.stale_docs,
            broken_links = excluded.broken_links,
            missing_alt_text = excluded.missing_alt_text,
            empty_sections = excluded.empty_sections,
            unclosed_fences = excluded.unclosed_fences,
            undefined_acronyms = excluded.undefined_acronyms,
            hard_sentences = excluded.hard_sentences,
            passives = excluded.passives,
            inclusive_issues = excluded.inclusive_issues,
            median_grade = excluded.median_grade,
            docs_over_grade_target = excluded.docs_over_grade_target,
            review_open = excluded.review_open,
            review_resolved = excluded.review_resolved,
            oldest_open_review_days = excluded.oldest_open_review_days,
            defects = excluded.defects,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&s.date)
    .bind(s.documents)
    .bind(s.words)
    .bind(s.stale_docs)
    .bind(s.broken_links)
    .bind(s.missing_alt_text)
    .bind(s.empty_sections)
    .bind(s.unclosed_fences)
    .bind(s.undefined_acronyms)
    .bind(s.hard_sentences)
    .bind(s.passives)
    .bind(s.inclusive_issues)
    .bind(s.median_grade)
    .bind(s.docs_over_grade_target)
    .bind(s.review_open)
    .bind(s.review_resolved)
    .bind(s.oldest_open_review_days)
    .bind(s.defects)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_doc_health_range(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
    args: GetDocHealthRangeArgs,
) -> Result<Vec<DocHealthRow>, String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;
    let path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };
    let pool = match db_guard.get(path) {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };

    let rows = sqlx::query(
        r#"
        SELECT date, documents, words, stale_docs, broken_links, missing_alt_text,
               empty_sections, unclosed_fences, undefined_acronyms, hard_sentences,
               passives, inclusive_issues, median_grade, docs_over_grade_target,
               review_open, review_resolved, oldest_open_review_days, defects
        FROM doc_health_daily
        WHERE date >= ?1 AND date <= ?2
        ORDER BY date ASC
        "#,
    )
    .bind(&args.start_date)
    .bind(&args.end_date)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        result.push(DocHealthRow {
            date: row.get("date"),
            documents: row.get("documents"),
            words: row.get("words"),
            stale_docs: row.get("stale_docs"),
            broken_links: row.get("broken_links"),
            missing_alt_text: row.get("missing_alt_text"),
            empty_sections: row.get("empty_sections"),
            unclosed_fences: row.get("unclosed_fences"),
            undefined_acronyms: row.get("undefined_acronyms"),
            hard_sentences: row.get("hard_sentences"),
            passives: row.get("passives"),
            inclusive_issues: row.get("inclusive_issues"),
            median_grade: row.get("median_grade"),
            docs_over_grade_target: row.get("docs_over_grade_target"),
            review_open: row.get("review_open"),
            review_resolved: row.get("review_resolved"),
            oldest_open_review_days: row.get("oldest_open_review_days"),
            defects: row.get("defects"),
        });
    }

    Ok(result)
}

/// The review queue across every document at once.
///
/// The frontend could only ask for annotations one document at a time, so a
/// workspace-wide backlog meant a round trip per document on every open of the
/// dashboard. This is three aggregates in one query.
#[tauri::command]
pub async fn get_review_backlog(
    window: tauri::Window,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ReviewBacklogRow, String> {
    let label = window.label();
    let db_guard = state.dbs.lock().await;
    let ws_guard = state.window_workspaces.lock().await;
    let empty = ReviewBacklogRow { open: 0, resolved: 0, oldest_open_days: 0 };
    let path = match ws_guard.get(label) {
        Some(p) => p,
        None => return Ok(empty),
    };
    let pool = match db_guard.get(path) {
        Some(p) => p,
        None => return Ok(empty),
    };

    let row = sqlx::query(
        r#"
        SELECT
            COALESCE(SUM(CASE WHEN resolved = 0 THEN 1 ELSE 0 END), 0) AS open_count,
            COALESCE(SUM(CASE WHEN resolved != 0 THEN 1 ELSE 0 END), 0) AS resolved_count,
            COALESCE(
                CAST(MAX(
                    CASE WHEN resolved = 0
                    THEN julianday('now') - julianday(created_at)
                    ELSE 0 END
                ) AS INTEGER), 0
            ) AS oldest_open_days
        FROM annotations
        "#,
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(ReviewBacklogRow {
        open: row.get::<i64, _>("open_count") as i32,
        resolved: row.get::<i64, _>("resolved_count") as i32,
        oldest_open_days: row.get::<i64, _>("oldest_open_days") as i32,
    })
}
