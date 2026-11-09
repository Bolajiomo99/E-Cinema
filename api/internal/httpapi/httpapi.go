// Package httpapi wires the public HTTP routes.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/Bolajiomo99/E-Cinema/api/internal/exec"
	"github.com/Bolajiomo99/E-Cinema/api/internal/reviews"
	"github.com/Bolajiomo99/E-Cinema/api/internal/rooms"
	"github.com/Bolajiomo99/E-Cinema/api/internal/shop"
	"github.com/Bolajiomo99/E-Cinema/api/internal/studios"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/brand"
	"github.com/Bolajiomo99/E-Cinema/api/internal/careers"
	"github.com/Bolajiomo99/E-Cinema/api/internal/chat"
	"github.com/Bolajiomo99/E-Cinema/api/internal/classics"
	"github.com/Bolajiomo99/E-Cinema/api/internal/community"
	"github.com/Bolajiomo99/E-Cinema/api/internal/gifts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/identity"
	"github.com/Bolajiomo99/E-Cinema/api/internal/insights"
	"github.com/Bolajiomo99/E-Cinema/api/internal/library"
	"github.com/Bolajiomo99/E-Cinema/api/internal/licensing"
	"github.com/Bolajiomo99/E-Cinema/api/internal/moderation"
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
	"github.com/Bolajiomo99/E-Cinema/api/internal/parties"
	"github.com/Bolajiomo99/E-Cinema/api/internal/playback"
	"github.com/Bolajiomo99/E-Cinema/api/internal/support"
	"github.com/Bolajiomo99/E-Cinema/api/internal/sync"
	"github.com/Bolajiomo99/E-Cinema/api/internal/tickets"
	"github.com/Bolajiomo99/E-Cinema/api/internal/translations"
)

type Server struct {
	lat latency // request times for the Infrastructure page

	Tickets  tickets.Store
	Accounts accounts.Store
	// Identity runs face and ID checks; nil until Sumsub keys are set.
	Identity       *identity.Sumsub
	AllowedOrigins []string
	// Rooms, Hub and Passes run watch-room chat; Passes.Key must be secret.
	Rooms  rooms.Store
	Hub    *rooms.Hub
	Passes rooms.Passes
	// Parties are watch parties: named groups for one premiere.
	Parties parties.Store
	// Classics are member requests to bring older films back.
	Classics classics.Store
	// Gifts are seats, plans and credit bought for someone else.
	Gifts   gifts.Store
	Reviews reviews.Store
	// Library is the viewer's shelf: replays, kept films, collections, requested classics.
	Library library.Store
	// Insights adds up watch time, chat and spending for the viewer's own dashboard.
	Insights insights.Store
	Playback playback.Store
	// Notify stores the viewer's notifications.
	Notify notify.Store
	// Chat runs friends and messages; ChatHub pushes them live.
	Chat    chat.Store
	ChatHub *chat.Hub
	// Community runs groups, posts and follows.
	Community community.Store
	// Shop is the E-Cinema store: cart, orders and delivery tracking.
	Shop shop.Store
	// Brand protects the E-Cinema name: licensed merch codes and fake-seller reports.
	Brand brand.Store
	// Licensing runs the licensed merch partners and their portal.
	Licensing licensing.Store
	// Studios runs the studio portal.
	Studios studios.Store
	// Exec serves the executive dashboards.
	Exec exec.Store
	// Careers runs the jobs board, applications and group screening quotes.
	Careers careers.Store
	// Translations is the translation memory for site text, emails and receipts.
	Translations translations.Store
	// Moderation is the automatic check on public chat, posts and comments.
	Moderation moderation.Store
	// Support is the help inbox the support desk answers.
	Support support.Store
	// InternalToken guards routes only the web app may call (attaching orders, marking paid).
	InternalToken string
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.Tickets.DB.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "db down"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	// Real counts for the About page (Figma 94:947): no made-up numbers.
	mux.HandleFunc("GET /v1/about", func(w http.ResponseWriter, r *http.Request) {
		var members, countries int
		if err := s.Accounts.DB.QueryRow(r.Context(), `SELECT count(*)::int, count(DISTINCT country)::int FROM accounts WHERE delete_after IS NULL AND email NOT LIKE 'smoke+%' AND email NOT LIKE '%@example.com'`).Scan(&members, &countries); err != nil {
			fail(w, err)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, map[string]int{"members": members, "countries": countries})
	})
	mux.HandleFunc("GET /v1/showtimes", func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Tickets.List(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, list)
	})
	mux.HandleFunc("GET /v1/showtimes/{id}", func(w http.ResponseWriter, r *http.Request) {
		st, err := s.Tickets.Get(r.Context(), r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, st)
	})
	mux.HandleFunc("POST /v1/showtimes/{id}/holds", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Seats     int    `json:"seats"`
			ViewerRef string `json:"viewerRef"`
			Quality   string `json:"quality"`
			Campaign  string `json:"campaign"`
			Via       string `json:"via"`
			Country   string `json:"country"` // where the buyer is, from the edge
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil || body.ViewerRef == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "seats and viewerRef are required"})
			return
		}
		// A signed-in buyer's session links the seats to their account; guests stay anonymous.
		accountID := ""
		if tok := r.Header.Get("X-Session-Token"); tok != "" {
			acct, _, err := s.Accounts.Authenticate(r.Context(), tok)
			if err != nil {
				fail(w, err)
				return
			}
			accountID = acct.ID
		}
		// A studio can keep its films out of some countries (studio settings, Figma 39:1032).
		if blocked, err := s.Tickets.Blocked(r.Context(), r.PathValue("id"), body.Country, accountID); err != nil {
			fail(w, err)
			return
		} else if blocked {
			writeJSON(w, http.StatusUnavailableForLegalReasons, map[string]string{"error": tickets.ErrRegion.Error()})
			return
		}
		h, err := s.Tickets.Hold(r.Context(), r.PathValue("id"), body.ViewerRef, body.Seats, accountID, body.Quality)
		if err != nil {
			fail(w, err)
			return
		}
		// Seats the AI concierge holds count towards its share (Figma 285:373).
		if body.Via == "concierge" {
			if err := s.Exec.MarkConcierge(r.Context(), h.ID); err != nil {
				slog.Error("concierge tag", "hold", h.ID, "err", err)
			}
		}
		// The campaign link the buyer arrived through, if any (Figma 39:779).
		if err := s.Studios.Attribute(r.Context(), h.ID, body.Campaign); err != nil {
			slog.Error("campaign attribution", "hold", h.ID, "err", err)
		}
		writeJSON(w, http.StatusCreated, h)
	}))
	mux.HandleFunc("POST /v1/holds/{id}/order", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			OrderID  string `json:"orderId"`
			NetCents int    `json:"netCents"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil || body.OrderID == "" || body.NetCents < 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "orderId is required"})
			return
		}
		if err := s.Tickets.AttachOrder(r.Context(), r.PathValue("id"), body.OrderID, body.NetCents); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/payments/captured", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			OrderID   string `json:"orderId"`
			CaptureID string `json:"captureId"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil || body.OrderID == "" || body.CaptureID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "orderId and captureId are required"})
			return
		}
		// A gift order pays for a gift row, and for a seat gift also its hold.
		gift, err := s.Gifts.MarkPaid(r.Context(), body.OrderID, body.CaptureID)
		if err != nil {
			fail(w, err)
			return
		}
		// A licence fee: the licence starts and the new partner hears about it.
		if app, err := s.Licensing.MarkPaid(r.Context(), body.OrderID); err != nil || app != nil {
			if err != nil {
				fail(w, err)
				return
			}
			s.note(app.Account, notify.New{Kind: "payment", Title: "Your E-Cinema licence is active", Body: "Licence " + *app.Licence + ". Open your partner dashboard to add products.", Link: "/partner", Dedupe: "licence:" + app.ID})
			s.licenceMail(app.Account, "licence_approved", app.ID, map[string]any{"company": app.Company, "country": app.Country, "plan": app.Plan, "licence": *app.Licence})
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// A licence renewal or upgrade: one more year on the paid plan.
		if rn, err := s.Licensing.MarkRenewed(r.Context(), body.OrderID); err != nil || rn != nil {
			if err != nil {
				fail(w, err)
				return
			}
			if rn.Account != "" {
				s.note(rn.Account, notify.New{Kind: "payment", Title: "Licence " + rn.Licence + " renewed", Body: "Valid until " + rn.ValidUntil.Format("2 Jan 2006") + ".", Link: "/partner/licence", Dedupe: "renew:" + body.OrderID})
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// A month's royalty: the statement is settled.
		if rp, err := s.Licensing.MarkRoyaltyPaid(r.Context(), body.OrderID); err != nil || rp != nil {
			if err != nil {
				fail(w, err)
				return
			}
			if rp.Account != "" {
				s.note(rp.Account, notify.New{Kind: "payment", Title: rp.Month.Format("January") + " royalty paid", Body: "Invoice " + licensing.InvoiceNo(rp.Licence, rp.Month) + " is settled.", Link: "/partner/royalties", Dedupe: "royalty:" + body.OrderID})
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// A shop order: placed once paid, and the buyer's open pages hear about it.
		if o, err := s.Shop.MarkPaid(r.Context(), body.OrderID, body.CaptureID); err != nil || o != nil {
			if err != nil {
				fail(w, err)
				return
			}
			s.orderChanged(*o)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// A keep order buys a film for the viewer's Library; it has no seat.
		if kept, err := s.Library.MarkKeepPaid(r.Context(), body.OrderID, body.CaptureID); err != nil || kept {
			if err != nil {
				fail(w, err)
				return
			}
			_ = s.Notify.Captured(r.Context(), body.OrderID)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if err := s.Tickets.MarkPaid(r.Context(), body.OrderID, body.CaptureID); err != nil && !(gift && errors.Is(err, tickets.ErrNoHold)) {
			fail(w, err)
			return
		}
		_ = s.Notify.Captured(r.Context(), body.OrderID)
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/payments/refunded", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			CaptureID string `json:"captureId"`
			RefundID  string `json:"refundId"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil || body.CaptureID == "" || body.RefundID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "captureId and refundId are required"})
			return
		}
		if err := s.Tickets.MarkRefunded(r.Context(), body.CaptureID, body.RefundID); err != nil {
			fail(w, err)
			return
		}
		_ = s.Notify.Refunded(r.Context(), body.CaptureID)
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("GET /v1/payouts/due", s.internal(func(w http.ResponseWriter, r *http.Request) {
		ids, err := s.Tickets.DuePayouts(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string][]string{"showtimeIds": ids})
	}))
	mux.HandleFunc("GET /v1/showtimes/{id}/statement", s.internal(func(w http.ResponseWriter, r *http.Request) {
		st, err := s.Tickets.Statement(r.Context(), r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, st)
	}))
	mux.HandleFunc("POST /v1/showtimes/{id}/payout", s.internal(func(w http.ResponseWriter, r *http.Request) {
		st, err := s.Tickets.ClaimPayout(r.Context(), r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, st)
	}))
	mux.HandleFunc("POST /v1/showtimes/{id}/payout/result", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var body tickets.Outcome
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
			return
		}
		if err := s.Tickets.RecordPayout(r.Context(), r.PathValue("id"), body); err != nil {
			fail(w, err)
			return
		}
		if body.Status == "sent" {
			_ = s.Notify.PayoutMail(r.Context(), r.PathValue("id"))
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	s.accountRoutes(mux)
	s.roomRoutes(mux)
	s.roomPanelRoutes(mux)
	s.reviewRoutes(mux)
	s.libraryRoutes(mux)
	s.rewatchRoutes(mux)
	s.downloadRoutes(mux)
	s.insightRoutes(mux)
	s.notifyRoutes(mux)
	s.mailRoutes(mux)
	if s.ChatHub == nil {
		s.ChatHub = chat.NewHub()
	}
	s.chatRoutes(mux)
	s.communityRoutes(mux)
	s.shopRoutes(mux)
	s.brandRoutes(mux)
	s.licensingRoutes(mux)
	s.careersRoutes(mux)
	s.familyRoutes(mux)
	s.studioRoutes(mux)
	s.execRoutes(mux)
	s.partyRoutes(mux)
	s.classicRoutes(mux)
	s.adultRoutes(mux)
	s.lotteryRoutes(mux)
	s.giftRoutes(mux)
	s.studentRoutes(mux)
	mux.Handle("GET /v1/sync/{id}", sync.Handler(schedule{s.Tickets}, s.AllowedOrigins))
	s.errorRoutes(mux)
	s.translationRoutes(mux)
	s.moderationRoutes(mux)
	s.supportRoutes(mux)
	return securityHeaders(s.lat.wrap(recoverPanics(mux)))
}

type schedule struct{ t tickets.Store }

func (s schedule) Timing(ctx context.Context, id string) (sync.Timing, error) {
	var t sync.Timing
	err := s.t.DB.QueryRow(ctx, `SELECT starts_at, duration_min, paused_at, paused_ms FROM showtimes WHERE id = $1`, id).Scan(&t.Start, &t.DurationMin, &t.PausedAt, &t.PausedMs)
	return t, err
}

func (s *Server) internal(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.InternalToken == "" || r.Header.Get("Authorization") != "Bearer "+s.InternalToken {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		next.ServeHTTP(w, r)
	})
}

func fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, tickets.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, tickets.ErrSoldOut), errors.Is(err, tickets.ErrNoHold), errors.Is(err, tickets.ErrEnded), errors.Is(err, tickets.ErrDoorsClosed), errors.Is(err, tickets.ErrTooLateToCancel), errors.Is(err, tickets.ErrGiftedSeat),
		errors.Is(err, tickets.ErrNotEnded), errors.Is(err, tickets.ErrNoPayout):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, tickets.ErrBadSeats), errors.Is(err, tickets.ErrBadOutcome), errors.Is(err, tickets.ErrBadQuality):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrCodeExpired):
		writeJSON(w, http.StatusGone, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrBadInput), errors.Is(err, accounts.ErrBadCode):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": readable(err)})
	case errors.Is(err, accounts.ErrBadLogin), errors.Is(err, accounts.ErrNoSession), errors.Is(err, accounts.ErrBadPasskey), errors.Is(err, accounts.ErrWrongPassword):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrEmailTaken), errors.Is(err, accounts.ErrPhoneTaken), errors.Is(err, accounts.ErrReusedPass), errors.Is(err, accounts.ErrUsernameTaken), errors.Is(err, accounts.ErrLastSignIn):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrLocked), errors.Is(err, accounts.ErrTooSoon), errors.Is(err, accounts.ErrPaused):
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrSMSUnavailable), errors.Is(err, accounts.ErrPasskeysOff):
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
	case errors.Is(err, identity.ErrNoApplicant):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, studios.ErrNotFound), errors.Is(err, studios.ErrNoFilm), errors.Is(err, studios.ErrNoLeak), errors.Is(err, studios.ErrNoCampaign):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, exec.ErrBadInput):
		// Wrapped errors carry their own reason ("bad input: pick the kind of partner").
		msg := "Check the email, role and end date"
		if why, ok := strings.CutPrefix(err.Error(), exec.ErrBadInput.Error()+": "); ok && why != "" {
			msg = strings.ToUpper(why[:1]) + why[1:]
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
	case errors.Is(err, exec.ErrInviteGone):
		writeJSON(w, http.StatusGone, map[string]string{"error": "This invite link has expired or was already used. Ask the CEO to send a new one."})
	case errors.Is(err, exec.ErrWrongPerson):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Sign in with the address the invite was sent to"})
	case errors.Is(err, exec.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "That person has no executive access"})
	case errors.Is(err, exec.ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Executives only"})
	case errors.Is(err, studios.ErrBadKey):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
	case errors.Is(err, studios.ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, studios.ErrBadInput), errors.Is(err, studios.ErrHookURL):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, studios.ErrLocked), errors.Is(err, studios.ErrIncomplete), errors.Is(err, studios.ErrNameTaken), errors.Is(err, studios.ErrLastOwner), errors.Is(err, studios.ErrNotVerified), errors.Is(err, studios.ErrTaken), errors.Is(err, studios.ErrFull), errors.Is(err, studios.ErrTooManyFiles), errors.Is(err, studios.ErrDubBusy), errors.Is(err, studios.ErrNotReady), errors.Is(err, studios.ErrTooManyDubs), errors.Is(err, studios.ErrNotLive), errors.Is(err, studios.ErrStarted), errors.Is(err, studios.ErrTooManyHooks), errors.Is(err, studios.ErrTooManyKeys):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrBadPIN), errors.Is(err, accounts.ErrBadGrant):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrBadParentPIN), errors.Is(err, accounts.ErrBanned):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrFaceLocked):
		writeJSON(w, http.StatusLocked, map[string]any{"error": err.Error(), "locked": true})
	case errors.Is(err, accounts.ErrLockdown):
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrParentPaused):
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrNeedParentPIN), errors.Is(err, accounts.ErrTooManyProfiles):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrBedtime), errors.Is(err, accounts.ErrScreenTime):
		writeJSON(w, http.StatusLocked, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrPINPaused):
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrNotStudent):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrStudentTaken), errors.Is(err, accounts.ErrNoStudentCode):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, gifts.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, gifts.ErrBadInput):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, gifts.ErrNotPaid), errors.Is(err, gifts.ErrRedeemed), errors.Is(err, gifts.ErrOwnGift), errors.Is(err, gifts.ErrHoldGone), errors.Is(err, gifts.ErrSeatInUse):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, gifts.ErrNoCredit):
		writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": err.Error()})
	case errors.Is(err, tickets.ErrNotSoldOut), errors.Is(err, tickets.ErrDrawClosed), errors.Is(err, tickets.ErrHasTicket), errors.Is(err, tickets.ErrNoWin):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, tickets.ErrNotVerified):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, tickets.ErrStagesDue), errors.Is(err, tickets.ErrWrongStage), errors.Is(err, tickets.ErrNotAdultFlm), errors.Is(err, tickets.ErrRecipient):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, rooms.ErrNoTicket), errors.Is(err, tickets.ErrAdult), errors.Is(err, accounts.ErrNotAdult), errors.Is(err, accounts.ErrNoPIN):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, classics.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, classics.ErrBadInput):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, classics.ErrPlan):
		writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": err.Error()})
	case errors.Is(err, parties.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, parties.ErrBadInput):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, parties.ErrNotInvited), errors.Is(err, parties.ErrRoomClosed):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, parties.ErrEnded), errors.Is(err, parties.ErrHostLeaves):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, rooms.ErrEmpty), errors.Is(err, rooms.ErrBadPoll):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": readable(err)})
	case errors.Is(err, rooms.ErrNoParty), errors.Is(err, rooms.ErrNoPoll):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, rooms.ErrTooFast):
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": err.Error()})
	case errors.Is(err, rooms.ErrTalkUsedUp):
		writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": err.Error()})
	case errors.Is(err, reviews.ErrBadInput):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": readable(err)})
	case errors.Is(err, reviews.ErrNotWatched):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, reviews.ErrTooSoon):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, rooms.ErrBadReason):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": readable(err)})
	case errors.Is(err, library.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, library.ErrBadInput), errors.Is(err, library.ErrBadStart):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, library.ErrNoSeat), errors.Is(err, library.ErrNotOwner), errors.Is(err, library.ErrReplayGone):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, library.ErrNotEnded), errors.Is(err, library.ErrOwned), errors.Is(err, library.ErrTooMany), errors.Is(err, library.ErrShareSelf):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, careers.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, careers.ErrBadInput):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": readable(err)})
	case errors.Is(err, careers.ErrClosed), errors.Is(err, careers.ErrApplied):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, careers.ErrNotEligible):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, licensing.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, licensing.ErrBadInput), errors.Is(err, licensing.ErrLimit):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": readable(err)})
	case errors.Is(err, licensing.ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, licensing.ErrState):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, brand.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, brand.ErrBadInput):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": readable(err)})
	case errors.Is(err, brand.ErrDecided):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, brand.ErrTooMany):
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": err.Error()})
	case errors.Is(err, shop.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, shop.ErrBadInput), errors.Is(err, shop.ErrEmptyCart), errors.Is(err, shop.ErrNoAddress):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": readable(err)})
	case errors.Is(err, shop.ErrCantShip), errors.Is(err, shop.ErrNotLagos), errors.Is(err, shop.ErrTooLate), errors.Is(err, shop.ErrPriceMoved), errors.Is(err, shop.ErrAlreadyAsked):
		writeJSON(w, http.StatusConflict, map[string]string{"error": readable(err)})
	case errors.Is(err, shop.ErrNotBuyer):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, community.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, community.ErrNotMember), errors.Is(err, community.ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, community.ErrTaken), errors.Is(err, community.ErrClosed):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, community.ErrTooMany):
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": err.Error()})
	case errors.Is(err, community.ErrBadInput):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, chat.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, chat.ErrNotMember), errors.Is(err, chat.ErrBlocked), errors.Is(err, chat.ErrNotFriends):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": err.Error()})
	case errors.Is(err, chat.ErrAlreadyFriends), errors.Is(err, chat.ErrPending), errors.Is(err, chat.ErrSelf):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, chat.ErrTooMany):
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": err.Error()})
	case errors.Is(err, insights.ErrBadInput), errors.Is(err, notify.ErrBadInput), errors.Is(err, chat.ErrBadInput):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, library.ErrNotOwned):
		writeJSON(w, http.StatusPaymentRequired, map[string]string{"error": err.Error()})
	case errors.Is(err, library.ErrTooManyFiles), errors.Is(err, library.ErrTooManyDevs):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, library.ErrNoLicense):
		writeJSON(w, http.StatusGone, map[string]string{"error": err.Error()})
	case errors.Is(err, library.ErrNoFriend):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, tickets.ErrNoStudio):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
	default:
		slog.Error("request failed", "err", err)
		if errorSink != nil {
			errorSink(err.Error(), "", "")
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// readable drops the "invalid input: " prefix from wrapped input errors, so people read only the advice.
func readable(err error) string {
	m := strings.TrimPrefix(strings.TrimPrefix(err.Error(), accounts.ErrBadInput.Error()+": "), shop.ErrBadInput.Error()+": ")
	m = strings.TrimPrefix(m, brand.ErrBadInput.Error()+": ")
	m = strings.TrimPrefix(strings.TrimPrefix(m, licensing.ErrBadInput.Error()+": "), licensing.ErrLimit.Error()+": ")
	m = strings.TrimPrefix(m, careers.ErrBadInput.Error()+": ")
	if m == "" {
		return m
	}
	return strings.ToUpper(m[:1]) + m[1:]
}
