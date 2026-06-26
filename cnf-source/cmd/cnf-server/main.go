// CNFv1.0 控制面服务入口。
// 提供 REST API（Fiber v3），连接 MySQL/Redis，管理资源层级与 VM 生命周期，
// 支持单节点与 HA（基于 Redis 选主）多节点部署。
package main

import (
	"context"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	v1 "github.com/cnf/cnfv1/internal/api/v1"
	"github.com/cnf/cnfv1/internal/auth"
	"github.com/cnf/cnfv1/internal/cache"
	"github.com/cnf/cnfv1/internal/config"
	"github.com/cnf/cnfv1/internal/gpu"
	"github.com/cnf/cnfv1/internal/ha"
	"github.com/cnf/cnfv1/internal/repo/mysql"
	"github.com/cnf/cnfv1/internal/service"
	"github.com/cnf/cnfv1/internal/storage"
	"github.com/cnf/cnfv1/internal/virt"
	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/logger"
	"github.com/gofiber/fiber/v3/middleware/recover"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	version := config.Version

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// ---- 1. 持久层：MySQL 连接池 ----
	repository, err := mysql.NewFromDSN(ctx, cfg.MySQLDSN, cfg.MySQLMaxOpen, cfg.MySQLMaxIdle)
	if err != nil {
		log.Fatalf("初始化 MySQL 失败: %v", err)
	}
	defer repository.Close()

	// 自动应用数据库迁移（幂等，按 schema_migrations 记录跳过已应用版本）。
	if err := mysql.RunMigrations(ctx, repository.DB(), cfg.MigrationsDir); err != nil {
		log.Fatalf("执行数据库迁移失败: %v", err)
	}
	log.Printf("数据库迁移已就绪 (dir=%s)", cfg.MigrationsDir)

	// ---- 2. 缓存层：Redis（缓存/分布式锁/选主/指标流） ----
	redisCache, err := cache.New(ctx, cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB)
	if err != nil {
		log.Fatalf("初始化 Redis 失败: %v", err)
	}
	defer redisCache.Close()

	// ---- 3. 鉴权 / RBAC ----
	tokens := auth.NewTokenManager(cfg.JWTSecret, cfg.JWTExpireHours)
	authStore := auth.NewStore(repository.DB())
	mw := auth.NewMiddleware(tokens, authStore)

	// ---- 4. libvirt 连接管理器（按宿主机 IP 维护连接池） ----
	conn := virt.NewConnManager()
	defer conn.CloseAll()

	// ---- 5. GPU 管理器 ----
	gpuMgr := gpu.NewManager()

	// ---- 6. 默认存储池：本地 qcow2（CNF_STORAGE_LOCAL_PATH） ----
	// 创建 VM 系统盘时使用。目录不可用仅告警，不阻断启动；真实创建时再报清晰错误。
	localPool := &storage.LocalDriver{}
	if err := localPool.Connect(ctx, map[string]any{"path": cfg.StorageLocalPath}); err != nil {
		log.Printf("警告: 默认存储池初始化失败 (path=%s): %v — 真实创建 VM 将报错，请确认目录可写", cfg.StorageLocalPath, err)
	} else {
		log.Printf("默认存储池就绪: local qcow2 @ %s", cfg.StorageLocalPath)
	}

	// ---- 6. service 层 ----
	vmSvc := service.NewVMService(repository, conn)
	migSvc := service.NewMigrationService(repository, conn)
	snapSvc := service.NewSnapshotService(repository, conn)

	// ---- 7. 异步任务队列 ----
	queue := service.NewTaskQueue(repository, 4)
	queue.Start()
	defer queue.Stop()

	// ---- 8. HA 选主器（单节点恒为 leader；多节点竞争 Redis 锁） ----
	elector := ha.New(redisCache, ha.Config{
		Enabled:     cfg.HAEnabled,
		NodeID:      cfg.NodeID,
		LeaseTTL:    cfg.HALeaseTTL,
		RenewPeriod: cfg.HARenewPeriod,
		OnChange: func(isLeader bool) {
			slog.Info("HA leader 状态变更",
				slog.String("node", cfg.NodeID),
				slog.Bool("is_leader", isLeader))
		},
	})
	go elector.Run(ctx)

	// ---- 9. 周期调度器（仅 leader 执行单点后台巡检） ----
	sched := service.NewScheduler(slog.Default())
	registerScheduledJobs(sched, repository, conn, gpuMgr, redisCache, elector)
	sched.Start()
	defer sched.Stop()

	// ---- 10. HTTP 层 ----
	app := fiber.New(fiber.Config{
		AppName:      "CNFv1.0 Server " + version,
		ServerHeader: "CNF",
	})
	app.Use(recover.New())
	app.Use(logger.New())
	app.Use(cors.New())

	app.Get("/healthz", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":    "ok",
			"version":   version,
			"node":      cfg.NodeID,
			"is_leader": elector.IsLeader(),
			"ha":        cfg.HAEnabled,
		})
	})

	// 全量 API 路由（含 RBAC 中间件）接入真实 service。
	h := &v1.Handlers{
		Repo:      repository,
		MySQL:     repository,
		Conn:      conn,
		VM:        vmSvc,
		Migration: migSvc,
		Snapshot:  snapSvc,
		GPU:       gpuMgr,
		Queue:     queue,
		Tokens:    tokens,
		Auth:      authStore,
		Mw:        mw,
		Cache:     redisCache,

		DefaultStoragePool: localPool,
	}
	v1.RegisterAPIRoutes(app, h)

	addr := cfg.ListenAddr
	if addr == "" {
		addr = ":8080"
	}

	// 优雅停机：监听信号，收到后关闭 Fiber。
	go func() {
		<-ctx.Done()
		slog.Info("收到停机信号，正在关闭服务...")
		_ = app.ShutdownWithTimeout(5 * time.Second)
	}()

	log.Printf("CNFv1.0 Server %s 启动于 %s (node=%s, ha=%v)", version, addr, cfg.NodeID, cfg.HAEnabled)
	if err := app.Listen(addr); err != nil {
		log.Printf("服务退出: %v", err)
		os.Exit(1)
	}
}

// registerScheduledJobs 注册后台周期任务。
// 需要单点执行的任务通过 elector.IsLeader() 守卫，仅 leader 节点实际执行，
// 避免 HA 多节点重复采集/重复决策。
func registerScheduledJobs(
	s *service.Scheduler,
	repo service.Repository,
	conn *virt.ConnManager,
	gpuMgr *gpu.Manager,
	redisCache *cache.Client,
	elector *ha.Elector,
) {
	// 每 30s 采集各 connected 宿主机的 CPU/内存指标（仅 leader）。
	s.Register("collect-host-metrics", 30*time.Second, false, func(ctx context.Context) error {
		if !elector.IsLeader() {
			return nil
		}
		hosts, err := repo.ListHosts(ctx, 0)
		if err != nil {
			return err
		}
		for _, host := range hosts {
			sample, err := conn.CollectHostMetrics(host.IPAddress)
			if err != nil {
				slog.Debug("采集宿主机指标失败",
					slog.String("host", host.IPAddress),
					slog.String("error", err.Error()))
				continue
			}
			// 推入 Redis 指标流，供 SSE 实时订阅消费。
			_ = redisCache.PushMetric(ctx, "host:"+host.IPAddress, sample, 720)
		}
		return nil
	})

	// 每 15s 采集 GPU 利用率（nvidia-smi，仅 leader）。
	s.Register("collect-gpu-metrics", 15*time.Second, false, func(ctx context.Context) error {
		if !elector.IsLeader() {
			return nil
		}
		_, err := gpuMgr.CollectNVIDIAMetrics(ctx)
		return err
	})
}
