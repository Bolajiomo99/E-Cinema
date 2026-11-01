package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/chat"
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
	"github.com/Bolajiomo99/E-Cinema/api/internal/shop"
)

// What the buyer reads in their notifications as an order moves along.
var orderNote = map[string][2]string{
	"placed":    {"Order %s placed", "We are packing it now. Follow it live in Orders."},
	"packed":    {"Order %s packed", "It is packed at the Lagos hub and waiting for a rider."},
	"out":       {"Order %s is on the way", "Your rider has set off. Follow them live in Orders."},
	"delivered": {"Order %s delivered", "Enjoy it. You can return anything within 14 days."},
	"cancelled": {"Order %s cancelled", "Nothing more to pay. Anything you paid is on its way back."},
	"returning": {"Return started for %s", "A rider will collect it. We refund once it is back."},
	"returned":  {"Return for %s received", "Your refund is on its way."},
}

// orderChanged tells the buyer's open pages over the live socket and adds a notification.
func (s *Server) orderChanged(o shop.Order) {
	if s.ChatHub != nil {
		if raw, err := json.Marshal(o); err == nil {
			s.ChatHub.Send([]string{o.AccountID}, chat.Event{Type: "order", Order: raw})
		}
	}
	if n, ok := orderNote[o.Status]; ok {
		go func() {
			_ = s.Notify.Add(context.Background(), o.AccountID, notify.New{
				Kind: "payment", Title: fmt.Sprintf(n[0], o.Number), Body: n[1], Link: "/shop/orders?o=" + o.ID, Dedupe: "shop:" + o.ID + ":" + o.Status,
			})
		}()
	}
}

// Shop (Figma 53:925, 96:1194, 53:1111, 89:894).
func (s *Server) shopRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/shop/products", s.internal(func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Shop.Products(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"products": list})
	}))
	mux.HandleFunc("GET /v1/shop/products/{id}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		p, err := s.Shop.Product(r.Context(), r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		reviews, err := s.Shop.Reviews(r.Context(), p.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"product": p, "reviews": reviews})
	}))

	quote := func(w http.ResponseWriter, r *http.Request, a accounts.Account, status int) {
		q, err := s.Shop.Quote(r.Context(), a.ID, r.URL.Query().Get("country"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, status, q)
	}
	mux.HandleFunc("GET /v1/me/cart", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		quote(w, r, a, http.StatusOK)
	}))
	mux.HandleFunc("PUT /v1/me/cart", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			ProductID string `json:"productId"`
			Variant   string `json:"variant"`
			Qty       int    `json:"qty"`
			Add       bool   `json:"add"`
		}
		if !decode(w, r, &b) {
			return
		}
		if err := s.Shop.SetQty(r.Context(), a.ID, b.ProductID, b.Variant, b.Qty, b.Add); err != nil {
			fail(w, err)
			return
		}
		quote(w, r, a, http.StatusOK)
	}))
	mux.HandleFunc("PUT /v1/me/shop-address", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b shop.Address
		if !decode(w, r, &b) {
			return
		}
		if _, err := s.Shop.SaveAddress(r.Context(), a.ID, b); err != nil {
			fail(w, err)
			return
		}
		quote(w, r, a, http.StatusOK)
	}))
	mux.HandleFunc("POST /v1/me/orders", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b shop.Placing
		if !decode(w, r, &b) {
			return
		}
		o, err := s.Shop.Place(r.Context(), a.ID, b)
		if err != nil {
			fail(w, err)
			return
		}
		if o.Status == "placed" {
			s.orderChanged(o)
		}
		writeJSON(w, http.StatusCreated, o)
	}))
	mux.HandleFunc("GET /v1/me/orders", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		list, err := s.Shop.Orders(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		reviewable, err := s.Shop.Reviewable(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"orders": list, "reviewable": reviewable})
	}))
	mux.HandleFunc("POST /v1/me/orders/{id}/cancel", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		o, err := s.Shop.Cancel(r.Context(), a.ID, r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		s.orderChanged(o)
		// The web app refunds a PayPal capture; it gets the capture id only here.
		writeJSON(w, http.StatusOK, map[string]any{"order": o, "captureId": o.CaptureID, "method": o.Method})
	}))
	mux.HandleFunc("POST /v1/me/orders/{id}/return", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Reason string }
		if !decode(w, r, &b) {
			return
		}
		o, err := s.Shop.Return(r.Context(), a.ID, r.PathValue("id"), b.Reason)
		if err != nil {
			fail(w, err)
			return
		}
		s.orderChanged(o)
		writeJSON(w, http.StatusOK, o)
	}))
	mux.HandleFunc("POST /v1/me/orders/{id}/reorder", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if _, err := s.Shop.Reorder(r.Context(), a.ID, r.PathValue("id")); err != nil {
			fail(w, err)
			return
		}
		quote(w, r, a, http.StatusOK)
	}))
	mux.HandleFunc("PUT /v1/me/shop-reviews/{product}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			Stars int    `json:"stars"`
			Body  string `json:"body"`
		}
		if !decode(w, r, &b) {
			return
		}
		if err := s.Shop.Review(r.Context(), a.ID, r.PathValue("product"), b.Stars, b.Body); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	// The delivery team (web staff page) lists open orders and moves them along.
	mux.HandleFunc("GET /v1/shop/orders/open", s.internal(func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Shop.Open(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"orders": list})
	}))
	mux.HandleFunc("POST /v1/shop/orders/{number}/status", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Status string      `json:"status"`
			Rider  *shop.Rider `json:"rider"`
		}
		if !decode(w, r, &b) {
			return
		}
		o, err := s.Shop.Advance(r.Context(), r.PathValue("number"), b.Status, b.Rider)
		if err != nil {
			fail(w, err)
			return
		}
		s.orderChanged(o)
		writeJSON(w, http.StatusOK, map[string]any{"order": o, "captureId": o.CaptureID})
	}))
}
