// Command api is the E-Cinema Go API: showtimes, seat holds and premiere sync.
package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"github.com/Bolajiomo99/E-Cinema/api/internal/brand"
	"github.com/Bolajiomo99/E-Cinema/api/internal/careers"
	"github.com/Bolajiomo99/E-Cinema/api/internal/chat"
	"github.com/Bolajiomo99/E-Cinema/api/internal/classics"
	"github.com/Bolajiomo99/E-Cinema/api/internal/community"
	"github.com/Bolajiomo99/E-Cinema/api/internal/exec"
	"github.com/Bolajiomo99/E-Cinema/api/internal/gifts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/insights"
	"github.com/Bolajiomo99/E-Cinema/api/internal/library"
	"github.com/Bolajiomo99/E-Cinema/api/internal/licensing"
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
	"github.com/Bolajiomo99/E-Cinema/api/internal/parties"
	"github.com/Bolajiomo99/E-Cinema/api/internal/playback"
	"github.com/Bolajiomo99/E-Cinema/api/internal/reviews"
	"github.com/Bolajiomo99/E-Cinema/api/internal/rooms"
	"github.com/Bolajiomo99/E-Cinema/api/internal/shop"
	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
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
	"github.com/Bolajiomo99/E-Cinema/api/internal/translations"
	"github.com/go-webauthn/webauthn/webauthn"
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

	// Passkeys are bound to the web app's domain (e.g. e-cinema.net) and the origins it serves from.
	var passkeys *webauthn.WebAuthn
	if rp := os.Getenv("WEBAUTHN_RP_ID"); rp != "" {
		passkeys, err = webauthn.New(&webauthn.Config{
			RPID:          rp,
			RPDisplayName: "E-Cinema",
			RPOrigins:     strings.Split(env("WEBAUTHN_ORIGINS", "https://"+rp), ","),
		})
		if err != nil {
			return err
		}
	}

	srv := &httpapi.Server{
		Identity:       idCheck,
		Tickets:        tickets.Store{DB: pool},
		Accounts:       accounts.Store{DB: pool, SMS: texts, WebAuthn: passkeys, Trusted: ceoEmails()},
		AllowedOrigins: strings.Split(env("ALLOWED_ORIGINS", "e-cinema.net,*.e-cinema.net,localhost:3000"), ","),
		InternalToken:  os.Getenv("INTERNAL_API_TOKEN"),
		Rooms:          rooms.Store{DB: pool},
		Hub:            rooms.NewHub(),
		Parties:        parties.Store{DB: pool},
		Classics:       classics.Store{DB: pool},
		Gifts:          gifts.Store{DB: pool},
		Reviews:        reviews.Store{DB: pool},
		Library:        library.Store{DB: pool},
		Insights:       insights.Store{DB: pool},
		Playback:       playback.Store{DB: pool},
		Notify:         notify.Store{DB: pool},
		Chat:           chat.Store{DB: pool},
		Community:      community.Store{DB: pool},
		Shop:           shop.Store{DB: pool},
		Brand:          brand.Store{DB: pool},
		Licensing:      licensing.Store{DB: pool},
		Studios:        studios.Store{DB: pool},
		Exec:           exec.Store{DB: pool, CEOs: ceoEmails()},
		Careers:        careers.Store{DB: pool},
		Translations:   translations.Store{DB: pool},
		ChatHub:        chat.NewHub(),
		Passes:         rooms.Passes{Key: roomKey(os.Getenv("INTERNAL_API_TOKEN"))},
	}
	// Accounts whose 30-day deletion grace has ended are removed hourly.
	go func() {
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for {
			if n, err := srv.Gifts.EndGiftPlans(ctx); err != nil {
				slog.Error("end gift plans", "err", err)
			} else if n > 0 {
				slog.Info("gifted plans ended", "count", n)
			}
			if n, err := srv.Tickets.EnsureEncores(ctx, time.Now()); err != nil {
				slog.Error("weekly encores", "err", err)
			} else if n > 0 {
				slog.Info("weekly encores added", "count", n)
			}
			if n, err := srv.Accounts.PurgeDeleted(ctx); err != nil {
				slog.Error("purge deleted accounts", "err", err)
			} else if n > 0 {
				slog.Info("purged deleted accounts", "count", n)
			}
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
		}
	}()
	// Emails whose time has come (reminders, renewals, the weekly round-up) are queued each minute.
	go func() {
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		for {
			if n, err := srv.Notify.ScheduleMail(ctx, time.Now()); err != nil {
				slog.Error("schedule mail", "err", err)
			} else if n > 0 {
				slog.Info("mail queued", "count", n)
			}
			if n, err := srv.Studios.QueueFilmChanges(ctx, time.Now()); err != nil {
				slog.Error("film changes mail", "err", err)
			} else if n > 0 {
				slog.Info("film changes mail queued", "count", n)
			}
			if n, err := srv.Studios.QueueAlerts(ctx, time.Now()); err != nil {
				slog.Error("studio alerts", "err", err)
			} else if n > 0 {
				slog.Info("studio alerts queued", "count", n)
			}
			if n, err := srv.Studios.NotifyFollowers(ctx, time.Now()); err != nil {
				slog.Error("studio follower notices", "err", err)
			} else if n > 0 {
				slog.Info("studio follower notices", "count", n)
			}
			if n, err := srv.Studios.ProposeEncores(ctx, time.Now()); err != nil {
				slog.Error("sell-out encores", "err", err)
			} else if n > 0 {
				slog.Info("sell-out encores proposed", "count", n)
			}
			if n, err := srv.Studios.QueueHookEvents(ctx, time.Now()); err != nil {
				slog.Error("studio webhooks", "err", err)
			} else if n > 0 {
				slog.Info("studio webhooks queued", "count", n)
			}
			if n, err := srv.Licensing.QueueStatements(ctx, time.Now()); err != nil {
				slog.Error("royalty statements", "err", err)
			} else if n > 0 {
				slog.Info("royalty statements queued", "count", n)
			}
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
		}
	}()
	// Studio webhooks go out on their own loop, so a slow endpoint never holds up the emails.
	go func() {
		client := studios.HookClient()
		t := time.NewTicker(20 * time.Second)
		defer t.Stop()
		for {
			if sent, failed, err := srv.Studios.DeliverHooks(ctx, client, time.Now()); err != nil {
				slog.Error("deliver webhooks", "err", err)
			} else if sent+failed > 0 {
				slog.Info("webhooks delivered", "sent", sent, "failed", failed)
			}
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
		}
	}()
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

// roomKey derives the room-pass signing key from the internal token, so no extra secret is
// needed and the key changes whenever the token is rotated.
func roomKey(internal string) []byte {
	if internal == "" {
		return nil
	}
	m := hmac.New(sha256.New, []byte(internal))
	m.Write([]byte("e-cinema room passes v1"))
	return m.Sum(nil)
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// ceoEmails is who has full executive access: CEO_EMAILS, comma-separated, or the company mailbox.
func ceoEmails() []string {
	v := os.Getenv("CEO_EMAILS")
	if strings.TrimSpace(v) == "" {
		v = "admin@e-cinema.net"
	}
	out := []string{}
	for _, e := range strings.Split(v, ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			out = append(out, e)
		}
	}
	return out
}
