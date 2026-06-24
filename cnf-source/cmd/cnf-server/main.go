// CNFv1.0 控制面服务入口。
// 提供 REST API（Fiber v3），连接 PostgreSQL/Redis，管理资源层级与 VM 生命周期。
package main

import (
	"context"
	"log"
	"log/slog"
	"os"
	"time"

	v1 "github.com/cnf/cnfv1/internal/api/v1"
	"github.com/cnf/cnfv1/internal/config"
	"github.com/cnf/cnfv1/internal/gpu"
	"github.com/cnf/cnfv1/internal/repo"
	"github.com/cnf/cnfv1/internal/service"
	"github.com/cnf/cnfv1/internal/virt"
	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/logger"
	"github.com/gofiber/fiber/v3/middleware/recover"
)

const Version = "1.0.0"

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	// 1. 持久层：PostgreSQL 连接池
	ctx := context.Background()
	repository, err := repo.NewFromURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("初始化数据库失败: %v", err)
	}
	defer repository.Close()

	// 2. libvirt 连接管理器（按宿主机 IP 维护连接池）
	conn := virt.NewConnManager()
	defer conn.CloseAll()

	// 3. GPU 管理器
	gpuMgr := gpu.NewManager()

	// 4. service 层
	vmSvc := service.NewVMService(repository, conn)
	migSvc := service.NewMigrationService(repository, conn)
	snapSvc := service.NewSnapshotService(repository, conn)

	// 5. 异步任务队列
	queue := service.NewTaskQueue(repository, 4)
	queue.Start()
	defer queue.Stop()

	// 6. 周期调度器（宿主机/GPU 指标采集等后台巡检）
	sched := service.NewScheduler(slog.Default())
	registerScheduledJobs(sched, repository, conn, gpuMgr)
	sched.Start()
	defer sched.Stop()

	// 7. HTTP 层
	app := fiber.New(fiber.Config{
		AppName:      "CNFv1.0 Server " + Version,
		ServerHeader: "CNF",
	})
	app.Use(recover.New())
	app.Use(logger.New())
	app.Use(cors.New())

	app.Get("/healthz", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok", "version": Version})
	})

	// 骨架路由（认证/层级/存储/监控流，后续迭代补全）
	v1.RegisterRoutes(app, cfg)

	// 核心 API 路由（VM/迁移/快照/GPU/任务）接入真实 service
	h := &v1.Handlers{
		Repo:      repository,
		Conn:      conn,
		VM:        vmSvc,
		Migration: migSvc,
		Snapshot:  snapSvc,
		GPU:       gpuMgr,
		Queue:     queue,
	}
	v1.RegisterAPIRoutes(app, h)

	addr := cfg.ListenAddr
	if addr == "" {
		addr = ":8080"
	}
	log.Printf("CNFv1.0 Server %s 启动于 %s", Version, addr)
	if err := app.Listen(addr); err != nil {
		log.Printf("服务退出: %v", err)
		os.Exit(1)
	}
}

// registerScheduledJobs 注册后台周期任务。
func registerScheduledJobs(s *service.Scheduler, repo service.Repository, conn *virt.ConnManager, gpuMgr *gpu.Manager) {
	// 每 30s 采集各 connected 宿主机的 CPU/内存指标。
	s.Register("collect-host-metrics", 30*time.Second, false, func(ctx context.Context) error {
		hosts, err := repo.ListHosts(ctx, 0)
		if err != nil {
			return err
		}
		for _, host := range hosts {
			if _, err := conn.CollectHostMetrics(host.IPAddress); err != nil {
				slog.Debug("采集宿主机指标失败",
					slog.String("host", host.IPAddress),
					slog.String("error", err.Error()))
			}
		}
		return nil
	})

	// 每 15s 采集 GPU 利用率（nvidia-smi）。
	s.Register("collect-gpu-metrics", 15*time.Second, false, func(ctx context.Context) error {
		_, err := gpuMgr.CollectNVIDIAMetrics(ctx)
		return err
	})
}
