import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  Database as DatabaseIcon,
  Plus,
  Trash2,
  Plug,
  RefreshCw,
  Pencil,
  Server,
  Table2,
  ChevronRight,
  ChevronDown,
  Play,
  FolderOpen,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Search,
  Download,
  Copy,
  PanelLeftClose,
  PanelLeftOpen,
  Info,
  FileText,
  KeyRound,
} from "lucide-react";

type DbType =
  | { type: "MySQL"; config: DbConnectionConfig }
  | { type: "PostgreSQL"; config: DbConnectionConfig }
  | { type: "SQLite"; config: DbSQLiteConfig }
  | { type: "Redis"; config: DbRedisConfig };

interface DbConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  use_ssl: boolean;
}

interface DbSQLiteConfig {
  path: string;
}

interface DbRedisConfig {
  host: string;
  port: number;
  password: string;
  database: number;
}

interface SavedConnection {
  id: string;
  name: string;
  db_type: DbType;
  color: string;
}

interface TableInfo {
  name: string;
  type: string;
  comment: string | null;
}

interface ColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  comment: string | null;
}

interface QueryResult {
  columns: string[];
  rows: (string | null)[][];
  affected_rows: number;
  execution_time_ms: number;
}

interface RedisKeyInfo {
  name: string;
  key_type: string;
  ttl: number;
}

interface TableDataContext {
  id: string;
  database: string;
  table: string;
  columns: ColumnInfo[];
}

interface EditingCell {
  rowIndex: number;
  column: string;
  value: string;
}

interface DatabaseInfo {
  name: string;
  table_count: number;
  size_bytes: number;
  default_charset: string | null;
  default_collation: string | null;
  extras: [string, string][];
}

interface TableIndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  index_type: string | null;
}

interface TableDetailInfo {
  database: string;
  table: string;
  table_type: string;
  engine: string | null;
  row_count: number | null;
  data_size_bytes: number | null;
  index_size_bytes: number | null;
  ddl: string | null;
  columns: ColumnInfo[];
  indexes: TableIndexInfo[];
  rows: QueryResult;
}

type DbContextMenu =
  | { type: "db"; x: number; y: number; id: string; database: string }
  | null;

type TableDetailTab = "info" | "fields" | "indexes" | "ddl";

const DB_COLORS: Record<string, string> = {
  MySQL: "#4479A1",
  PostgreSQL: "#336791",
  SQLite: "#003B57",
  Redis: "#DC382D",
};

const defaultConfig = (dbType: string): DbType => {
  if (dbType === "SQLite") {
    return { type: "SQLite", config: { path: "" } };
  }
  if (dbType === "Redis") {
    return { type: "Redis", config: { host: "localhost", port: 6379, password: "", database: 0 } };
  }
  const port = dbType === "MySQL" ? 3306 : 5432;
  return {
    type: dbType as "MySQL" | "PostgreSQL",
    config: { host: "localhost", port, username: "root", password: "", database: "", use_ssl: false },
  };
};

const isRedisType = (dbType: DbType) => dbType.type === "Redis";

const getDbContextMenuPosition = (event: React.MouseEvent) => {
  const margin = 8;
  const menuWidth = 160;
  const menuHeight = 116;
  return {
    x: Math.max(margin, Math.min(event.clientX + 2, window.innerWidth - menuWidth - margin)),
    y: Math.max(margin, Math.min(event.clientY + 2, window.innerHeight - menuHeight - margin)),
  };
};

export default function Database() {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [dbSidebarCollapsed, setDbSidebarCollapsed] = useState(false);
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingConnection, setEditingConnection] = useState<SavedConnection | null>(null);
  const [expandedConnections, setExpandedConnections] = useState<Set<string>>(new Set());
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [databases, setDatabases] = useState<Record<string, string[]>>({});
  const [tables, setTables] = useState<Record<string, TableInfo[]>>({});
  const [queryConnId, setQueryConnId] = useState<string | null>(null);
  const [queryDb, setQueryDb] = useState<string>("");
  const [query, setQuery] = useState("");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [tableDataContext, setTableDataContext] = useState<TableDataContext | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [savingCell, setSavingCell] = useState(false);
  const [contextMenu, setContextMenu] = useState<DbContextMenu>(null);
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [dbInfoLoading, setDbInfoLoading] = useState(false);
  const [createTableTarget, setCreateTableTarget] = useState<{ id: string; database: string } | null>(null);
  const [createTableDdl, setCreateTableDdl] = useState("");
  const [createColumnTarget, setCreateColumnTarget] = useState<{ id: string; database: string; table: string } | null>(null);
  const [createColumnForm, setCreateColumnForm] = useState({
    name: "",
    dataType: "VARCHAR(255)",
    nullable: true,
    defaultValue: "",
    comment: "",
  });
  const [createIndexTarget, setCreateIndexTarget] = useState<{ id: string; database: string; table: string } | null>(null);
  const [createIndexForm, setCreateIndexForm] = useState({
    name: "",
    columns: "",
    unique: false,
  });
  const [tableDetailTarget, setTableDetailTarget] = useState<{ id: string; database: string; table: string } | null>(null);
  const [tableDetail, setTableDetail] = useState<TableDetailInfo | null>(null);
  const [tableDetailTab, setTableDetailTab] = useState<TableDetailTab>("info");
  const [tableDetailLoading, setTableDetailLoading] = useState(false);
  const [ddlCopied, setDdlCopied] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [redisKeys, setRedisKeys] = useState<Record<string, RedisKeyInfo[]>>({});
  const [redisKeyDetail, setRedisKeyDetail] = useState<QueryResult | null>(null);
  const [redisKeyDetailName, setRedisKeyDetailName] = useState<string | null>(null);
  const [redisPattern, setRedisPattern] = useState("*");
  const [redisCmd, setRedisCmd] = useState("");
  const queryConnection = connections.find((c) => c.id === queryConnId) ?? null;
  const queryIsRedis = queryConnection ? isRedisType(queryConnection.db_type) : false;
  const showDatabaseEmptyState = !queryConnId
    && !queryError
    && !tableDetailTarget
    && !tableDetailLoading
    && !queryResult
    && !redisKeyDetail;

  const highlightSQL = (sql: string) => {
    const kw = "#9b4d96";
    const str = "#3d8c40";
    const num = "#b56116";
    const cmt = "var(--text-muted)";
    const bt = "#24788b";
    return sql
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/('(?:[^'\\]|\\.)*')/g, `<span style="color:${str}">$1</span>`)
      .replace(/("(?:[^"\\]|\\.)*")/g, `<span style="color:${str}">$1</span>`)
      .replace(/(`(?:[^`\\]|\\.)*`)/g, `<span style="color:${bt}">$1</span>`)
      .replace(/(--[^\n]*)/g, `<span style="color:${cmt}">$1</span>`)
      .replace(/(\/\*[\s\S]*?\*\/)/g, `<span style="color:${cmt}">$1</span>`)
      .replace(/\b(\d+\.?\d*)\b/g, `<span style="color:${num}">$1</span>`)
      .replace(
        /\b(CREATE|ALTER|DROP|TABLE|INDEX|COLUMN|ADD|PRIMARY|KEY|NOT|NULL|DEFAULT|UNIQUE|AUTO_INCREMENT|COMMENT|ENGINE|CHARSET|COLLATE|CONSTRAINT|FOREIGN|REFERENCES|ON|DELETE|UPDATE|CASCADE|SET|INT|BIGINT|VARCHAR|TEXT|BOOLEAN|TINYINT|SMALLINT|MEDIUMINT|INTEGER|FLOAT|DOUBLE|DECIMAL|DATE|DATETIME|TIMESTAMP|TIME|CHAR|BLOB|ENUM|JSON|SELECT|FROM|WHERE|INSERT|INTO|VALUES|AND|OR|IN|LIKE|BETWEEN|IS|AS|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|UNION|ALL|DISTINCT|COUNT|SUM|AVG|MAX|MIN|IF|EXISTS|CASE|WHEN|THEN|ELSE|END|USING|BTREE|HASH)\b/gi,
        `<span style="color:${kw}">$1</span>`,
      );
  };

  const formatBytes = (bytes: number | null | undefined) => {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  };

  const connectTo = async (id: string) => {
    setLoading((p) => ({ ...p, [id]: true }));
    try {
      await invoke("connect_db", { id });
      setConnectedIds((prev) => new Set(prev).add(id));
      setExpandedConnections((prev) => new Set(prev).add(id));
      return true;
    } catch (e) {
      alert(`Connection failed: ${e}`);
      return false;
    } finally {
      setLoading((p) => ({ ...p, [id]: false }));
    }
  };

  const disconnectFrom = async (id: string) => {
    await invoke("disconnect_db", { id }).catch(() => {});
    setConnectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setExpandedConnections((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setExpandedDbs((prev) => new Set([...prev].filter((key) => !key.startsWith(`${id}:`))));
    if (queryConnId === id) {
      setQueryConnId(null);
      setQueryDb("");
      setQueryResult(null);
      setRedisKeyDetail(null);
      setRedisKeyDetailName(null);
    }
  };

  const loadDatabases = async (id: string) => {
    const conn = connections.find((c) => c.id === id);
    if (!conn) return;
    if (conn.db_type.type === "Redis") {
      scanRedisKeys(id);
      return;
    }
    try {
      const dbs = await invoke<string[]>("list_databases", { id });
      setDatabases((prev) => ({ ...prev, [id]: dbs }));
    } catch (e) {
      console.error(e);
    }
  };

  const loadConnections = async () => {
    try {
      const conns = await invoke<SavedConnection[]>("list_db_connections");
      setConnections(conns);
      const ids = await invoke<string[]>("list_connected_db_ids");
      setConnectedIds(new Set(ids));
      setExpandedConnections((prev) => new Set([...prev, ...ids]));
      await Promise.all(ids.map(async (id) => {
        const conn = conns.find((c) => c.id === id);
        if (!conn) return;
        if (isRedisType(conn.db_type)) {
          await scanRedisKeys(id);
          return;
        }
        try {
          const dbs = await invoke<string[]>("list_databases", { id });
          setDatabases((prev) => ({ ...prev, [id]: dbs }));
        } catch (e) {
          console.error(e);
        }
      }));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => { loadConnections(); }, []);

  const loadTables = async (id: string, db: string) => {
    try {
      const tbls = await invoke<TableInfo[]>("list_tables", { id, database: db });
      setTables((prev) => ({ ...prev, [`${id}:${db}`]: tbls }));
    } catch (e) {
      console.error(e);
    }
  };

  const showDatabaseInfo = async (id: string, database: string) => {
    setContextMenu(null);
    setDbInfoLoading(true);
    setDbInfo(null);
    try {
      const info = await invoke<DatabaseInfo>("get_database_info", { id, database });
      setDbInfo(info);
    } catch (e) {
      setQueryError(String(e));
    } finally {
      setDbInfoLoading(false);
    }
  };

  const openCreateTable = (id: string, database: string) => {
    setContextMenu(null);
    setCreateTableTarget({ id, database });
    setCreateTableDdl(`CREATE TABLE new_table (
  id BIGINT PRIMARY KEY
)`);
  };

  const submitCreateTable = async () => {
    if (!createTableTarget || !createTableDdl.trim()) return;
    try {
      await invoke("create_table", {
        id: createTableTarget.id,
        database: createTableTarget.database,
        ddl: createTableDdl,
      });
      await loadTables(createTableTarget.id, createTableTarget.database);
      setCreateTableTarget(null);
    } catch (e) {
      setQueryError(String(e));
    }
  };

  const loadTableDetail = async (
    id: string,
    database: string,
    table: string,
    tab: TableDetailTab = "info",
  ) => {
    setContextMenu(null);
    setTableDetailTarget({ id, database, table });
    setTableDetailTab(tab);
    setTableDetailLoading(true);
    setTableDetail(null);
    try {
      const detail = await invoke<TableDetailInfo>("get_table_detail", { id, database, table });
      setTableDetail(detail);
    } catch (e) {
      setQueryError(String(e));
    } finally {
      setTableDetailLoading(false);
    }
  };

  const refreshTableDetail = async () => {
    if (!tableDetailTarget) return;
    await loadTableDetail(tableDetailTarget.id, tableDetailTarget.database, tableDetailTarget.table, tableDetailTab);
  };

  const copyText = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  };

  const copyDdl = async () => {
    if (!tableDetail?.ddl) return;
    try {
      await copyText(tableDetail.ddl);
      setDdlCopied(true);
      window.setTimeout(() => setDdlCopied(false), 1200);
    } catch (e) {
      setQueryError(`复制失败：${e}`);
    }
  };

  const openIndexCreate = () => {
    if (!tableDetailTarget) return;
    setCreateIndexTarget(tableDetailTarget);
    setCreateIndexForm({
      name: "",
      columns: tableDetail?.columns[0]?.name || "",
      unique: false,
    });
  };

  const submitIndexCreate = async () => {
    if (!createIndexTarget) return;
    const name = createIndexForm.name.trim();
    const cols = createIndexForm.columns.split(",").map((col) => col.trim()).filter(Boolean);
    if (!name || cols.length === 0) {
      setQueryError("索引名和字段不能为空。");
      return;
    }
    try {
      await invoke("create_table_index", {
        ...createIndexTarget,
        indexName: name,
        columns: cols,
        unique: createIndexForm.unique,
      });
      setCreateIndexTarget(null);
      await refreshTableDetail();
    } catch (e) {
      setQueryError(String(e));
    }
  };

  const dropIndex = async (indexName: string) => {
    if (!tableDetailTarget) return;
    if (!confirm(`确认删除索引 ${indexName}？`)) return;
    try {
      await invoke("drop_table_index", { ...tableDetailTarget, indexName });
      await refreshTableDetail();
    } catch (e) {
      setQueryError(String(e));
    }
  };

  const openAddColumn = () => {
    if (!tableDetailTarget) return;
    setCreateColumnTarget(tableDetailTarget);
    setCreateColumnForm({
      name: "",
      dataType: "VARCHAR(255)",
      nullable: true,
      defaultValue: "",
      comment: "",
    });
  };

  const addColumn = async () => {
    if (!createColumnTarget) return;
    const name = createColumnForm.name.trim();
    const dataType = createColumnForm.dataType.trim();
    if (!name || !dataType) {
      setQueryError("字段名和类型不能为空。");
      return;
    }
    try {
      await invoke("add_column", {
        ...createColumnTarget,
        columnName: name,
        dataType,
        nullable: createColumnForm.nullable,
        defaultValue: createColumnForm.defaultValue.trim() || null,
        comment: createColumnForm.comment.trim() || null,
      });
      setCreateColumnTarget(null);
      await refreshTableDetail();
    } catch (e) {
      setQueryError(String(e));
    }
  };

  const dropColumn = async (columnName: string) => {
    if (!tableDetailTarget) return;
    if (!confirm(`确认删除字段 ${columnName}？`)) return;
    try {
      await invoke("drop_column", { ...tableDetailTarget, columnName });
      await refreshTableDetail();
    } catch (e) {
      setQueryError(String(e));
    }
  };

  const toggleDb = async (id: string, db: string) => {
    const key = `${id}:${db}`;
    if (expandedDbs.has(key)) {
      setExpandedDbs((prev) => { const n = new Set(prev); n.delete(key); return n; });
    } else {
      setExpandedDbs((prev) => new Set(prev).add(key));
      await loadTables(id, db);
    }
  };

  const runQuery = async () => {
    if (!queryConnId || !query.trim()) return;
    if (queryIsRedis) {
      await runRedisCmd();
      return;
    }
    if (!queryDb) {
      setQueryError("请先在左侧具体数据库行点击查询按钮，再执行 SQL。");
      return;
    }
    setQueryLoading(true);
    setQueryError(null);
    setQueryResult(null);
    setTableDataContext(null);
    setEditingCell(null);
    try {
      const result = await invoke<QueryResult>("execute_db_query", { id: queryConnId, query, database: queryDb || null });
      setQueryResult(result);
    } catch (e) {
      setQueryError(String(e));
    } finally {
      setQueryLoading(false);
    }
  };

  const openDbQuery = (id: string, db: string) => {
    setQueryConnId(id);
    setQueryDb(db);
    setQueryResult(null);
    setTableDataContext(null);
    setEditingCell(null);
    setRedisKeyDetail(null);
    setRedisKeyDetailName(null);
    setQueryError(null);
  };

  const viewTableData = async (id: string, db: string, table: string) => {
    setQueryConnId(id);
    setQueryDb(db);
    setQuery(`SELECT * FROM ${table} LIMIT 20`);
    setQueryLoading(true);
    setQueryError(null);
    setQueryResult(null);
    setRedisKeyDetail(null);
    setRedisKeyDetailName(null);
    setEditingCell(null);
    try {
      const [result, cols] = await Promise.all([
        invoke<QueryResult>("get_table_data", { id, database: db, table, page: 0, pageSize: 20 }),
        invoke<ColumnInfo[]>("list_columns", { id, database: db, table }),
      ]);
      setQueryResult(result);
      setTableDataContext({ id, database: db, table, columns: cols });
    } catch (e) {
      setQueryError(String(e));
    } finally {
      setQueryLoading(false);
    }
  };

  const exportCurrentCsv = () => {
    const result = queryResult || redisKeyDetail;
    if (!result) return;
    const escape = (value: string | null) => {
      if (value === null) return "";
      const escaped = value.replace(/"/g, "\"\"");
      return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
    };
    const csv = [
      result.columns.map(escape).join(","),
      ...result.rows.map((row) => row.map(escape).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const name = tableDataContext ? `${tableDataContext.database}.${tableDataContext.table}` : redisKeyDetailName || "query-result";
    link.href = url;
    link.download = `${name}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const commitCellEdit = async () => {
    if (!editingCell || !tableDataContext || !queryResult) {
      setEditingCell(null);
      return;
    }
    const pkColumns = tableDataContext.columns.filter((col) => col.is_primary_key).map((col) => col.name);
    if (pkColumns.length === 0) {
      setQueryError("这张表没有主键，不能安全地回写单元格。");
      setEditingCell(null);
      return;
    }
    if (pkColumns.includes(editingCell.column)) {
      setQueryError("暂不支持直接编辑主键列。");
      setEditingCell(null);
      return;
    }

    const row = queryResult.rows[editingCell.rowIndex];
    const pkValues: Record<string, string> = {};
    for (const pk of pkColumns) {
      const index = queryResult.columns.indexOf(pk);
      const value = index >= 0 ? row[index] : null;
      if (value === null || value === undefined) {
        setQueryError("当前结果缺少主键值，不能回写。");
        setEditingCell(null);
        return;
      }
      pkValues[pk] = value;
    }

    setSavingCell(true);
    setQueryError(null);
    try {
      await invoke("update_table_cell", {
        id: tableDataContext.id,
        database: tableDataContext.database,
        table: tableDataContext.table,
        column: editingCell.column,
        value: editingCell.value,
        pkValues,
      });
      setQueryResult((prev) => {
        if (!prev) return prev;
        const columnIndex = prev.columns.indexOf(editingCell.column);
        const rows = prev.rows.map((r, index) => (
          index === editingCell.rowIndex
            ? r.map((cell, cellIndex) => cellIndex === columnIndex ? editingCell.value : cell)
            : r
        ));
        return { ...prev, rows };
      });
    } catch (e) {
      setQueryError(String(e));
    } finally {
      setSavingCell(false);
      setEditingCell(null);
    }
  };

  const deleteConnection = async (id: string) => {
    if (!confirm("确认删除此连接？")) return;
    await invoke("disconnect_db", { id }).catch(() => {});
    await invoke("delete_db_connection", { id });
    setConnectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setExpandedConnections((prev) => { const n = new Set(prev); n.delete(id); return n; });
    loadConnections();
  };

  const editConnection = (conn: SavedConnection) => {
    setEditingConnection(conn);
    setShowAddModal(false);
  };

  const scanRedisKeys = async (id: string) => {
    try {
      const keys = await invoke<RedisKeyInfo[]>("redis_scan_keys", { id, pattern: redisPattern, count: 200 });
      setRedisKeys((prev) => ({ ...prev, [id]: keys }));
    } catch (e) {
      console.error(e);
    }
  };

  const getRedisKeyValue = async (id: string, key: string) => {
    setRedisKeyDetailName(key);
    setRedisKeyDetail(null);
    setQueryResult(null);
    setQueryError(null);
    try {
      const rows = await invoke<(string | null)[][]>("redis_get_key", { id, key });
      const columns = rows[0]?.map((cell, i) => cell || `col_${i}`) || [];
      setRedisKeyDetail({ columns, rows: rows.slice(1), affected_rows: rows.length - 1, execution_time_ms: 0 });
    } catch (e) {
      setQueryError(String(e));
    }
  };

  const runRedisCmd = async () => {
    if (!queryConnId || !redisCmd.trim()) return;
    setQueryLoading(true);
    setQueryError(null);
    setQueryResult(null);
    try {
      const result = await invoke<QueryResult>("redis_execute", { id: queryConnId, command: redisCmd });
      setQueryResult(result);
    } catch (e) {
      setQueryError(String(e));
    } finally {
      setQueryLoading(false);
    }
  };

  const dbLabel = (conn: SavedConnection) => {
    const t = conn.db_type;
    if (t.type === "SQLite") return `SQLite: ${t.config.path.split("/").pop() || t.config.path}`;
    if (t.type === "Redis") return `Redis: ${t.config.host}:${t.config.port}`;
    return `${t.type}: ${t.config.host}:${t.config.port}`;
  };

  return (
    <div className="flex flex-col h-full animate-fade-in" onClick={() => setContextMenu(null)}>
      <div className="page-header" style={{ padding: "18px 32px 14px" }}>
        <div>
          <div className="page-title-row">
            <div className="page-icon" style={{ background: "rgba(175, 82, 222, 0.12)" }}>
              <DatabaseIcon size={18} color="#af52de" strokeWidth={2} />
            </div>
            <h2 className="page-title">数据库</h2>
            <p className="page-subtitle">管理数据库连接并执行 SQL 查询</p>
          </div>
        </div>
      </div>
      <div className="database-shell flex flex-1" style={{ padding: "0 32px 34px", background: "var(--bg-primary)" }}>
      {/* Sidebar */}
      <div className={`database-sidebar flex flex-col ${dbSidebarCollapsed ? "database-sidebar-collapsed" : "w-64"}`}>
        <div className="database-sidebar-header p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <DatabaseIcon size={15} style={{ color: "var(--bg-button)" }} />
            <span className="database-sidebar-text text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
              数据库连接
            </span>
          </div>
          <div className="flex items-center gap-1">
            {!dbSidebarCollapsed && (
              <button onClick={() => setShowAddModal(true)} className="icon-action" title="新建连接">
                <Plus size={14} style={{ color: "var(--text-primary)" }} />
              </button>
            )}
            <button onClick={() => setDbSidebarCollapsed((value) => !value)} className="icon-action" title={dbSidebarCollapsed ? "展开连接列表" : "收起连接列表"}>
              {dbSidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </button>
          </div>
        </div>

        {!dbSidebarCollapsed && <div className="flex-1 overflow-auto p-2 space-y-1">
          {connections.length === 0 && (
            <div className="text-center py-8">
              <DatabaseIcon size={28} className="mx-auto mb-2" style={{ color: "var(--text-muted)" }} />
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>暂无数据库连接</p>
              <button onClick={() => setShowAddModal(true)} className="mt-2 text-xs" style={{ color: "var(--bg-button)" }}>
                添加连接
              </button>
            </div>
          )}
          {connections.map((conn) => {
            const isConn = connectedIds.has(conn.id);
            const isLoad = loading[conn.id];
            const isExpanded = expandedConnections.has(conn.id);
            return (
              <div key={conn.id} className="database-connection-card rounded-lg">
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <button
                    onClick={() => {
                      if (isConn) {
                        disconnectFrom(conn.id);
                      } else {
                        connectTo(conn.id).then((ok) => { if (ok) loadDatabases(conn.id); });
                      }
                    }}
                    className="database-connect-button shrink-0"
                    disabled={isLoad}
                    title={isConn ? "断开连接" : "连接"}
                  >
                    {isLoad ? (
                      <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-muted)" }} />
                    ) : isConn ? (
                      <Plug size={14} style={{ color: "var(--bg-success)" }} />
                    ) : (
                      <Plug size={14} style={{ color: "var(--text-muted)" }} />
                    )}
                  </button>
                  {isConn && (
                    <button
                      onClick={() => setExpandedConnections((prev) => {
                        const next = new Set(prev);
                        if (next.has(conn.id)) next.delete(conn.id);
                        else next.add(conn.id);
                        return next;
                      })}
                      className="database-mini-action shrink-0"
                      title={isExpanded ? "收起数据库列表" : "展开数据库列表"}
                    >
                      {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: isConn ? "var(--bg-success)" : "var(--text-muted)" }} />
                      <span className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                        {conn.name}
                      </span>
                    </div>
                    <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                      {dbLabel(conn)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isConn && isRedisType(conn.db_type) && (
                      <button
                        onClick={() => {
                          setQueryConnId(conn.id);
                          setQueryDb("");
                          setQueryResult(null);
                          setRedisKeyDetail(null);
                          setRedisKeyDetailName(null);
                          if (isRedisType(conn.db_type) && !redisCmd.trim()) setRedisCmd("PING");
                        }}
                        className="database-mini-action"
                        title="Redis 命令"
                      >
                        <Play size={11} style={{ color: "var(--bg-success)" }} />
                      </button>
                    )}
                    <button
                      onClick={() => editConnection(conn)}
                      className="database-mini-action"
                      title="编辑连接"
                    >
                      <Pencil size={11} style={{ color: "var(--text-muted)" }} />
                    </button>
                    <button
                      onClick={() => deleteConnection(conn.id)}
                      className="database-mini-action"
                    >
                      <Trash2 size={11} style={{ color: "var(--text-muted)" }} />
                    </button>
                  </div>
                </div>

                {isConn && isExpanded && (
                  <div className="px-2 pb-2">
                    {isRedisType(conn.db_type) ? (
                      <div>
                        <div className="flex items-center gap-1 mb-1.5">
                          <Search size={10} style={{ color: "var(--text-muted)" }} />
                          <input
                            value={redisPattern}
                            onChange={(e) => setRedisPattern(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") scanRedisKeys(conn.id); }}
                            className="macos-input text-[11px] py-0.5 px-1.5"
                            style={{ width: 100 }}
                            placeholder="pattern"
                          />
                          <button onClick={() => scanRedisKeys(conn.id)} className="database-mini-action" title="扫描">
                            <RefreshCw size={10} />
                          </button>
                        </div>
                        {(redisKeys[conn.id] || []).map((k) => (
                          <button
                            key={k.name}
                            onClick={() => getRedisKeyValue(conn.id, k.name)}
                            className="flex items-center gap-1 w-full px-2 py-0.5 rounded text-xs hover:opacity-80"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: DB_COLORS.Redis }} />
                            <span className="truncate">{k.name}</span>
                            <span className="ml-auto text-[9px]" style={{ color: "var(--text-muted)" }}>{k.key_type}</span>
                          </button>
                        ))}
                      </div>
                    ) : databases[conn.id] && databases[conn.id]!.map((db) => {
                      const dbKey = `${conn.id}:${db}`;
                      const isExp = expandedDbs.has(dbKey);
                      return (
                        <div key={db}>
                          <div
                            onClick={() => toggleDb(conn.id, db)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              const { x, y } = getDbContextMenuPosition(e);
                              setContextMenu({ type: "db", x, y, id: conn.id, database: db });
                            }}
                            className="flex items-center gap-1 w-full px-2 py-1 rounded text-xs hover:opacity-80 cursor-pointer"
                            style={{ color: "var(--text-secondary)" }}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === "Enter") toggleDb(conn.id, db); }}
                          >
                            <FolderOpen size={11} />
                            <span className="truncate">{db}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); openDbQuery(conn.id, db); }}
                              className="ml-auto opacity-50 hover:opacity-100"
                              title="在此数据库中查询"
                            >
                              <Play size={9} />
                            </button>
                          </div>
                          {isExp && tables[dbKey]?.map((t) => {
                            return (
                              <div key={t.name} className="ml-3">
                                <div
                                  onClick={() => loadTableDetail(conn.id, db, t.name, "info")}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    loadTableDetail(conn.id, db, t.name, "info");
                                  }}
                                  className="flex items-center gap-1 w-full px-2 py-0.5 rounded text-xs hover:opacity-80 cursor-pointer"
                                  style={{ color: "var(--text-secondary)" }}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => { if (e.key === "Enter") loadTableDetail(conn.id, db, t.name, "info"); }}
                                >
                                  <Table2 size={10} />
                                  <span className="truncate">{t.name}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); viewTableData(conn.id, db, t.name); }}
                                    className="ml-auto opacity-50 hover:opacity-100"
                                    title="查看前 20 行"
                                  >
                                    <Play size={9} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>}
      </div>

      {/* Main Content */}
      <div className="database-main flex-1 flex flex-col overflow-auto">
        {/* Query Editor */}
        {queryConnId && (
          <div className="database-editor">
            <div className="p-3 flex items-center gap-2 border-b" style={{ borderColor: "var(--border-color)" }}>
              <div className="w-2 h-2 rounded-full" style={{ background: "var(--bg-success)" }} />
              <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                {queryIsRedis ? "Redis 命令" : "SQL 查询"}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--bg-input)", color: "var(--text-secondary)" }}>
                {connections.find((c) => c.id === queryConnId)?.name}
              </span>
              {queryDb && (
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--bg-input)", color: "var(--text-secondary)" }}>
                  {queryDb}
                </span>
              )}
              <div className="ml-auto flex gap-1.5">
                <button onClick={queryIsRedis ? runRedisCmd : runQuery} disabled={queryLoading} className="btn-primary flex items-center gap-1 text-xs py-1 px-3">
                  {queryLoading ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                  运行
                </button>
                {(queryResult || redisKeyDetail) && (
                  <button onClick={exportCurrentCsv} className="btn-secondary flex items-center gap-1 text-xs py-1 px-3">
                    <Download size={11} />
                    CSV
                  </button>
                )}
                <button
                  onClick={() => { setQueryConnId(null); setQueryResult(null); setRedisKeyDetail(null); setRedisKeyDetailName(null); setQueryError(null); }}
                  className="btn-secondary text-xs py-1 px-2"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
            <textarea
              value={queryIsRedis ? redisCmd : query}
              onChange={(e) => queryIsRedis ? setRedisCmd(e.target.value) : setQuery(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); queryIsRedis ? runRedisCmd() : runQuery(); } }}
              className="w-full p-3 font-mono text-xs resize-none"
              style={{ background: "transparent", color: "var(--text-primary)", height: 120, outline: "none", border: "none" }}
              placeholder={queryIsRedis ? "输入 Redis 命令，例如 GET key 或 HGETALL hash... (Cmd+Enter 运行)" : "输入 SQL 查询... (Cmd+Enter 运行)"}
              spellCheck={false}
            />
          </div>
        )}

        {/* Results Area */}
        <div className="database-results flex-1 overflow-auto p-5">
          {/* Table Detail */}
          {tableDetailTarget && (
            <div className="panel overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-color)" }}>
                <h3 className="text-base font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                  表属性 · {tableDetailTarget.database}.{tableDetailTarget.table}
                </h3>
                <button onClick={() => setTableDetailTarget(null)} className="p-1 rounded-md hover:opacity-70" style={{ background: "var(--bg-input)" }}>
                  <X size={14} />
                </button>
              </div>
              <div className="database-detail-tabs">
                {([
                  ["info", Info, "属性"],
                  ["fields", Table2, "字段"],
                  ["indexes", KeyRound, "索引"],
                  ["ddl", FileText, "DDL"],
                ] as const).map(([tab, Icon, label]) => (
                  <button key={tab} onClick={() => setTableDetailTab(tab)} className={tableDetailTab === tab ? "active" : ""}>
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>
              <div className="p-5 overflow-auto" style={{ maxHeight: "calc(100vh - 340px)" }}>
                {tableDetailLoading ? (
                  <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    <Loader2 size={14} className="animate-spin" />
                    加载中
                  </div>
                ) : tableDetail && tableDetailTab === "info" ? (
                  <div className="database-detail-grid">
                    <span>类型</span><strong>{tableDetail.table_type}</strong>
                    <span>引擎</span><strong>{tableDetail.engine || "-"}</strong>
                    <span>行数</span><strong>{tableDetail.row_count ?? "-"}</strong>
                    <span>数据大小</span><strong>{formatBytes(tableDetail.data_size_bytes)}</strong>
                    <span>索引大小</span><strong>{formatBytes(tableDetail.index_size_bytes)}</strong>
                    <span>字段数</span><strong>{tableDetail.columns.length}</strong>
                  </div>
                ) : tableDetail && tableDetailTab === "fields" ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <button onClick={openAddColumn} className="btn-primary text-xs">新建字段</button>
                    </div>
                    <div className="database-table-wrap overflow-auto rounded-lg">
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ background: "var(--bg-input)" }}>
                            <th className="text-left px-3 py-2">字段</th>
                            <th className="text-left px-3 py-2">类型</th>
                            <th className="text-left px-3 py-2">主键</th>
                            <th className="text-left px-3 py-2">可空</th>
                            <th className="text-left px-3 py-2">默认值</th>
                            <th className="text-left px-3 py-2">备注</th>
                            <th className="text-right px-3 py-2">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableDetail.columns.map((col) => (
                            <tr key={col.name} className="border-t" style={{ borderColor: "var(--border-color)" }}>
                              <td className="px-3 py-2 font-mono">{col.name}</td>
                              <td className="px-3 py-2 font-mono">{col.data_type}</td>
                              <td className="px-3 py-2">{col.is_primary_key ? "是" : "否"}</td>
                              <td className="px-3 py-2">{col.nullable ? "是" : "否"}</td>
                              <td className="px-3 py-2 font-mono">{col.default_value ?? "-"}</td>
                              <td className="px-3 py-2">{col.comment || "-"}</td>
                              <td className="px-3 py-2 text-right">
                                <button onClick={() => dropColumn(col.name)} className="database-mini-action" title="删除字段">
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : tableDetail && tableDetailTab === "indexes" ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <button onClick={openIndexCreate} className="btn-primary text-xs">新建索引</button>
                    </div>
                    <div className="database-table-wrap overflow-auto rounded-lg">
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ background: "var(--bg-input)" }}>
                            <th className="text-left px-3 py-2">名称</th>
                            <th className="text-left px-3 py-2">字段</th>
                            <th className="text-left px-3 py-2">唯一</th>
                            <th className="text-right px-3 py-2">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableDetail.indexes.map((idx) => (
                            <tr key={idx.name} className="border-t" style={{ borderColor: "var(--border-color)" }}>
                              <td className="px-3 py-2 font-mono">{idx.name}</td>
                              <td className="px-3 py-2 font-mono">{idx.columns.join(", ") || "-"}</td>
                              <td className="px-3 py-2">{idx.unique ? "是" : "否"}</td>
                              <td className="px-3 py-2 text-right">
                                <button onClick={() => dropIndex(idx.name)} className="database-mini-action" title="删除索引">
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : tableDetail && tableDetailTab === "ddl" ? (
                  <div className="space-y-3">
                    <div className="flex justify-end">
                      <button onClick={copyDdl} disabled={!tableDetail.ddl} className="btn-secondary flex items-center gap-1 text-xs py-1 px-3">
                        <Copy size={12} />
                        {ddlCopied ? "已复制" : "复制"}
                      </button>
                    </div>
                    <pre
                      className="database-ddl-block"
                      dangerouslySetInnerHTML={{ __html: tableDetail.ddl ? highlightSQL(tableDetail.ddl) : "当前数据库未返回 DDL" }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Error */}
          {queryError && (
            <div className="panel p-3 mb-4" style={{ borderColor: "rgba(255, 59, 48, 0.2)" }}>
              <div className="flex items-center gap-2">
                <AlertCircle size={14} style={{ color: "var(--bg-danger)" }} />
                <p className="text-xs" style={{ color: "var(--bg-danger)" }}>{queryError}</p>
              </div>
            </div>
          )}

          {/* Query Result */}
          {(queryResult || redisKeyDetail) && (() => {
            const result = queryResult || redisKeyDetail!;
            return (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} style={{ color: "var(--bg-success)" }} />
                      <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                        {redisKeyDetailName || (tableDataContext ? `${tableDataContext.table} · 前 20 行` : "查询结果")}
                      </span>
                    </div>
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {result.rows.length} 行 · {result.execution_time_ms}ms
                      {tableDataContext && " · 双击单元格编辑"}
                    </span>
                  </div>
                  {redisKeyDetailName && (
                    <button onClick={() => { setRedisKeyDetail(null); setRedisKeyDetailName(null); }} className="text-xs" style={{ color: "var(--text-muted)" }}>
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="database-table-wrap overflow-auto rounded-lg">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "var(--bg-input)" }}>
                        {result.columns.map((col) => (
                          <th key={col} className="text-left px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.slice(0, 200).map((row, i) => (
                        <tr key={i} className="border-t" style={{ borderColor: "var(--border-color)" }}>
                          {row.map((cell, j) => {
                            const column = result.columns[j];
                            const isEditing = editingCell?.rowIndex === i && editingCell.column === column;
                            return (
                              <td
                                key={j}
                                className="px-3 py-1.5 whitespace-nowrap max-w-[300px] truncate font-mono database-result-cell"
                                style={{ color: cell === null ? "var(--text-muted)" : "var(--text-primary)" }}
                                onDoubleClick={() => {
                                  if (tableDataContext && !savingCell) {
                                    setEditingCell({ rowIndex: i, column, value: cell ?? "" });
                                  }
                                }}
                                title={tableDataContext ? "双击编辑" : undefined}
                              >
                                {isEditing ? (
                                  <input
                                    autoFocus
                                    className="database-cell-input"
                                    value={editingCell.value}
                                    onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                    onBlur={commitCellEdit}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        e.currentTarget.blur();
                                      }
                                      if (e.key === "Escape") {
                                        setEditingCell(null);
                                      }
                                    }}
                                    disabled={savingCell}
                                  />
                                ) : (
                                  cell === null ? "NULL" : cell
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.rows.length > 200 && (
                  <p className="text-xs mt-2 text-center" style={{ color: "var(--text-muted)" }}>
                    显示前 200 行，共 {result.rows.length} 行
                  </p>
                )}
              </div>
            );
          })()}

          {showDatabaseEmptyState && (
            <div className="database-empty panel flex flex-col items-center justify-center h-full text-center">
              <DatabaseIcon size={48} className="mb-4" style={{ color: "var(--text-muted)" }} />
              <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
                数据库管理
              </h3>
              <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
                连接 MySQL、PostgreSQL、SQLite 或 Redis 数据库
              </p>
              <div className="flex gap-2">
                <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-1.5">
                  <Plus size={14} />
                  新建连接
                </button>
              </div>
              <div className="flex gap-4 mt-6">
                {["MySQL", "PostgreSQL", "SQLite", "Redis"].map((t) => (
                  <div key={t} className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    <div className="w-2 h-2 rounded-full" style={{ background: DB_COLORS[t] }} />
                    {t}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Connection Modal */}
      {showAddModal && (
        <AddConnectionModal
          onclose={() => setShowAddModal(false)}
          onsaved={async () => { setShowAddModal(false); await loadConnections(); }}
        />
      )}
      {editingConnection && (
        <AddConnectionModal
          connection={editingConnection}
          onclose={() => setEditingConnection(null)}
          onsaved={async () => {
            const editedId = editingConnection.id;
            setEditingConnection(null);
            setDatabases((prev) => {
              const next = { ...prev };
              delete next[editedId];
              return next;
            });
            setTables((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(`${editedId}:`))));
            setRedisKeys((prev) => {
              const next = { ...prev };
              delete next[editedId];
              return next;
            });
            setConnectedIds((prev) => {
              const next = new Set(prev);
              next.delete(editedId);
              return next;
            });
            if (queryConnId === editedId) {
              setQueryConnId(null);
              setQueryResult(null);
              setRedisKeyDetail(null);
              setRedisKeyDetailName(null);
            }
            await loadConnections();
          }}
        />
      )}
      {contextMenu && createPortal((
        <div
          className="database-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => openCreateTable(contextMenu.id, contextMenu.database)}>
            <Plus size={13} />
            建表
          </button>
          <button onClick={() => showDatabaseInfo(contextMenu.id, contextMenu.database)}>
            <Info size={13} />
            DB 属性
          </button>
          <button onClick={() => { openDbQuery(contextMenu.id, contextMenu.database); setContextMenu(null); }}>
            <Play size={13} />
            SQL 查询
          </button>
        </div>
      ), document.body)}
      {(dbInfo || dbInfoLoading) && (
        <div className="modal-overlay">
          <div className="modal-panel w-[420px] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-color)" }}>
              <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>DB 属性</h3>
              <button onClick={() => setDbInfo(null)} className="p-1 rounded-md hover:opacity-70" style={{ background: "var(--bg-input)" }}>
                <X size={14} />
              </button>
            </div>
            <div className="p-5">
              {dbInfoLoading ? (
                <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  <Loader2 size={14} className="animate-spin" />
                  加载中
                </div>
              ) : dbInfo && (
                <div className="database-detail-grid">
                  <span>名称</span><strong>{dbInfo.name}</strong>
                  <span>表数量</span><strong>{dbInfo.table_count}</strong>
                  <span>大小</span><strong>{formatBytes(dbInfo.size_bytes)}</strong>
                  <span>字符集</span><strong>{dbInfo.default_charset || "-"}</strong>
                  <span>排序规则</span><strong>{dbInfo.default_collation || "-"}</strong>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {createTableTarget && (
        <div className="modal-overlay">
          <div className="modal-panel w-[620px] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-color)" }}>
              <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>建表 · {createTableTarget.database}</h3>
              <button onClick={() => setCreateTableTarget(null)} className="p-1 rounded-md hover:opacity-70" style={{ background: "var(--bg-input)" }}>
                <X size={14} />
              </button>
            </div>
            <div className="p-5">
              <textarea
                value={createTableDdl}
                onChange={(e) => setCreateTableDdl(e.target.value)}
                className="macos-input font-mono text-xs"
                style={{ height: 220, resize: "vertical" }}
              />
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: "var(--border-color)" }}>
              <button onClick={() => setCreateTableTarget(null)} className="btn-secondary">取消</button>
              <button onClick={submitCreateTable} className="btn-primary">执行建表</button>
            </div>
          </div>
        </div>
      )}
      {createColumnTarget && (
        <div className="modal-overlay">
          <div className="modal-panel w-[460px] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-color)" }}>
              <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>新建字段 · {createColumnTarget.table}</h3>
              <button onClick={() => setCreateColumnTarget(null)} className="p-1 rounded-md hover:opacity-70" style={{ background: "var(--bg-input)" }}>
                <X size={14} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>字段名</label>
                <input
                  value={createColumnForm.name}
                  onChange={(e) => setCreateColumnForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="macos-input"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>类型</label>
                <input
                  value={createColumnForm.dataType}
                  onChange={(e) => setCreateColumnForm((prev) => ({ ...prev, dataType: e.target.value }))}
                  className="macos-input font-mono"
                  placeholder="VARCHAR(255)"
                />
              </div>
              <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                <input
                  type="checkbox"
                  checked={createColumnForm.nullable}
                  onChange={(e) => setCreateColumnForm((prev) => ({ ...prev, nullable: e.target.checked }))}
                />
                允许为空
              </label>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>默认值</label>
                <input
                  value={createColumnForm.defaultValue}
                  onChange={(e) => setCreateColumnForm((prev) => ({ ...prev, defaultValue: e.target.value }))}
                  className="macos-input font-mono"
                  placeholder="留空则不设置"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>备注</label>
                <input
                  value={createColumnForm.comment}
                  onChange={(e) => setCreateColumnForm((prev) => ({ ...prev, comment: e.target.value }))}
                  className="macos-input"
                  placeholder="可选"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: "var(--border-color)" }}>
              <button onClick={() => setCreateColumnTarget(null)} className="btn-secondary">取消</button>
              <button onClick={addColumn} className="btn-primary">创建字段</button>
            </div>
          </div>
        </div>
      )}
      {createIndexTarget && (
        <div className="modal-overlay">
          <div className="modal-panel w-[460px] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-color)" }}>
              <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>新建索引 · {createIndexTarget.table}</h3>
              <button onClick={() => setCreateIndexTarget(null)} className="p-1 rounded-md hover:opacity-70" style={{ background: "var(--bg-input)" }}>
                <X size={14} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>索引名</label>
                <input
                  value={createIndexForm.name}
                  onChange={(e) => setCreateIndexForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="macos-input"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>字段</label>
                <input
                  value={createIndexForm.columns}
                  onChange={(e) => setCreateIndexForm((prev) => ({ ...prev, columns: e.target.value }))}
                  className="macos-input font-mono"
                  placeholder="id, name"
                />
              </div>
              <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                <input
                  type="checkbox"
                  checked={createIndexForm.unique}
                  onChange={(e) => setCreateIndexForm((prev) => ({ ...prev, unique: e.target.checked }))}
                />
                唯一索引
              </label>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: "var(--border-color)" }}>
              <button onClick={() => setCreateIndexTarget(null)} className="btn-secondary">取消</button>
              <button onClick={submitIndexCreate} className="btn-primary">创建索引</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function AddConnectionModal({
  connection,
  onclose,
  onsaved,
}: {
  connection?: SavedConnection;
  onclose: () => void;
  onsaved: () => void;
}) {
  const isEditing = Boolean(connection);
  const initialType = connection?.db_type.type ?? "MySQL";
  const [name, setName] = useState(connection?.name ?? "");
  const [dbType, setDbType] = useState(initialType);
  const [config, setConfig] = useState<DbType>(connection?.db_type ?? defaultConfig("MySQL"));
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const testConn = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const ok = await invoke<boolean>("test_db_connection", { dbType: config });
      setTestResult({ ok, msg: ok ? "连接成功" : "连接失败" });
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (connection) {
        await invoke("update_db_connection", { id: connection.id, name, dbType: config, color: connection.color || "" });
      } else {
        await invoke("save_db_connection", { name, dbType: config, color: "" });
      }
      onsaved();
    } catch (e) {
      alert(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (field: string, value: string | number | boolean) => {
    if (config.type === "SQLite") {
      setConfig({ ...config, config: { ...config.config, [field]: value } } as DbType);
    } else {
      setConfig({ ...config, config: { ...config.config, [field]: value } } as DbType);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center p-5" style={{ background: "rgba(0,0,0,0.4)", zIndex: 100 }}>
      <div className="modal-panel w-[450px] overflow-hidden" style={{ maxHeight: "calc(100vh - 40px)" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-color)" }}>
          <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {isEditing ? "编辑数据库连接" : "新建数据库连接"}
          </h3>
          <button onClick={onclose} className="p-1 rounded-md hover:opacity-70" style={{ background: "var(--bg-input)" }}>
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>连接名称</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="macos-input" placeholder="My Database" />
          </div>

          {/* DB Type */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>数据库类型</label>
            <div className="flex gap-2">
              {(["MySQL", "PostgreSQL", "SQLite", "Redis"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setDbType(t); setConfig(defaultConfig(t)); setTestResult(null); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: dbType === t ? DB_COLORS[t] : "var(--bg-input)",
                    color: dbType === t ? "#fff" : "var(--text-secondary)",
                  }}
                >
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: dbType === t ? "#fff" : DB_COLORS[t] }} />
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Config Fields */}
          {config.type === "SQLite" ? (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>数据库文件路径</label>
              <input
                value={(config as { type: "SQLite"; config: DbSQLiteConfig }).config.path}
                onChange={(e) => updateConfig("path", e.target.value)}
                className="macos-input"
                placeholder="/path/to/database.db"
              />
            </div>
          ) : config.type === "Redis" ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>主机</label>
                  <input
                    value={(config as { type: "Redis"; config: DbRedisConfig }).config.host}
                    onChange={(e) => updateConfig("host", e.target.value)}
                    className="macos-input"
                    placeholder="localhost"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>端口</label>
                  <input
                    type="number"
                    value={(config as { type: "Redis"; config: DbRedisConfig }).config.port}
                    onChange={(e) => updateConfig("port", Number(e.target.value))}
                    className="macos-input"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>密码</label>
                <input
                  type="password"
                  value={(config as { type: "Redis"; config: DbRedisConfig }).config.password}
                  onChange={(e) => updateConfig("password", e.target.value)}
                  className="macos-input"
                  placeholder="可留空"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>数据库编号</label>
                <input
                  type="number"
                  min={0}
                  value={(config as { type: "Redis"; config: DbRedisConfig }).config.database}
                  onChange={(e) => updateConfig("database", Number(e.target.value))}
                  className="macos-input"
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>主机</label>
                  <input
                    value={(config as { type: "MySQL" | "PostgreSQL"; config: DbConnectionConfig }).config.host}
                    onChange={(e) => updateConfig("host", e.target.value)}
                    className="macos-input"
                    placeholder="localhost"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>端口</label>
                  <input
                    type="number"
                    value={(config as { type: "MySQL" | "PostgreSQL"; config: DbConnectionConfig }).config.port}
                    onChange={(e) => updateConfig("port", Number(e.target.value))}
                    className="macos-input"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>用户名</label>
                <input
                  value={(config as { type: "MySQL" | "PostgreSQL"; config: DbConnectionConfig }).config.username}
                  onChange={(e) => updateConfig("username", e.target.value)}
                  className="macos-input"
                  placeholder="root"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>密码</label>
                <input
                  type="password"
                  value={(config as { type: "MySQL" | "PostgreSQL"; config: DbConnectionConfig }).config.password}
                  onChange={(e) => updateConfig("password", e.target.value)}
                  className="macos-input"
                  placeholder="••••••••"
                />
              </div>
              {config.type === "PostgreSQL" && (
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>默认数据库</label>
                  <input
                    value={(config as { type: "PostgreSQL"; config: DbConnectionConfig }).config.database}
                    onChange={(e) => updateConfig("database", e.target.value)}
                    className="macos-input"
                    placeholder="postgres"
                  />
                </div>
              )}
            </>
          )}

          {/* Test Result */}
          {testResult && (
            <div className="flex items-center gap-2 text-xs p-2 rounded-md" style={{
              background: testResult.ok ? "rgba(52, 199, 89, 0.1)" : "rgba(255, 59, 48, 0.1)",
              color: testResult.ok ? "var(--bg-success)" : "var(--bg-danger)",
            }}>
              {testResult.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {testResult.msg}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: "var(--border-color)" }}>
          <button onClick={testConn} disabled={testing} className="btn-secondary flex items-center gap-1.5">
            {testing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            测试连接
          </button>
          <button onClick={save} disabled={saving || !name.trim()} className="btn-primary flex items-center gap-1.5">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Server size={13} />}
            {isEditing ? "保存修改" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
