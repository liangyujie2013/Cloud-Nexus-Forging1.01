-- 回滚 0001
DROP TABLE IF EXISTS networks, storage_pools, hosts, clusters, datacenters CASCADE;
DROP TYPE IF EXISTS host_status, vm_status, gpu_status, gpu_mode, storage_type,
    disk_bus, boot_mode, task_status CASCADE;
