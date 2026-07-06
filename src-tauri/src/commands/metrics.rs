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
               avg_wpm, peak_wpm, wpm_sample_count
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

    sqlx::query(
        r#"
        INSERT INTO metrics_daily (
            uid, date, edits, writing_time_seconds, hourly_buckets,
            focus_sessions_total, focus_sessions_avg_min,
            avg_wpm, peak_wpm, wpm_sample_count, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(uid, date) DO UPDATE SET
            edits = excluded.edits,
            writing_time_seconds = excluded.writing_time_seconds,
            hourly_buckets = excluded.hourly_buckets,
            focus_sessions_total = excluded.focus_sessions_total,
            focus_sessions_avg_min = excluded.focus_sessions_avg_min,
            avg_wpm = excluded.avg_wpm,
            peak_wpm = MAX(metrics_daily.peak_wpm, excluded.peak_wpm),
            wpm_sample_count = metrics_daily.wpm_sample_count + excluded.wpm_sample_count,
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
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}
