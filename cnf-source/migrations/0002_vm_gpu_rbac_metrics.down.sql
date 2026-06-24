-- 回滚 0002
DROP TABLE IF EXISTS audit_logs, metrics_samples, tasks, users,
    vm_snapshots, vm_nics, vm_disks, vm_gpus, gpu_devices, vms CASCADE;
DROP FUNCTION IF EXISTS trg_set_updated_at() CASCADE;
