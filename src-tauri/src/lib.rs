mod commands;

use commands::{
    caffeinate::{self, CaffeinateState},
    clipboard::{self, ClipboardState},
    notes::{self, NotesState},
    screenshot, performance, http_client, ssh_shell, mac_cleaner,
    database::commands as db_commands,
};

use db_commands::DbState;
use ssh_shell::SshState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    sqlx::any::install_default_drivers();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(CaffeinateState {
            child: std::sync::Mutex::new(None),
            end_time: std::sync::Mutex::new(None),
        })
        .manage(ClipboardState::new())
        .manage(DbState {
            mysql: std::sync::Mutex::new(std::collections::HashMap::new()),
            postgres: std::sync::Mutex::new(std::collections::HashMap::new()),
            sqlite: std::sync::Mutex::new(std::collections::HashMap::new()),
            redis: std::sync::Mutex::new(std::collections::HashMap::new()),
        })
        .manage(SshState::new())
        .manage(NotesState::new())
        .invoke_handler(tauri::generate_handler![
            caffeinate::start_caffeinate,
            caffeinate::stop_caffeinate,
            caffeinate::caffeinate_status,
            clipboard::start_clipboard_watch,
            clipboard::stop_clipboard_watch,
            clipboard::get_clipboard_items,
            clipboard::clear_clipboard_items,
            clipboard::delete_clipboard_item,
            clipboard::toggle_clipboard_item_pin,
            clipboard::get_clipboard_config,
            clipboard::set_clipboard_max_items,
            clipboard::write_clipboard,
            screenshot::capture_screenshot,
            screenshot::capture_selected_screenshot,
            screenshot::save_screenshot,
            performance::get_system_stats,
            http_client::send_http_request,
            ssh_shell::list_ssh_connections,
            ssh_shell::save_ssh_connection,
            ssh_shell::delete_ssh_connection,
            ssh_shell::start_ssh_session,
            ssh_shell::write_ssh_session,
            ssh_shell::stop_ssh_session,
            ssh_shell::resize_ssh_session,
            ssh_shell::sftp_start_session,
            ssh_shell::sftp_list_dir,
            ssh_shell::sftp_mkdir,
            ssh_shell::sftp_remove,
            ssh_shell::stop_sftp_session,
            ssh_shell::sftp_upload,
            ssh_shell::sftp_create_file,
            db_commands::test_db_connection,
            db_commands::save_db_connection,
            db_commands::update_db_connection,
            db_commands::list_db_connections,
            db_commands::list_connected_db_ids,
            db_commands::delete_db_connection,
            db_commands::connect_db,
            db_commands::disconnect_db,
            db_commands::execute_db_query,
            db_commands::list_databases,
            db_commands::list_tables,
            db_commands::list_columns,
            db_commands::get_table_data,
            db_commands::update_table_cell,
            db_commands::get_database_info,
            db_commands::create_table,
            db_commands::get_table_detail,
            db_commands::insert_table_row,
            db_commands::delete_table_row,
            db_commands::create_table_index,
            db_commands::drop_table_index,
            db_commands::add_column,
            db_commands::drop_column,
            db_commands::redis_scan_keys,
            db_commands::redis_get_key,
            db_commands::redis_execute,
            notes::list_notes,
            notes::create_note,
            notes::update_note,
            notes::delete_note,
            notes::archive_note,
            notes::unarchive_note,
            mac_cleaner::scan_mac_cleanup,
            mac_cleaner::delete_mac_cleanup_items,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
