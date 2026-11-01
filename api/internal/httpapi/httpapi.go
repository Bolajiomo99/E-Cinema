// Package httpapi wires the public HTTP routes.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/Bolajiomo99/E-Cinema/api/internal/reviews"
	"github.com/Bolajiomo99/E-Cinema/api/internal/rooms"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/classics"
	"github.com/Bolajiomo99/E-Cinema/api/internal/gifts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/identity"
	"github.com/Bolajiomo99/E-Cinema/api/internal/insights"
	"github.com/Bolajiomo99/E-Cinema/api/internal/library"
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
	"github.com/Bolajiomo99/E-Cinema/api/internal/parties"
	"github.com/Bolajiomo99/E-Cinema/api/internal/sync"
	"github.com/Bolajiomo99/E-Cinema/api/internal/tickets"
)

type Server struct {
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
	// Notify stores the viewer's notifications.
	Notify notify.Store
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
		h, err := s.Tickets.Hold(r.Context(), r.PathValue("id"), body.ViewerRef, body.Seats, accountID, body.Quality)
		if err != nil {
			fail(w, err)
			return
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
		var body struct {
			Status  string `json:"status"`
			BatchID string `json:"batchId"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
			return
		}
		if err := s.Tickets.RecordPayout(r.Context(), r.PathValue("id"), body.Status, body.BatchID); err != nil {
			fail(w, err)
			return
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
	s.partyRoutes(mux)
	s.classicRoutes(mux)
	s.adultRoutes(mux)
	s.lotteryRoutes(mux)
	s.giftRoutes(mux)
	s.studentRoutes(mux)
	mux.Handle("GET /v1/sync/{id}", sync.Handler(schedule{s.Tickets}, s.AllowedOrigins))
	return securityHeaders(mux)
}

type schedule struct{ t tickets.Store }

func (s schedule) Start(ctx context.Context, id string) (time.Time, int, error) {
	st, err := s.t.Get(ctx, id)
	return st.StartsAt, st.DurationMin, err
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
	case errors.Is(err, tickets.ErrSoldOut), errors.Is(err, tickets.ErrNoHold), errors.Is(err, tickets.ErrEnded), errors.Is(err, tickets.ErrTooLateToCancel), errors.Is(err, tickets.ErrGiftedSeat),
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
	case errors.Is(err, accounts.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, accounts.ErrBadPIN), errors.Is(err, accounts.ErrBadGrant):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
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
	case errors.Is(err, tickets.ErrStagesDue), errors.Is(err, tickets.ErrWrongStage), errors.Is(err, tickets.ErrNotAdultFlm):
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
	case errors.Is(err, parties.ErrNotInvited):
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
	case errors.Is(err, insights.ErrBadInput), errors.Is(err, notify.ErrBadInput):
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
	m := strings.TrimPrefix(err.Error(), accounts.ErrBadInput.Error()+": ")
	if m == "" {
		return m
	}
	return strings.ToUpper(m[:1]) + m[1:]
}
