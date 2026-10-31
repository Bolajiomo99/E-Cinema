// Package httpapi wires the public HTTP routes.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/sync"
	"github.com/Bolajiomo99/E-Cinema/api/internal/tickets"
)

type Server struct {
	Tickets        tickets.Store
	AllowedOrigins []string
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
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil || body.ViewerRef == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "seats and viewerRef are required"})
			return
		}
		h, err := s.Tickets.Hold(r.Context(), r.PathValue("id"), body.ViewerRef, body.Seats)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, h)
	}))
	mux.HandleFunc("POST /v1/holds/{id}/order", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			OrderID string `json:"orderId"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil || body.OrderID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "orderId is required"})
			return
		}
		if err := s.Tickets.AttachOrder(r.Context(), r.PathValue("id"), body.OrderID); err != nil {
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
		if err := s.Tickets.MarkPaid(r.Context(), body.OrderID, body.CaptureID); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
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
	case errors.Is(err, tickets.ErrSoldOut), errors.Is(err, tickets.ErrNoHold):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, tickets.ErrBadSeats):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
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
