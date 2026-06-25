SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS audit_logs, metrics_samples, alert_rules, tasks, users, roles,
    vm_snapshots, vm_nics, vm_disks, vm_gpus, gpu_devices, vms;
SET FOREIGN_KEY_CHECKS = 1;
