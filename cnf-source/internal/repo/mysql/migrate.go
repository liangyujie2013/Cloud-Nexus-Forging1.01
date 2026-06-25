package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// migrationFile 描述一个已发现的迁移文件。
type migrationFile struct {
	version  string // 文件名前缀编号，如 "0001"
	name     string // 完整文件名
	fullPath string
}

// RunMigrations 按文件名顺序执行 migrationsDir 下所有 *.up.sql 迁移，
// 并通过 schema_migrations 表记录已应用版本，保证幂等。
//
// 设计要点：
//   - 仅执行尚未记录的版本；已应用的跳过（支持反复启动）。
//   - 每个文件内可含多条以分号分隔的语句，逐条执行。
//   - schema_migrations 表自身先行创建。
//   - 单个迁移文件在一个事务内执行，失败整体回滚（DDL 在 MySQL 不支持
//     事务回滚，但仍能避免记录脏版本号）。
func RunMigrations(ctx context.Context, db *sql.DB, migrationsDir string) error {
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    VARCHAR(64) PRIMARY KEY,
			applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return fmt.Errorf("创建 schema_migrations 表失败: %w", err)
	}

	applied, err := loadAppliedVersions(ctx, db)
	if err != nil {
		return err
	}

	files, err := discoverMigrations(migrationsDir)
	if err != nil {
		return err
	}

	for _, f := range files {
		if applied[f.version] {
			continue
		}
		if err := applyMigration(ctx, db, f); err != nil {
			return fmt.Errorf("应用迁移 %s 失败: %w", f.name, err)
		}
	}
	return nil
}

func loadAppliedVersions(ctx context.Context, db *sql.DB) (map[string]bool, error) {
	rows, err := db.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("查询已应用迁移失败: %w", err)
	}
	defer rows.Close()
	out := make(map[string]bool)
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out[v] = true
	}
	return out, rows.Err()
}

func discoverMigrations(dir string) ([]migrationFile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("读取迁移目录 %s 失败: %w", dir, err)
	}
	var files []migrationFile
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".up.sql") {
			continue
		}
		version := e.Name()
		if i := strings.IndexByte(version, '_'); i > 0 {
			version = version[:i]
		}
		files = append(files, migrationFile{
			version:  version,
			name:     e.Name(),
			fullPath: filepath.Join(dir, e.Name()),
		})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].name < files[j].name })
	return files, nil
}

func applyMigration(ctx context.Context, db *sql.DB, f migrationFile) error {
	raw, err := os.ReadFile(f.fullPath)
	if err != nil {
		return err
	}
	stmts := splitSQLStatements(string(raw))

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	for _, stmt := range stmts {
		if strings.TrimSpace(stmt) == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("执行语句失败: %w\n--- SQL ---\n%s", err, truncate(stmt, 400))
		}
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO schema_migrations (version) VALUES (?)`, f.version); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// splitSQLStatements 将 SQL 脚本按分号拆分为独立语句。
// 跳过整行注释（-- 开头），并忽略空白语句。
// 注：本项目迁移脚本不含分隔符为分号的存储过程/触发器，故无需处理 DELIMITER。
func splitSQLStatements(script string) []string {
	var clean strings.Builder
	for _, line := range strings.Split(script, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "--") {
			continue
		}
		clean.WriteString(line)
		clean.WriteByte('\n')
	}
	parts := strings.Split(clean.String(), ";")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			out = append(out, p)
		}
	}
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
