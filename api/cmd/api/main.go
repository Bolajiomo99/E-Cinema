// Command api is the E-Cinema Go API: showtimes, seat holds and premiere sync.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/httpapi"
	"github.com/Bolajiomo99/E-Cinema/api/internal/identity"
	"github.com/Bolajiomo99/E-Cinema/api/internal/sms"
	"github.com/Bolajiomo99/E-Cinema/api/internal/tickets"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("api stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}

	// Phone checks switch on once Termii has approved a sender ID.
	var texts accounts.SMS
	if key, from := os.Getenv("TERMII_API_KEY"), os.Getenv("TERMII_SENDER_ID"); key != "" && from != "" {
		texts = sms.Termii{
			BaseURL:  env("TERMII_BASE_URL", "https://v3.api.termii.com"),
			APIKey:   key,
			SenderID: from,
			Channel:  env("TERMII_CHANNEL", "dnd"),
		}
	}

	var idCheck *identity.Sumsub
	if t, k := os.Getenv("SUMSUB_APP_TOKEN"), os.Getenv("SUMSUB_SECRET_KEY"); t != "" && k != "" {
		idCheck = &identity.Sumsub{
			BaseURL:   env("SUMSUB_BASE_URL", "https://api.sumsub.com"),
			AppToken:  t,
			SecretKey: k,
			Level:     env("SUMSUB_LEVEL", "id-and-liveness"),
		}
	}

	srv := &httpapi.Server{
		Identity:       idCheck,
		Tickets:        tickets.Store{DB: pool},
		Accounts:       accounts.Store{DB: pool, SMS: texts},
		AllowedOrigins: strings.Split(env("ALLOWED_ORIGINS", "e-cinema.net,*.e-cinema.net,localhost:3000"), ","),
		InternalToken:  os.Getenv("INTERNAL_API_TOKEN"),
	}
	httpSrv := &http.Server{
		Addr:              ":" + env("PORT", "8080"),
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		httpSrv.Shutdown(shutdown)
	}()
	slog.Info("api listening", "addr", httpSrv.Addr)
	if err := httpSrv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
