use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "config")]
pub enum DbType {
    MySQL(DbConnectionConfig),
    PostgreSQL(DbConnectionConfig),
    SQLite(DbSQLiteConfig),
    Redis(DbRedisConfig),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbConnectionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
    #[serde(default)]
    pub use_ssl: bool,
}

impl Default for DbConnectionConfig {
    fn default() -> Self {
        Self {
            host: "localhost".to_string(),
            port: 3306,
            username: "root".to_string(),
            password: String::new(),
            database: String::new(),
            use_ssl: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbSQLiteConfig {
    pub path: String,
}

impl Default for DbSQLiteConfig {
    fn default() -> Self {
        Self {
            path: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbRedisConfig {
    pub host: String,
    pub port: u16,
    pub password: String,
    pub database: u8,
}

impl Default for DbRedisConfig {
    fn default() -> Self {
        Self {
            host: "localhost".to_string(),
            port: 6379,
            password: String::new(),
            database: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub db_type: DbType,
    #[serde(default)]
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub affected_rows: u64,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub table_type: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisKeyInfo {
    pub name: String,
    pub key_type: String,
    pub ttl: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub name: String,
    pub table_count: u64,
    pub size_bytes: u64,
    pub default_charset: Option<String>,
    pub default_collation: Option<String>,
    pub extras: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableIndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub index_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDetailInfo {
    pub database: String,
    pub table: String,
    pub table_type: String,
    pub engine: Option<String>,
    pub row_count: Option<u64>,
    pub data_size_bytes: Option<u64>,
    pub index_size_bytes: Option<u64>,
    pub ddl: Option<String>,
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<TableIndexInfo>,
    pub rows: QueryResult,
}

impl DbType {
    pub fn build_url(&self) -> Result<String, String> {
        match self {
            DbType::MySQL(c) => {
                let ssl = if c.use_ssl { "required" } else { "disabled" };
                Ok(format!(
                    "mysql://{}:{}@{}:{}{}?ssl-mode={}",
                    urlencoding::encode(&c.username),
                    urlencoding::encode(&c.password),
                    c.host,
                    c.port,
                    if c.database.is_empty() { String::new() } else { format!("/{}", c.database) },
                    ssl
                ))
            }
            DbType::PostgreSQL(c) => {
                let ssl = if c.use_ssl { "require" } else { "disable" };
                Ok(format!(
                    "postgres://{}:{}@{}:{}{}?sslmode={}",
                    urlencoding::encode(&c.username),
                    urlencoding::encode(&c.password),
                    c.host,
                    c.port,
                    if c.database.is_empty() { String::new() } else { format!("/{}", c.database) },
                    ssl
                ))
            }
            DbType::SQLite(c) => Ok(format!("sqlite://{}?mode=rwc", c.path)),
            DbType::Redis(c) => {
                let mut url = if c.password.is_empty() {
                    format!("redis://{}:{}", c.host, c.port)
                } else {
                    format!("redis://:{}@{}:{}", urlencoding::encode(&c.password), c.host, c.port)
                };
                url = format!("{}/{}", url, c.database);
                Ok(url)
            }
        }
    }
}
