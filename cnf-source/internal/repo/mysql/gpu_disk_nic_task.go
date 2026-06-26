package mysql

import (
	"context"
	"database/sql"
	"errors"

	"github.com/cnf/cnfv1/internal/model"
)

// ============================================================================
// GPU
// ============================================================================

func (r *Repository) GetGPU(ctx context.Context, id int) (*model.GPUDevice, error) {
	var g model.GPUDevice
	err := r.db.QueryRowContext(ctx,
		`SELECT id, host_id, pci_address, COALESCE(vendor,''), COALESCE(model,''), mode, status
		 FROM gpu_devices WHERE id=?`, id).
		Scan(&g.ID, &g.HostID, &g.PCIAddress, &g.Vendor, &g.Model, &g.Mode, &g.Status)
	if err != nil {
		return nil, err
	}
	return &g, nil
}

func (r *Repository) ListGPUsByHost(ctx context.Context, hostID int) ([]model.GPUDevice, error) {
	q := `SELECT id, host_id, pci_address, COALESCE(vendor,''), COALESCE(model,''), mode, status FROM gpu_devices`
	args := []any{}
	if hostID > 0 {
		q += ` WHERE host_id=?`
		args = append(args, hostID)
	}
	q += ` ORDER BY id`
	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.GPUDevice
	for rows.Next() {
		var g model.GPUDevice
		if err := rows.Scan(&g.ID, &g.HostID, &g.PCIAddress, &g.Vendor, &g.Model, &g.Mode, &g.Status); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (r *Repository) UpsertGPU(ctx context.Context, g *model.GPUDevice) (int, error) {
	const q = `INSERT INTO gpu_devices (uuid, host_id, pci_address, vendor, model, mode)
		VALUES (?,?,?,?,?,?)
		ON DUPLICATE KEY UPDATE vendor=VALUES(vendor), model=VALUES(model)`
	res, err := r.db.ExecContext(ctx, q,
		newUUIDOr(g.UUID), g.HostID, g.PCIAddress, nullStr(g.Vendor), nullStr(g.Model), g.Mode)
	if err != nil {
		return 0, err
	}
	if id, _ := res.LastInsertId(); id > 0 {
		return int(id), nil
	}
	var id int
	err = r.db.QueryRowContext(ctx,
		`SELECT id FROM gpu_devices WHERE host_id=? AND pci_address=?`, g.HostID, g.PCIAddress).Scan(&id)
	return id, err
}

// AssignGPU 登记 vm_gpus 关联并将设备状态置为 assigned。
func (r *Repository) AssignGPU(ctx context.Context, vmID, gpuID int, mdevUUID string) error {
	return r.withTx(ctx, func(tx *sql.Tx) error {
		var mdev any
		if mdevUUID != "" {
			mdev = mdevUUID
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO vm_gpus (vm_id, gpu_device_id, mdev_uuid) VALUES (?,?,?)
			 ON DUPLICATE KEY UPDATE mdev_uuid=VALUES(mdev_uuid)`,
			vmID, gpuID, mdev); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE gpu_devices SET status='assigned' WHERE id=?`, gpuID)
		return err
	})
}

// ReleaseGPU 解除分配并恢复设备 available。
func (r *Repository) ReleaseGPU(ctx context.Context, vmID, gpuID int) error {
	return r.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM vm_gpus WHERE vm_id=? AND gpu_device_id=?`, vmID, gpuID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE gpu_devices SET status='available' WHERE id=?`, gpuID)
		return err
	})
}

// ============================================================================
// Disk / NIC
// ============================================================================

func (r *Repository) ListDisks(ctx context.Context, vmID int) ([]model.VMDisk, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT name, device, bus, format, COALESCE(path,''), size_bytes, bootable
		 FROM vm_disks WHERE vm_id=? ORDER BY id`, vmID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.VMDisk
	for rows.Next() {
		var d model.VMDisk
		if err := rows.Scan(&d.Name, &d.Device, &d.Bus, &d.Format, &d.Path, &d.SizeBytes, &d.Bootable); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (r *Repository) CreateDisk(ctx context.Context, d *model.VMDisk) (int, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO vm_disks (uuid, vm_id, name, device, bus, format, path, size_bytes, bootable)
		 VALUES (?,?,?,?,?,?,?,?,?)`,
		newUUIDOr(d.UUID), d.VMID, d.Name, d.Device, d.Bus, d.Format, nullStr(d.Path), d.SizeBytes, d.Bootable)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	return int(id), err
}

func (r *Repository) ListNICs(ctx context.Context, vmID int) ([]model.VMNic, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, vm_id, mac_address, model, COALESCE(ip_address,''), order_index
		 FROM vm_nics WHERE vm_id=? ORDER BY order_index, id`, vmID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.VMNic
	for rows.Next() {
		var n model.VMNic
		if err := rows.Scan(&n.ID, &n.VMID, &n.MACAddress, &n.Model, &n.IPAddress, &n.OrderIndex); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (r *Repository) CreateNIC(ctx context.Context, n *model.VMNic) (int, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO vm_nics (uuid, vm_id, mac_address, model, order_index)
		 VALUES (?,?,?,?,?)`,
		newUUIDOr(n.UUID), n.VMID, n.MACAddress, n.Model, n.OrderIndex)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	return int(id), err
}

// ============================================================================
// Task
// ============================================================================

func (r *Repository) CreateTask(ctx context.Context, t *model.Task) (int, error) {
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO tasks (uuid, type, target_type, target_id, status, progress, user_id, payload)
		 VALUES (?,?,?,?,?,?,?,?)`,
		newUUIDOr(t.UUID), t.Type, nullStr(t.TargetType), nullZeroInt(t.TargetID),
		t.Status, t.Progress, nullInt(t.UserID), mustJSON(t.Payload, false))
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	return int(id), err
}

func (r *Repository) UpdateTask(ctx context.Context, t *model.Task) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE tasks SET status=?, progress=?, error_message=?, result=?, started_at=?, finished_at=?
		 WHERE id=?`,
		t.Status, t.Progress, nullStr(t.ErrorMessage), mustJSON(t.Result, false),
		t.StartedAt, t.FinishedAt, t.ID)
	return err
}

const taskColumns = `id, uuid, type, COALESCE(target_type,''), target_id, status, progress,
	user_id, payload, result, COALESCE(error_message,''), started_at, finished_at, created_at`

// scanTask 从行扫描出 Task（JSON 列与可空列安全处理）。
func scanTask(s scanner) (*model.Task, error) {
	var (
		t          model.Task
		uuidStr    string
		targetID   sql.NullInt64
		userID     sql.NullInt64
		payload    []byte
		result     []byte
	)
	if err := s.Scan(
		&t.ID, &uuidStr, &t.Type, &t.TargetType, &targetID, &t.Status, &t.Progress,
		&userID, &payload, &result, &t.ErrorMessage, &t.StartedAt, &t.FinishedAt, &t.CreatedAt,
	); err != nil {
		return nil, err
	}
	t.UUID = uuidParse(uuidStr)
	t.TargetID = int(targetID.Int64)
	t.UserID = intPtr(userID)
	_ = scanJSON(payload, &t.Payload)
	_ = scanJSON(result, &t.Result)
	return &t, nil
}

// GetTask 按自增 id 查询任务。
func (r *Repository) GetTask(ctx context.Context, id int) (*model.Task, error) {
	t, err := scanTask(r.db.QueryRowContext(ctx,
		`SELECT `+taskColumns+` FROM tasks WHERE id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

// GetTaskByUUID 按 UUID 查询任务（前端轮询/取消使用）。
func (r *Repository) GetTaskByUUID(ctx context.Context, u string) (*model.Task, error) {
	t, err := scanTask(r.db.QueryRowContext(ctx,
		`SELECT `+taskColumns+` FROM tasks WHERE uuid=?`, u))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

// ListTasks 列出任务（可按 status 过滤），按创建时间倒序，最多 limit 条。
func (r *Repository) ListTasks(ctx context.Context, status string, limit int) ([]model.Task, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	q := `SELECT ` + taskColumns + ` FROM tasks`
	args := []any{}
	if status != "" {
		q += ` WHERE status=?`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC, id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Task{}
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}
