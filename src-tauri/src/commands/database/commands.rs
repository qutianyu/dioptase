use std::collections::HashMap;
use std::sync::Mutex;
use sqlx::{Row, Column};
use tauri::State;
use crate::commands::database::types::*;
use crate::commands::database::storage::*;

pub struct DbState {
    pub mysql: Mutex<HashMap<String, sqlx::MySqlPool>>,
    pub postgres: Mutex<HashMap<String, sqlx::PgPool>>,
    pub sqlite: Mutex<HashMap<String, sqlx::SqlitePool>>,
    pub redis: Mutex<HashMap<String, redis::Client>>,
    pub redis_databases: Mutex<HashMap<String, u8>>,
}

#[tauri::command]
pub async fn test_db_connection(db_type: DbType) -> Result<bool, String> {
    match &db_type {
        DbType::Redis(_) => {
            let url = db_type.build_url()?;
            let client = redis::Client::open(url.as_str()).map_err(|e| format!("Invalid connection: {}", e))?;
            let mut conn = client.get_multiplexed_async_connection().await.map_err(|e| format!("Connection failed: {}", e))?;
            redis::cmd("PING").query_async::<String>(&mut conn).await.map_err(|e| format!("PING failed: {}", e))?;
            Ok(true)
        }
        DbType::MySQL(_) => {
            let url = db_type.build_url()?;
            match sqlx::MySqlPool::connect(&url).await {
                Ok(pool) => { pool.close().await; Ok(true) }
                Err(e) => Err(format!("Connection failed: {}", e)),
            }
        }
        DbType::PostgreSQL(_) => {
            let url = db_type.build_url()?;
            match sqlx::PgPool::connect(&url).await {
                Ok(pool) => { pool.close().await; Ok(true) }
                Err(e) => Err(format!("Connection failed: {}", e)),
            }
        }
        DbType::SQLite(_) => {
            let url = db_type.build_url()?;
            match sqlx::SqlitePool::connect(&url).await {
                Ok(pool) => { pool.close().await; Ok(true) }
                Err(e) => Err(format!("Connection failed: {}", e)),
            }
        }
    }
}

#[tauri::command]
pub async fn save_db_connection(
    name: String,
    db_type: DbType,
    color: Option<String>,
) -> Result<SavedConnection, String> {
    let mut connections = load_connections()?;
    let id = uuid::Uuid::new_v4().to_string();
    let conn = SavedConnection {
        id,
        name,
        db_type,
        color: color.unwrap_or_default(),
    };
    connections.push(conn.clone());
    save_connections(&connections)?;
    Ok(conn)
}

#[tauri::command]
pub async fn update_db_connection(
    id: String,
    name: String,
    db_type: DbType,
    color: Option<String>,
    state: State<'_, DbState>,
) -> Result<SavedConnection, String> {
    let mut connections = load_connections()?;
    let index = connections
        .iter()
        .position(|c| c.id == id)
        .ok_or("Connection not found")?;

    let conn = SavedConnection {
        id: id.clone(),
        name,
        db_type,
        color: color.unwrap_or_default(),
    };
    connections[index] = conn.clone();
    save_connections(&connections)?;

    let mysql_pool = { state.mysql.lock().unwrap().remove(&id) };
    let postgres_pool = { state.postgres.lock().unwrap().remove(&id) };
    let sqlite_pool = { state.sqlite.lock().unwrap().remove(&id) };
    if let Some(pool) = mysql_pool { pool.close().await; }
    if let Some(pool) = postgres_pool { pool.close().await; }
    if let Some(pool) = sqlite_pool { pool.close().await; }
    state.redis.lock().unwrap().remove(&id);
    state.redis_databases.lock().unwrap().remove(&id);

    Ok(conn)
}

#[tauri::command]
pub fn list_db_connections() -> Result<Vec<SavedConnection>, String> {
    load_connections()
}

#[tauri::command]
pub fn list_connected_db_ids(state: State<'_, DbState>) -> Vec<String> {
    let mysql_ids: Vec<String> = state.mysql.lock().unwrap().keys().cloned().collect();
    let postgres_ids: Vec<String> = state.postgres.lock().unwrap().keys().cloned().collect();
    let sqlite_ids: Vec<String> = state.sqlite.lock().unwrap().keys().cloned().collect();
    let redis_ids: Vec<String> = state.redis.lock().unwrap().keys().cloned().collect();
    let mut ids = mysql_ids;
    ids.extend(postgres_ids);
    ids.extend(sqlite_ids);
    ids.extend(redis_ids);
    ids
}

#[tauri::command]
pub fn delete_db_connection(id: String) -> Result<(), String> {
    let mut connections = load_connections()?;
    connections.retain(|c| c.id != id);
    save_connections(&connections)?;
    Ok(())
}

#[tauri::command]
pub async fn connect_db(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let connections = load_connections()?;
    let conn = connections.iter().find(|c| c.id == id)
        .ok_or("Connection not found")?;

    match &conn.db_type {
        DbType::Redis(_config) => {
            let mut db_type = conn.db_type.clone();
            if let DbType::Redis(config) = &mut db_type {
                config.database = 0;
            }
            let url = db_type.build_url()?;
            let client = redis::Client::open(url.as_str()).map_err(|e| format!("Invalid URL: {}", e))?;
            let mut rconn = client.get_multiplexed_async_connection().await.map_err(|e| format!("Connection failed: {}", e))?;
            redis::cmd("PING").query_async::<String>(&mut rconn).await.map_err(|e| format!("PING failed: {}", e))?;
            state.redis.lock().unwrap().insert(id.clone(), client);
            state.redis_databases.lock().unwrap().insert(id, 0);
            Ok(())
        }
        DbType::MySQL(_) => {
            let url = conn.db_type.build_url()?;
            let pool = sqlx::MySqlPool::connect(&url).await
                .map_err(|e| format!("Connection failed: {}", e))?;
            state.mysql.lock().unwrap().insert(id, pool);
            Ok(())
        }
        DbType::PostgreSQL(_) => {
            let url = conn.db_type.build_url()?;
            let pool = sqlx::PgPool::connect(&url).await
                .map_err(|e| format!("Connection failed: {}", e))?;
            state.postgres.lock().unwrap().insert(id, pool);
            Ok(())
        }
        DbType::SQLite(_) => {
            let url = conn.db_type.build_url()?;
            let pool = sqlx::SqlitePool::connect(&url).await
                .map_err(|e| format!("Connection failed: {}", e))?;
            state.sqlite.lock().unwrap().insert(id, pool);
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn disconnect_db(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let mysql_pool = { state.mysql.lock().unwrap().remove(&id) };
    let postgres_pool = { state.postgres.lock().unwrap().remove(&id) };
    let sqlite_pool = { state.sqlite.lock().unwrap().remove(&id) };
    if let Some(pool) = mysql_pool { pool.close().await; }
    if let Some(pool) = postgres_pool { pool.close().await; }
    if let Some(pool) = sqlite_pool { pool.close().await; }
    state.redis.lock().unwrap().remove(&id);
    state.redis_databases.lock().unwrap().remove(&id);
    Ok(())
}

fn extract_mysql_row_values(row: &sqlx::mysql::MySqlRow, columns: &[String]) -> Vec<Option<String>> {
    columns
        .iter()
        .map(|col| {
            let name = col.as_str();
            if let Ok(v) = row.try_get::<Option<String>, &str>(name) {
                v
            } else if let Ok(v) = row.try_get::<Option<i64>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<u64>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<i32>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<u32>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<f64>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<f32>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<bool>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<chrono::NaiveDateTime>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<chrono::NaiveDate>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<chrono::NaiveTime>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<Vec<u8>>, &str>(name) {
                v.map(|bytes| String::from_utf8_lossy(&bytes).to_string())
            } else {
                None
            }
        })
        .collect()
}

fn extract_pg_row_values(row: &sqlx::postgres::PgRow, columns: &[String]) -> Vec<Option<String>> {
    columns
        .iter()
        .map(|col| {
            let name = col.as_str();
            if let Ok(v) = row.try_get::<Option<String>, &str>(name) {
                v
            } else if let Ok(v) = row.try_get::<Option<i64>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<i32>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<f64>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<f32>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<bool>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<chrono::NaiveDateTime>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<chrono::NaiveDate>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<chrono::NaiveTime>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<Vec<u8>>, &str>(name) {
                v.map(|bytes| String::from_utf8_lossy(&bytes).to_string())
            } else {
                None
            }
        })
        .collect()
}

fn extract_sqlite_row_values(row: &sqlx::sqlite::SqliteRow, columns: &[String]) -> Vec<Option<String>> {
    columns
        .iter()
        .map(|col| {
            let name = col.as_str();
            if let Ok(v) = row.try_get::<Option<String>, &str>(name) {
                v
            } else if let Ok(v) = row.try_get::<Option<i64>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<i32>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<f64>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<bool>, &str>(name) {
                v.map(|value| value.to_string())
            } else if let Ok(v) = row.try_get::<Option<Vec<u8>>, &str>(name) {
                v.map(|bytes| String::from_utf8_lossy(&bytes).to_string())
            } else {
                None
            }
        })
        .collect()
}

fn mysql_result(rows: Vec<sqlx::mysql::MySqlRow>, elapsed: u64) -> QueryResult {
    if rows.is_empty() {
        return QueryResult { columns: Vec::new(), rows: Vec::new(), affected_rows: 0, execution_time_ms: elapsed };
    }
    let columns: Vec<String> = rows.first().unwrap().columns().iter().map(|c| c.name().to_string()).collect();
    let rows_data: Vec<Vec<Option<String>>> = rows.iter().map(|row| extract_mysql_row_values(row, &columns)).collect();
    QueryResult { affected_rows: rows_data.len() as u64, columns, rows: rows_data, execution_time_ms: elapsed }
}

fn pg_result(rows: Vec<sqlx::postgres::PgRow>, elapsed: u64) -> QueryResult {
    if rows.is_empty() {
        return QueryResult { columns: Vec::new(), rows: Vec::new(), affected_rows: 0, execution_time_ms: elapsed };
    }
    let columns: Vec<String> = rows.first().unwrap().columns().iter().map(|c| c.name().to_string()).collect();
    let rows_data: Vec<Vec<Option<String>>> = rows.iter().map(|row| extract_pg_row_values(row, &columns)).collect();
    QueryResult { affected_rows: rows_data.len() as u64, columns, rows: rows_data, execution_time_ms: elapsed }
}

fn sqlite_result(rows: Vec<sqlx::sqlite::SqliteRow>, elapsed: u64) -> QueryResult {
    if rows.is_empty() {
        return QueryResult { columns: Vec::new(), rows: Vec::new(), affected_rows: 0, execution_time_ms: elapsed };
    }
    let columns: Vec<String> = rows.first().unwrap().columns().iter().map(|c| c.name().to_string()).collect();
    let rows_data: Vec<Vec<Option<String>>> = rows.iter().map(|row| extract_sqlite_row_values(row, &columns)).collect();
    QueryResult { affected_rows: rows_data.len() as u64, columns, rows: rows_data, execution_time_ms: elapsed }
}

fn quote_mysql_ident(value: &str) -> String {
    format!("`{}`", value.replace('`', "``"))
}

fn quote_sql_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn quote_pg_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn quote_sqlite_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn escaped_pg_literal(value: &str) -> String {
    value.replace('\'', "''")
}

fn qualify_mysql_query(query: &str, database: &str) -> String {
    let tokens: Vec<&str> = query.split_whitespace().collect();
    if tokens.is_empty() {
        return query.to_string();
    }

    let mut result = query.to_string();
    for index in 0..tokens.len().saturating_sub(1) {
        let keyword = tokens[index].trim_matches(|c: char| !c.is_alphanumeric()).to_ascii_lowercase();
        if keyword != "from" && keyword != "join" && keyword != "update" && keyword != "into" {
            continue;
        }

        let table = tokens[index + 1].trim_matches(|c| c == '`' || c == ',' || c == ';');
        if table.is_empty() || table.starts_with('(') || table.starts_with('?') {
            continue;
        }

        let qualified = if let Some((db, table_name)) = table.split_once('.') {
            format!(
                "{}.{}",
                quote_mysql_ident(db.trim_matches('`')),
                quote_mysql_ident(table_name.trim_matches('`'))
            )
        } else {
            format!("{}.{}", quote_mysql_ident(database), quote_mysql_ident(table))
        };
        result = result.replacen(tokens[index + 1], &qualified, 1);
    }
    result
}

#[tauri::command]
pub async fn execute_db_query(
    id: String,
    query: String,
    database: Option<String>,
    state: State<'_, DbState>,
) -> Result<QueryResult, String> {
    let conn_meta = get_connection_meta(&id)?;
    let start = std::time::Instant::now();
    match &conn_meta.db_type {
        DbType::MySQL(config) => {
            let db = database.filter(|db| !db.trim().is_empty());
            let sql = if let Some(db) = db.as_ref() { qualify_mysql_query(&query, db) } else { query };
            let pool = if let Some(db) = db {
                let mut scoped_config = config.clone();
                scoped_config.database = db;
                let scoped_type = DbType::MySQL(scoped_config);
                let url = scoped_type.build_url()?;
                sqlx::MySqlPool::connect(&url).await.map_err(|e| format!("Connection failed: {}", e))?
            } else {
                state.mysql.lock().unwrap().get(&id).ok_or("Connection not established")?.clone()
            };
            let rows = sqlx::query(&sql).fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            let result = mysql_result(rows, start.elapsed().as_millis() as u64);
            if !state.mysql.lock().unwrap().contains_key(&id) {
                pool.close().await;
            }
            Ok(result)
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let rows = sqlx::query(&query).fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            Ok(pg_result(rows, start.elapsed().as_millis() as u64))
        }
        DbType::SQLite(_) => {
            let pool = state.sqlite.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let rows = sqlx::query(&query).fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            Ok(sqlite_result(rows, start.elapsed().as_millis() as u64))
        }
        DbType::Redis(_) => Err("Redis uses redis_execute".to_string()),
    }
}

fn get_connection_meta(id: &str) -> Result<SavedConnection, String> {
    let connections = load_connections()?;
    connections.into_iter().find(|c| c.id == id)
        .ok_or_else(|| "Connection not found".to_string())
}

#[tauri::command]
pub async fn list_databases(
    id: String,
    state: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let conn = get_connection_meta(&id)?;

    match &conn.db_type {
        DbType::MySQL(_) => {
            let pool = state.mysql.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let rows = sqlx::query("SHOW DATABASES")
                .fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            Ok(rows.iter().filter_map(|r| r.try_get::<String, _>(0).ok()).collect())
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let rows = sqlx::query("SELECT datname FROM pg_database WHERE datistemplate = false")
                .fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            Ok(rows.iter().filter_map(|r| r.try_get::<String, _>("datname").ok()).collect())
        }
        DbType::SQLite(_) => {
            Ok(vec!["main".to_string()])
        }
        DbType::Redis(_) => {
            Ok(vec!["<redis>".to_string()])
        }
    }
}

#[tauri::command]
pub async fn list_tables(
    id: String,
    database: String,
    state: State<'_, DbState>,
) -> Result<Vec<TableInfo>, String> {
    let conn = get_connection_meta(&id)?;

    match &conn.db_type {
        DbType::MySQL(_) => {
            let pool = state.mysql.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let q = format!(
                "SELECT TABLE_NAME, TABLE_TYPE, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = {} ORDER BY TABLE_NAME",
                quote_sql_literal(&database)
            );
            let rows = sqlx::query(&q)
                .fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            Ok(rows.iter().filter_map(|r| {
                let name = r.try_get::<String, _>("TABLE_NAME").ok()?;
                let table_type = r.try_get::<String, _>("TABLE_TYPE").ok()
                    .map(|tt| if tt.contains("VIEW") { "view".to_string() } else { "table".to_string() })
                    .unwrap_or_else(|| "table".to_string());
                let comment = r.try_get::<Option<String>, _>("TABLE_COMMENT").ok().flatten().filter(|c| !c.is_empty());
                Some(TableInfo { name, table_type, comment })
            }).collect())
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let q = format!(
                "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = '{}' ORDER BY table_name",
                database
            );
            let rows = sqlx::query(&q)
                .fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            Ok(rows.iter().filter_map(|r| {
                let name = r.try_get::<String, _>("table_name").ok()?;
                let tt = r.try_get::<String, _>("table_type").unwrap_or_else(|_| "BASE TABLE".into());
                Some(TableInfo { name, table_type: if tt.contains("VIEW") { "view".into() } else { "table".into() }, comment: None })
            }).collect())
        }
        DbType::SQLite(_) => {
            let pool = state.sqlite.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let rows = sqlx::query("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
                .fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            Ok(rows.iter().filter_map(|r| {
                let name = r.try_get::<String, _>("name").ok()?;
                let tt = r.try_get::<String, _>("type").ok()?;
                Some(TableInfo { name, table_type: tt, comment: None })
            }).collect())
        }
        DbType::Redis(_) => Err("Redis does not support tables".to_string()),
    }
}

#[tauri::command]
pub async fn list_columns(
    id: String,
    database: String,
    table: String,
    state: State<'_, DbState>,
) -> Result<Vec<ColumnInfo>, String> {
    let conn = get_connection_meta(&id)?;

    match &conn.db_type {
        DbType::MySQL(_) => {
            let pool = state.mysql.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let q = format!(
                "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = {} AND TABLE_NAME = {} ORDER BY ORDINAL_POSITION",
                quote_sql_literal(&database),
                quote_sql_literal(&table)
            );
            let rows = sqlx::query(&q)
                .fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            Ok(rows.iter().filter_map(|r| {
                let name = r.try_get::<String, _>("COLUMN_NAME").ok()?;
                let data_type = r.try_get::<String, _>("COLUMN_TYPE").unwrap_or_default();
                let nullable = r.try_get::<String, _>("IS_NULLABLE").unwrap_or_else(|_| "YES".into()) == "YES";
                let default = r.try_get::<Option<String>, _>("COLUMN_DEFAULT").ok().flatten();
                let key = r.try_get::<String, _>("COLUMN_KEY").unwrap_or_default();
                let comment = r.try_get::<Option<String>, _>("COLUMN_COMMENT").ok().flatten().filter(|c| !c.is_empty());
                Some(ColumnInfo { name, data_type, nullable, default_value: default, is_primary_key: key == "PRI", comment })
            }).collect())
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let q = format!(
                "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = '{}' AND table_name = '{}' ORDER BY ordinal_position",
                database, table
            );
            let rows = sqlx::query(&q)
                .fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            let pk_q = format!(
                "SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = '{}.{}'::regclass AND i.indisprimary",
                database, table
            );
            let pk_rows = sqlx::query(&pk_q)
                .fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            let pks: Vec<String> = pk_rows.iter().filter_map(|r| r.try_get::<String, _>("attname").ok()).collect();
            Ok(rows.iter().filter_map(|r| {
                let name = r.try_get::<String, _>("column_name").ok()?;
                let data_type = r.try_get::<String, _>("data_type").unwrap_or_default();
                let nullable = r.try_get::<String, _>("is_nullable").unwrap_or_else(|_| "YES".into()) == "YES";
                let default = r.try_get::<Option<String>, _>("column_default").ok().flatten();
                Some(ColumnInfo { is_primary_key: pks.contains(&name), name, data_type, nullable, default_value: default, comment: None })
            }).collect())
        }
        DbType::SQLite(_) => {
            let pool = state.sqlite.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let q = format!("PRAGMA table_info(\"{}\")", table);
            let rows = sqlx::query(&q)
                .fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            Ok(rows.iter().filter_map(|r| {
                let name = r.try_get::<String, _>("name").ok()?;
                let data_type = r.try_get::<String, _>("type").unwrap_or_default();
                let nullable = r.try_get::<i32, _>("notnull").unwrap_or(0) == 0;
                let default = r.try_get::<Option<String>, _>("dflt_value").ok().flatten();
                let pk = r.try_get::<i32, _>("pk").unwrap_or(0) == 1;
                Some(ColumnInfo { name, data_type, nullable, default_value: default, is_primary_key: pk, comment: None })
            }).collect())
        }
        DbType::Redis(_) => Err("Redis does not support columns".to_string()),
    }
}

#[tauri::command]
pub async fn get_table_data(
    id: String,
    database: String,
    table: String,
    page: u32,
    page_size: u32,
    state: State<'_, DbState>,
) -> Result<QueryResult, String> {
    let conn = get_connection_meta(&id)?;

    let offset = page * page_size;
    let q = match &conn.db_type {
        DbType::MySQL(_) => format!(
            "SELECT * FROM {}.{} LIMIT {} OFFSET {}",
            quote_mysql_ident(&database),
            quote_mysql_ident(&table),
            page_size,
            offset
        ),
        DbType::PostgreSQL(_) => format!("SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}", database, table, page_size, offset),
        DbType::SQLite(_) => format!("SELECT * FROM \"{}\" LIMIT {} OFFSET {}", table, page_size, offset),
        DbType::Redis(_) => return Err("Redis does not support table data".to_string()),
    };

    let start = std::time::Instant::now();
    match &conn.db_type {
        DbType::MySQL(_) => {
            let pool = state.mysql.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let rows = sqlx::query(&q).fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            Ok(mysql_result(rows, start.elapsed().as_millis() as u64))
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let rows = sqlx::query(&q).fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            Ok(pg_result(rows, start.elapsed().as_millis() as u64))
        }
        DbType::SQLite(_) => {
            let pool = state.sqlite.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let rows = sqlx::query(&q).fetch_all(&pool).await.map_err(|e| format!("Query error: {}", e))?;
            Ok(sqlite_result(rows, start.elapsed().as_millis() as u64))
        }
        DbType::Redis(_) => Err("Redis does not support table data".to_string()),
    }
}

#[tauri::command]
pub async fn update_table_cell(
    id: String,
    database: String,
    table: String,
    column: String,
    value: Option<String>,
    pk_values: HashMap<String, String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    if pk_values.is_empty() {
        return Err("Cannot update without a primary key".to_string());
    }

    let conn = get_connection_meta(&id)?;
    match &conn.db_type {
        DbType::MySQL(_) => {
            let pool = state.mysql.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let mut sql = format!(
                "UPDATE {}.{} SET {} = ? WHERE ",
                quote_mysql_ident(&database),
                quote_mysql_ident(&table),
                quote_mysql_ident(&column)
            );
            let predicates: Vec<String> = pk_values.keys().map(|key| format!("{} = ?", quote_mysql_ident(key))).collect();
            sql.push_str(&predicates.join(" AND "));
            let mut query = sqlx::query(&sql).bind(value);
            for key in pk_values.keys() {
                query = query.bind(pk_values.get(key).cloned().unwrap_or_default());
            }
            query.execute(&pool).await.map_err(|e| format!("Update error: {}", e))?;
            Ok(())
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let mut sql = format!(
                "UPDATE {}.{} SET {} = $1 WHERE ",
                quote_pg_ident(&database),
                quote_pg_ident(&table),
                quote_pg_ident(&column)
            );
            let predicates: Vec<String> = pk_values
                .keys()
                .enumerate()
                .map(|(index, key)| format!("{} = ${}", quote_pg_ident(key), index + 2))
                .collect();
            sql.push_str(&predicates.join(" AND "));
            let mut query = sqlx::query(&sql).bind(value);
            for key in pk_values.keys() {
                query = query.bind(pk_values.get(key).cloned().unwrap_or_default());
            }
            query.execute(&pool).await.map_err(|e| format!("Update error: {}", e))?;
            Ok(())
        }
        DbType::SQLite(_) => {
            let pool = state.sqlite.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let mut sql = format!(
                "UPDATE {} SET {} = ? WHERE ",
                quote_sqlite_ident(&table),
                quote_sqlite_ident(&column)
            );
            let predicates: Vec<String> = pk_values.keys().map(|key| format!("{} = ?", quote_sqlite_ident(key))).collect();
            sql.push_str(&predicates.join(" AND "));
            let mut query = sqlx::query(&sql).bind(value);
            for key in pk_values.keys() {
                query = query.bind(pk_values.get(key).cloned().unwrap_or_default());
            }
            query.execute(&pool).await.map_err(|e| format!("Update error: {}", e))?;
            Ok(())
        }
        DbType::Redis(_) => Err("Redis does not support table cell updates".to_string()),
    }
}

#[tauri::command]
pub async fn get_database_info(
    id: String,
    database: String,
    state: State<'_, DbState>,
) -> Result<DatabaseInfo, String> {
    let conn = get_connection_meta(&id)?;

    match &conn.db_type {
        DbType::MySQL(_) => {
            let pool = state.mysql.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let schema = sqlx::query(
                "SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?"
            )
                .bind(&database)
                .fetch_optional(&pool)
                .await
                .map_err(|e| format!("Query error: {}", e))?;
            let stats = sqlx::query(
                "SELECT COUNT(*) AS table_count, COALESCE(SUM(DATA_LENGTH + INDEX_LENGTH), 0) AS size_bytes FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?"
            )
                .bind(&database)
                .fetch_one(&pool)
                .await
                .map_err(|e| format!("Query error: {}", e))?;
            Ok(DatabaseInfo {
                name: database,
                table_count: stats.try_get::<i64, _>("table_count").unwrap_or(0).max(0) as u64,
                size_bytes: stats.try_get::<Option<i64>, _>("size_bytes").ok().flatten().unwrap_or(0).max(0) as u64,
                default_charset: schema.as_ref().and_then(|r| r.try_get::<Option<String>, _>("DEFAULT_CHARACTER_SET_NAME").ok().flatten()),
                default_collation: schema.as_ref().and_then(|r| r.try_get::<Option<String>, _>("DEFAULT_COLLATION_NAME").ok().flatten()),
                extras: Vec::new(),
            })
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let stats = sqlx::query(
                "SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = $1"
            )
                .bind(&database)
                .fetch_one(&pool)
                .await
                .map_err(|e| format!("Query error: {}", e))?;
            Ok(DatabaseInfo {
                name: database,
                table_count: stats.try_get::<i64, _>("table_count").unwrap_or(0).max(0) as u64,
                size_bytes: 0,
                default_charset: None,
                default_collation: None,
                extras: Vec::new(),
            })
        }
        DbType::SQLite(_) => {
            let pool = state.sqlite.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let stats = sqlx::query("SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type IN ('table', 'view')")
                .fetch_one(&pool)
                .await
                .map_err(|e| format!("Query error: {}", e))?;
            Ok(DatabaseInfo {
                name: database,
                table_count: stats.try_get::<i64, _>("table_count").unwrap_or(0).max(0) as u64,
                size_bytes: 0,
                default_charset: None,
                default_collation: None,
                extras: Vec::new(),
            })
        }
        DbType::Redis(_) => Err("Redis does not support database properties".to_string()),
    }
}

#[tauri::command]
pub async fn create_table(
    id: String,
    database: String,
    ddl: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = get_connection_meta(&id)?;
    match &conn.db_type {
        DbType::MySQL(config) => {
            let mut scoped_config = config.clone();
            scoped_config.database = database;
            let scoped_type = DbType::MySQL(scoped_config);
            let url = scoped_type.build_url()?;
            let pool = sqlx::MySqlPool::connect(&url).await.map_err(|e| format!("Connection failed: {}", e))?;
            sqlx::query(&ddl).execute(&pool).await.map_err(|e| format!("Create table error: {}", e))?;
            pool.close().await;
            Ok(())
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            sqlx::query(&ddl).execute(&pool).await.map_err(|e| format!("Create table error: {}", e))?;
            Ok(())
        }
        DbType::SQLite(_) => {
            let pool = state.sqlite.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            sqlx::query(&ddl).execute(&pool).await.map_err(|e| format!("Create table error: {}", e))?;
            Ok(())
        }
        DbType::Redis(_) => Err("Redis does not support tables".to_string()),
    }
}

#[tauri::command]
pub async fn get_table_detail(
    id: String,
    database: String,
    table: String,
    state: State<'_, DbState>,
) -> Result<TableDetailInfo, String> {
    let conn = get_connection_meta(&id)?;
    let columns = list_columns(id.clone(), database.clone(), table.clone(), state.clone()).await?;
    let rows = get_table_data(id.clone(), database.clone(), table.clone(), 0, 50, state.clone()).await?;

    match &conn.db_type {
        DbType::MySQL(_) => {
            let pool = state.mysql.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let meta = sqlx::query(
                "SELECT TABLE_TYPE, ENGINE, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?"
            )
                .bind(&database)
                .bind(&table)
                .fetch_optional(&pool)
                .await
                .map_err(|e| format!("Query error: {}", e))?;
            let ddl_row = sqlx::query(&format!("SHOW CREATE TABLE {}.{}", quote_mysql_ident(&database), quote_mysql_ident(&table)))
                .fetch_optional(&pool)
                .await
                .map_err(|e| format!("DDL error: {}", e))?;
            let ddl = ddl_row.and_then(|r| r.try_get::<String, _>(1).ok());
            let index_rows = sqlx::query(
                "SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX"
            )
                .bind(&database)
                .bind(&table)
                .fetch_all(&pool)
                .await
                .map_err(|e| format!("Index query error: {}", e))?;
            let mut grouped: HashMap<String, TableIndexInfo> = HashMap::new();
            for row in index_rows {
                let name = row.try_get::<String, _>("INDEX_NAME").unwrap_or_default();
                let column = row.try_get::<String, _>("COLUMN_NAME").unwrap_or_default();
                let non_unique = row.try_get::<i32, _>("NON_UNIQUE").unwrap_or(1);
                let index_type = row.try_get::<Option<String>, _>("INDEX_TYPE").ok().flatten();
                grouped.entry(name.clone()).or_insert(TableIndexInfo {
                    name,
                    columns: Vec::new(),
                    unique: non_unique == 0,
                    index_type,
                }).columns.push(column);
            }
            let mut indexes: Vec<TableIndexInfo> = grouped.into_values().collect();
            indexes.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(TableDetailInfo {
                database,
                table,
                table_type: meta.as_ref().and_then(|r| r.try_get::<String, _>("TABLE_TYPE").ok()).unwrap_or_else(|| "BASE TABLE".to_string()),
                engine: meta.as_ref().and_then(|r| r.try_get::<Option<String>, _>("ENGINE").ok().flatten()),
                row_count: meta.as_ref().and_then(|r| r.try_get::<Option<i64>, _>("TABLE_ROWS").ok().flatten()).map(|v| v.max(0) as u64),
                data_size_bytes: meta.as_ref().and_then(|r| r.try_get::<Option<i64>, _>("DATA_LENGTH").ok().flatten()).map(|v| v.max(0) as u64),
                index_size_bytes: meta.as_ref().and_then(|r| r.try_get::<Option<i64>, _>("INDEX_LENGTH").ok().flatten()).map(|v| v.max(0) as u64),
                ddl,
                columns,
                indexes,
                rows,
            })
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let qualified = format!("{}.{}", quote_pg_ident(&database), quote_pg_ident(&table));
            let count_row = sqlx::query(&format!("SELECT COUNT(*)::bigint AS row_count FROM {}", qualified))
                .fetch_optional(&pool)
                .await
                .map_err(|e| format!("Count error: {}", e))?;
            let idx_q = format!(
                "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = '{}'
                 AND tablename = '{}' ORDER BY indexname",
                escaped_pg_literal(&database),
                escaped_pg_literal(&table)
            );
            let idx_rows = sqlx::query(&idx_q).fetch_all(&pool).await.map_err(|e| format!("Index query error: {}", e))?;
            let indexes = idx_rows.iter().filter_map(|r| {
                let name = r.try_get::<String, _>("indexname").ok()?;
                let ddl = r.try_get::<String, _>("indexdef").unwrap_or_default();
                Some(TableIndexInfo { name, columns: vec![ddl], unique: false, index_type: None })
            }).collect();
            Ok(TableDetailInfo {
                database,
                table,
                table_type: "table".to_string(),
                engine: Some("PostgreSQL".to_string()),
                row_count: count_row.and_then(|r| r.try_get::<i64, _>("row_count").ok()).map(|v| v.max(0) as u64),
                data_size_bytes: None,
                index_size_bytes: None,
                ddl: None,
                columns,
                indexes,
                rows,
            })
        }
        DbType::SQLite(_) => {
            let pool = state.sqlite.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let ddl_row = sqlx::query("SELECT sql, type FROM sqlite_master WHERE name = ?")
                .bind(&table)
                .fetch_optional(&pool)
                .await
                .map_err(|e| format!("DDL error: {}", e))?;
            let count_row = sqlx::query(&format!("SELECT COUNT(*) AS row_count FROM {}", quote_sqlite_ident(&table)))
                .fetch_optional(&pool)
                .await
                .map_err(|e| format!("Count error: {}", e))?;
            let idx_rows = sqlx::query(&format!("PRAGMA index_list({})", quote_sqlite_ident(&table)))
                .fetch_all(&pool)
                .await
                .map_err(|e| format!("Index query error: {}", e))?;
            let indexes = idx_rows.iter().filter_map(|r| {
                let name = r.try_get::<String, _>("name").ok()?;
                let unique = r.try_get::<i32, _>("unique").unwrap_or(0) == 1;
                Some(TableIndexInfo { name, columns: Vec::new(), unique, index_type: None })
            }).collect();
            Ok(TableDetailInfo {
                database,
                table,
                table_type: ddl_row.as_ref().and_then(|r| r.try_get::<String, _>("type").ok()).unwrap_or_else(|| "table".to_string()),
                engine: Some("SQLite".to_string()),
                row_count: count_row.and_then(|r| r.try_get::<i64, _>("row_count").ok()).map(|v| v.max(0) as u64),
                data_size_bytes: None,
                index_size_bytes: None,
                ddl: ddl_row.and_then(|r| r.try_get::<Option<String>, _>("sql").ok().flatten()),
                columns,
                indexes,
                rows,
            })
        }
        DbType::Redis(_) => Err("Redis does not support table properties".to_string()),
    }
}

#[tauri::command]
pub async fn insert_table_row(
    id: String,
    database: String,
    table: String,
    values: HashMap<String, Option<String>>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    if values.is_empty() {
        return Err("No values to insert".to_string());
    }
    let conn = get_connection_meta(&id)?;
    let keys: Vec<String> = values.keys().cloned().collect();
    match &conn.db_type {
        DbType::MySQL(_) => {
            let pool = state.mysql.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let sql = format!(
                "INSERT INTO {}.{} ({}) VALUES ({})",
                quote_mysql_ident(&database),
                quote_mysql_ident(&table),
                keys.iter().map(|k| quote_mysql_ident(k)).collect::<Vec<_>>().join(", "),
                keys.iter().map(|_| "?").collect::<Vec<_>>().join(", ")
            );
            let mut q = sqlx::query(&sql);
            for key in &keys {
                q = q.bind(values.get(key).cloned().unwrap_or(None));
            }
            q.execute(&pool).await.map_err(|e| format!("Insert error: {}", e))?;
            Ok(())
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let sql = format!(
                "INSERT INTO {}.{} ({}) VALUES ({})",
                quote_pg_ident(&database),
                quote_pg_ident(&table),
                keys.iter().map(|k| quote_pg_ident(k)).collect::<Vec<_>>().join(", "),
                keys.iter().enumerate().map(|(i, _)| format!("${}", i + 1)).collect::<Vec<_>>().join(", ")
            );
            let mut q = sqlx::query(&sql);
            for key in &keys {
                q = q.bind(values.get(key).cloned().unwrap_or(None));
            }
            q.execute(&pool).await.map_err(|e| format!("Insert error: {}", e))?;
            Ok(())
        }
        DbType::SQLite(_) => {
            let pool = state.sqlite.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let sql = format!(
                "INSERT INTO {} ({}) VALUES ({})",
                quote_sqlite_ident(&table),
                keys.iter().map(|k| quote_sqlite_ident(k)).collect::<Vec<_>>().join(", "),
                keys.iter().map(|_| "?").collect::<Vec<_>>().join(", ")
            );
            let mut q = sqlx::query(&sql);
            for key in &keys {
                q = q.bind(values.get(key).cloned().unwrap_or(None));
            }
            q.execute(&pool).await.map_err(|e| format!("Insert error: {}", e))?;
            Ok(())
        }
        DbType::Redis(_) => Err("Redis does not support table rows".to_string()),
    }
}

#[tauri::command]
pub async fn delete_table_row(
    id: String,
    database: String,
    table: String,
    pk_values: HashMap<String, String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    if pk_values.is_empty() {
        return Err("Cannot delete without a primary key".to_string());
    }
    let conn = get_connection_meta(&id)?;
    match &conn.db_type {
        DbType::MySQL(_) => {
            let pool = state.mysql.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let predicates: Vec<String> = pk_values.keys().map(|key| format!("{} = ?", quote_mysql_ident(key))).collect();
            let sql = format!("DELETE FROM {}.{} WHERE {}", quote_mysql_ident(&database), quote_mysql_ident(&table), predicates.join(" AND "));
            let mut q = sqlx::query(&sql);
            for key in pk_values.keys() { q = q.bind(pk_values.get(key).cloned().unwrap_or_default()); }
            q.execute(&pool).await.map_err(|e| format!("Delete error: {}", e))?;
            Ok(())
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let predicates: Vec<String> = pk_values.keys().enumerate().map(|(i, key)| format!("{} = ${}", quote_pg_ident(key), i + 1)).collect();
            let sql = format!("DELETE FROM {}.{} WHERE {}", quote_pg_ident(&database), quote_pg_ident(&table), predicates.join(" AND "));
            let mut q = sqlx::query(&sql);
            for key in pk_values.keys() { q = q.bind(pk_values.get(key).cloned().unwrap_or_default()); }
            q.execute(&pool).await.map_err(|e| format!("Delete error: {}", e))?;
            Ok(())
        }
        DbType::SQLite(_) => {
            let pool = state.sqlite.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let predicates: Vec<String> = pk_values.keys().map(|key| format!("{} = ?", quote_sqlite_ident(key))).collect();
            let sql = format!("DELETE FROM {} WHERE {}", quote_sqlite_ident(&table), predicates.join(" AND "));
            let mut q = sqlx::query(&sql);
            for key in pk_values.keys() { q = q.bind(pk_values.get(key).cloned().unwrap_or_default()); }
            q.execute(&pool).await.map_err(|e| format!("Delete error: {}", e))?;
            Ok(())
        }
        DbType::Redis(_) => Err("Redis does not support table rows".to_string()),
    }
}

#[tauri::command]
pub async fn create_table_index(
    id: String,
    database: String,
    table: String,
    index_name: String,
    columns: Vec<String>,
    unique: bool,
    state: State<'_, DbState>,
) -> Result<(), String> {
    if index_name.trim().is_empty() || columns.is_empty() {
        return Err("Index name and columns are required".to_string());
    }
    let conn = get_connection_meta(&id)?;
    match &conn.db_type {
        DbType::MySQL(_) => {
            let pool = state.mysql.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let sql = format!(
                "CREATE {} INDEX {} ON {}.{} ({})",
                if unique { "UNIQUE" } else { "" },
                quote_mysql_ident(&index_name),
                quote_mysql_ident(&database),
                quote_mysql_ident(&table),
                columns.iter().map(|c| quote_mysql_ident(c)).collect::<Vec<_>>().join(", ")
            );
            sqlx::query(&sql).execute(&pool).await.map_err(|e| format!("Create index error: {}", e))?;
            Ok(())
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let sql = format!(
                "CREATE {} INDEX {} ON {}.{} ({})",
                if unique { "UNIQUE" } else { "" },
                quote_pg_ident(&index_name),
                quote_pg_ident(&database),
                quote_pg_ident(&table),
                columns.iter().map(|c| quote_pg_ident(c)).collect::<Vec<_>>().join(", ")
            );
            sqlx::query(&sql).execute(&pool).await.map_err(|e| format!("Create index error: {}", e))?;
            Ok(())
        }
        DbType::SQLite(_) => {
            let pool = state.sqlite.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let sql = format!(
                "CREATE {} INDEX {} ON {} ({})",
                if unique { "UNIQUE" } else { "" },
                quote_sqlite_ident(&index_name),
                quote_sqlite_ident(&table),
                columns.iter().map(|c| quote_sqlite_ident(c)).collect::<Vec<_>>().join(", ")
            );
            sqlx::query(&sql).execute(&pool).await.map_err(|e| format!("Create index error: {}", e))?;
            Ok(())
        }
        DbType::Redis(_) => Err("Redis does not support indexes".to_string()),
    }
}

#[tauri::command]
pub async fn drop_table_index(
    id: String,
    database: String,
    table: String,
    index_name: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = get_connection_meta(&id)?;
    match &conn.db_type {
        DbType::MySQL(_) => {
            let pool = state.mysql.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let sql = format!("DROP INDEX {} ON {}.{}", quote_mysql_ident(&index_name), quote_mysql_ident(&database), quote_mysql_ident(&table));
            sqlx::query(&sql).execute(&pool).await.map_err(|e| format!("Drop index error: {}", e))?;
            Ok(())
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let sql = format!("DROP INDEX {}.{}", quote_pg_ident(&database), quote_pg_ident(&index_name));
            sqlx::query(&sql).execute(&pool).await.map_err(|e| format!("Drop index error: {}", e))?;
            Ok(())
        }
        DbType::SQLite(_) => {
            let pool = state.sqlite.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let sql = format!("DROP INDEX {}", quote_sqlite_ident(&index_name));
            sqlx::query(&sql).execute(&pool).await.map_err(|e| format!("Drop index error: {}", e))?;
            Ok(())
        }
        DbType::Redis(_) => Err("Redis does not support indexes".to_string()),
    }
}

#[tauri::command]
pub async fn add_column(
    id: String,
    database: String,
    table: String,
    column_name: String,
    data_type: String,
    nullable: bool,
    default_value: Option<String>,
    comment: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    if column_name.trim().is_empty() || data_type.trim().is_empty() {
        return Err("Column name and data type are required".to_string());
    }
    let conn = get_connection_meta(&id)?;
    match &conn.db_type {
        DbType::MySQL(_) => {
            let pool = state.mysql.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let mut sql = format!(
                "ALTER TABLE {}.{} ADD COLUMN {} {}",
                quote_mysql_ident(&database),
                quote_mysql_ident(&table),
                quote_mysql_ident(&column_name),
                data_type
            );
            if !nullable {
                sql.push_str(" NOT NULL");
            }
            if let Some(ref dv) = default_value {
                sql.push_str(&format!(" DEFAULT {}", quote_sql_literal(dv)));
            }
            if let Some(ref cmt) = comment {
                if !cmt.is_empty() {
                    sql.push_str(&format!(" COMMENT {}", quote_sql_literal(cmt)));
                }
            }
            sqlx::query(&sql).execute(&pool).await.map_err(|e| format!("Add column error: {}", e))?;
            Ok(())
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let mut sql = format!(
                "ALTER TABLE {}.{} ADD COLUMN {} {}",
                quote_pg_ident(&database),
                quote_pg_ident(&table),
                quote_pg_ident(&column_name),
                data_type
            );
            if !nullable {
                sql.push_str(" NOT NULL");
            }
            if let Some(ref dv) = default_value {
                sql.push_str(&format!(" DEFAULT {}", quote_sql_literal(dv)));
            }
            sqlx::query(&sql).execute(&pool).await.map_err(|e| format!("Add column error: {}", e))?;
            if let Some(ref cmt) = comment {
                if !cmt.is_empty() {
                    let cmt_sql = format!(
                        "COMMENT ON COLUMN {}.{}.{} IS {}",
                        quote_pg_ident(&database),
                        quote_pg_ident(&table),
                        quote_pg_ident(&column_name),
                        quote_sql_literal(cmt)
                    );
                    sqlx::query(&cmt_sql).execute(&pool).await.map_err(|e| format!("Comment error: {}", e))?;
                }
            }
            Ok(())
        }
        DbType::SQLite(_) => {
            let pool = state.sqlite.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let mut sql = format!(
                "ALTER TABLE {} ADD COLUMN {} {}",
                quote_sqlite_ident(&table),
                quote_sqlite_ident(&column_name),
                data_type
            );
            if !nullable {
                sql.push_str(" NOT NULL");
            }
            if let Some(ref dv) = default_value {
                sql.push_str(&format!(" DEFAULT {}", quote_sql_literal(dv)));
            }
            sqlx::query(&sql).execute(&pool).await.map_err(|e| format!("Add column error: {}", e))?;
            Ok(())
        }
        DbType::Redis(_) => Err("Redis does not support columns".to_string()),
    }
}

#[tauri::command]
pub async fn drop_column(
    id: String,
    database: String,
    table: String,
    column_name: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let conn = get_connection_meta(&id)?;
    match &conn.db_type {
        DbType::MySQL(_) => {
            let pool = state.mysql.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let sql = format!(
                "ALTER TABLE {}.{} DROP COLUMN {}",
                quote_mysql_ident(&database),
                quote_mysql_ident(&table),
                quote_mysql_ident(&column_name)
            );
            sqlx::query(&sql).execute(&pool).await.map_err(|e| format!("Drop column error: {}", e))?;
            Ok(())
        }
        DbType::PostgreSQL(_) => {
            let pool = state.postgres.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let sql = format!(
                "ALTER TABLE {}.{} DROP COLUMN {}",
                quote_pg_ident(&database),
                quote_pg_ident(&table),
                quote_pg_ident(&column_name)
            );
            sqlx::query(&sql).execute(&pool).await.map_err(|e| format!("Drop column error: {}", e))?;
            Ok(())
        }
        DbType::SQLite(_) => {
            let pool = state.sqlite.lock().unwrap().get(&id).ok_or("Connection not established")?.clone();
            let sql = format!(
                "ALTER TABLE {} DROP COLUMN {}",
                quote_sqlite_ident(&table),
                quote_sqlite_ident(&column_name)
            );
            sqlx::query(&sql).execute(&pool).await.map_err(|e| format!("Drop column error: {}", e))?;
            Ok(())
        }
        DbType::Redis(_) => Err("Redis does not support columns".to_string()),
    }
}

// ── Redis Commands ──

#[tauri::command]
pub async fn redis_select_database(
    id: String,
    database: u8,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let connections = load_connections()?;
    let conn = connections.iter().find(|c| c.id == id)
        .ok_or("Connection not found")?;

    let mut db_type = conn.db_type.clone();
    match &mut db_type {
        DbType::Redis(config) => {
            config.database = database;
        }
        _ => return Err("Connection is not Redis".to_string()),
    }

    let url = db_type.build_url()?;
    let client = redis::Client::open(url.as_str()).map_err(|e| format!("Invalid URL: {}", e))?;
    let mut rconn = client.get_multiplexed_async_connection().await.map_err(|e| format!("Connection failed: {}", e))?;
    redis::cmd("PING").query_async::<String>(&mut rconn).await.map_err(|e| format!("PING failed: {}", e))?;

    state.redis.lock().unwrap().insert(id.clone(), client);
    state.redis_databases.lock().unwrap().insert(id, database);
    Ok(())
}

#[tauri::command]
pub fn redis_current_databases(state: State<'_, DbState>) -> HashMap<String, u8> {
    state.redis_databases.lock().unwrap().clone()
}

#[tauri::command]
pub async fn redis_scan_keys(
    id: String,
    pattern: String,
    count: u64,
    state: State<'_, DbState>,
) -> Result<Vec<RedisKeyInfo>, String> {
    let client = {
        let redis_map = state.redis.lock().unwrap();
        redis_map.get(&id).ok_or("Redis connection not found")?.clone()
    };
    let mut conn = client.get_multiplexed_async_connection().await.map_err(|e| format!("Connection error: {}", e))?;

    let mut result = Vec::new();
    let mut cursor: u64 = 0;
    loop {
        let reply: (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH").arg(&pattern)
            .arg("COUNT").arg(count)
            .query_async(&mut conn)
            .await
            .map_err(|e| format!("SCAN error: {}", e))?;
        cursor = reply.0;
        for key in reply.1 {
            let key_type: String = redis::cmd("TYPE")
                .arg(&key)
                .query_async(&mut conn)
                .await
                .unwrap_or_else(|_| "unknown".to_string());
            let ttl: i64 = redis::cmd("TTL")
                .arg(&key)
                .query_async(&mut conn)
                .await
                .unwrap_or(-2);
            result.push(RedisKeyInfo {
                name: key,
                key_type,
                ttl,
            });
            if result.len() >= count as usize {
                break;
            }
        }
        if cursor == 0 || result.len() >= count as usize {
            break;
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn redis_get_key(
    id: String,
    key: String,
    state: State<'_, DbState>,
) -> Result<Vec<Vec<Option<String>>>, String> {
    let client = {
        let redis_map = state.redis.lock().unwrap();
        redis_map.get(&id).ok_or("Redis connection not found")?.clone()
    };
    let mut conn = client.get_multiplexed_async_connection().await.map_err(|e| format!("Connection error: {}", e))?;

    let key_type: String = redis::cmd("TYPE")
        .arg(&key)
        .query_async(&mut conn)
        .await
        .map_err(|e| format!("TYPE error: {}", e))?;

    match key_type.as_str() {
        "string" => {
            let val: Option<String> = redis::cmd("GET")
                .arg(&key)
                .query_async(&mut conn)
                .await
                .map_err(|e| format!("GET error: {}", e))?;
            Ok(vec![
                vec![Some("value".to_string())],
                vec![Some(val.unwrap_or_default())],
            ])
        }
        "list" => {
            let vals: Vec<String> = redis::cmd("LRANGE")
                .arg(&key).arg(0i64).arg(-1i64)
                .query_async(&mut conn)
                .await
                .map_err(|e| format!("LRANGE error: {}", e))?;
            let mut rows = vec![vec![Some("index".to_string()), Some("value".to_string())]];
            for (i, v) in vals.iter().enumerate() {
                rows.push(vec![Some(i.to_string()), Some(v.clone())]);
            }
            Ok(rows)
        }
        "set" => {
            let vals: Vec<String> = redis::cmd("SMEMBERS")
                .arg(&key)
                .query_async(&mut conn)
                .await
                .map_err(|e| format!("SMEMBERS error: {}", e))?;
            let mut rows = vec![vec![Some("member".to_string())]];
            for v in vals.iter() {
                rows.push(vec![Some(v.clone())]);
            }
            Ok(rows)
        }
        "zset" => {
            let vals: Vec<(String, f64)> = redis::cmd("ZRANGE")
                .arg(&key).arg(0i64).arg(-1i64).arg("WITHSCORES")
                .query_async(&mut conn)
                .await
                .map_err(|e| format!("ZRANGE error: {}", e))?;
            let mut rows = vec![vec![Some("member".to_string()), Some("score".to_string())]];
            for (member, score) in vals.iter() {
                rows.push(vec![Some(member.clone()), Some(score.to_string())]);
            }
            Ok(rows)
        }
        "hash" => {
            let vals: Vec<(String, String)> = redis::cmd("HGETALL")
                .arg(&key)
                .query_async(&mut conn)
                .await
                .map_err(|e| format!("HGETALL error: {}", e))?;
            let mut rows = vec![vec![Some("field".to_string()), Some("value".to_string())]];
            for (field, value) in vals.iter() {
                rows.push(vec![Some(field.clone()), Some(value.clone())]);
            }
            Ok(rows)
        }
        _ => Ok(vec![vec![Some("type".to_string()), Some(key_type.clone())]]),
    }
}

#[tauri::command]
pub async fn redis_execute(
    id: String,
    command: String,
    state: State<'_, DbState>,
) -> Result<QueryResult, String> {
    let client = {
        let redis_map = state.redis.lock().unwrap();
        redis_map.get(&id).ok_or("Redis connection not found")?.clone()
    };
    let mut conn = client.get_multiplexed_async_connection().await.map_err(|e| format!("Connection error: {}", e))?;

    let parts: Vec<String> = command.split_whitespace().map(|s| s.to_string()).collect();
    if parts.is_empty() {
        return Err("Empty command".to_string());
    }

    let start = std::time::Instant::now();

    let cmd_name = parts[0].to_uppercase();
    let mut redis_cmd = redis::cmd(&cmd_name);
    for arg in parts[1..].iter() {
        redis_cmd.arg(arg.as_str());
    }

    let value = redis_cmd.query_async::<redis::Value>(&mut conn).await.map_err(|e| format!("Command error: {}", e))?;
    let elapsed = start.elapsed().as_millis() as u64;

    let (columns, rows) = format_redis_value(&value);
    let affected_rows = rows.len() as u64;

    Ok(QueryResult {
        columns,
        rows,
        affected_rows,
        execution_time_ms: elapsed,
    })
}

fn redis_value_to_string(val: &redis::Value) -> Option<String> {
    match val {
        redis::Value::Nil => None,
        redis::Value::Int(n) => Some(n.to_string()),
        redis::Value::BulkString(data) => Some(String::from_utf8_lossy(data).to_string()),
        redis::Value::SimpleString(s) => Some(s.clone()),
        redis::Value::Okay => Some("OK".to_string()),
        redis::Value::Double(f) => Some(f.to_string()),
        redis::Value::Boolean(b) => Some(b.to_string()),
        _ => Some(format!("{:?}", val)),
    }
}

fn format_redis_value(value: &redis::Value) -> (Vec<String>, Vec<Vec<Option<String>>>) {
    match value {
        redis::Value::Nil => (vec!["result".to_string()], vec![]),
        redis::Value::Int(n) => (vec!["result".to_string()], vec![vec![Some(n.to_string())]]),
        redis::Value::BulkString(data) => {
            let s = String::from_utf8_lossy(data).to_string();
            (vec!["result".to_string()], vec![vec![Some(s)]])
        }
        redis::Value::SimpleString(s) => (vec!["result".to_string()], vec![vec![Some(s.clone())]]),
        redis::Value::Okay => (vec!["result".to_string()], vec![vec![Some("OK".to_string())]]),
        redis::Value::Double(f) => (vec!["result".to_string()], vec![vec![Some(f.to_string())]]),
        redis::Value::Boolean(b) => (vec!["result".to_string()], vec![vec![Some(b.to_string())]]),
        redis::Value::Array(items) => {
            if items.is_empty() {
                return (vec!["result".to_string()], vec![]);
            }
            let mut rows = Vec::new();
            for item in items.iter() {
                match item {
                    redis::Value::Array(inner) => {
                        let inner_vals: Vec<Option<String>> = inner.iter().map(redis_value_to_string).collect();
                        rows.push(inner_vals);
                    }
                    redis::Value::Map(pairs) => {
                        for (k, v) in pairs.iter() {
                            rows.push(vec![redis_value_to_string(k), redis_value_to_string(v)]);
                        }
                    }
                    redis::Value::Set(inner) => {
                        for v in inner.iter() {
                            rows.push(vec![redis_value_to_string(v)]);
                        }
                    }
                    _ => {
                        rows.push(vec![redis_value_to_string(item)]);
                    }
                }
            }
            let col_count = rows.first().map(|r| r.len().max(1)).unwrap_or(1);
            let columns: Vec<String> = if col_count == 1 {
                vec!["result".to_string()]
            } else {
                (0..col_count).map(|i| format!("col_{}", i)).collect()
            };
            // Pad shorter rows
            for row in rows.iter_mut() {
                while row.len() < col_count {
                    row.push(None);
                }
            }
            (columns, rows)
        }
        redis::Value::Map(pairs) => {
            let mut rows = vec![vec![Some("key".to_string()), Some("value".to_string())]];
            for (k, v) in pairs.iter() {
                rows.push(vec![redis_value_to_string(k), redis_value_to_string(v)]);
            }
            (vec!["key".to_string(), "value".to_string()], rows)
        }
        redis::Value::Set(items) => {
            let mut rows = vec![vec![Some("member".to_string())]];
            for item in items.iter() {
                rows.push(vec![redis_value_to_string(item)]);
            }
            (vec!["member".to_string()], rows)
        }
        _ => (vec!["result".to_string()], vec![vec![Some(format!("{:?}", value))]]),
    }
}
