package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

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
	if o.AccountID == "" {
		return // the buyer deleted their account
	}
	if s.ChatHub != nil {
		if raw, err := json.Marshal(o); err == nil {
			s.ChatHub.Send([]string{o.AccountID}, chat.Event{Type: "order", Order: raw})
		}
	}
	s.orderMail(o)
	if n, ok := orderNote[o.Status]; ok {
		go func() {
			_ = s.Notify.Add(context.Background(), o.AccountID, notify.New{
				Kind: "payment", Title: fmt.Sprintf(n[0], o.Number), Body: n[1], Link: "/shop/orders?o=" + o.ID, Dedupe: "shop:" + o.ID + ":" + o.Status,
			})
		}()
	}
}

// orderMail queues emails 14 and 15 (Figma 106:416, 106:438) when an order sets off and
// arrives, and the refund email when a paid order is cancelled or a return comes back.
func (s *Server) orderMail(o shop.Order) {
	items := make([]string, 0, len(o.Items))
	for _, it := range o.Items {
		name := it.Name
		if it.Variant != "" {
			name += ", " + it.Variant
		}
		if it.Qty > 1 {
			name = fmt.Sprintf("%d × %s", it.Qty, name)
		}
		items = append(items, name)
	}
	data := map[string]any{"order": o.Number, "orderId": o.ID, "items": items, "city": o.Address.City}
	kind := ""
	switch o.Status {
	case "out":
		kind = "order_shipped"
		if o.Rider != nil {
			data["rider"], data["vehicle"], data["eta"] = o.Rider.Name, o.Rider.Vehicle, o.Rider.ETA
		}
	case "delivered":
		kind = "order_delivered"
		if o.DeliveredAt != nil {
			data["at"] = o.DeliveredAt.Format(time.RFC3339)
		}
	case "cancelled", "returned":
		if o.Method != "paypal" || o.ChargeCents == 0 {
			return
		}
		kind = "refund"
		data = map[string]any{"what": "Shop order " + o.Number, "netMinor": o.ChargeCents, "currency": o.ChargeCurrency, "gross": true,
			"ref": o.Number, "link": "/shop/orders?o=" + o.ID}
	default:
		return
	}
	go func() {
		_ = s.Notify.QueueAccount(context.Background(), o.AccountID, notify.Mail{Kind: kind, Dedupe: "shop:" + o.ID + ":" + o.Status, Data: data})
	}()
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
			if o.Status == "delivered" {
				if err := s.Licensing.RecordShopSales(r.Context(), o.ID); err != nil {
					slog.Error("partner shop sales", "err", err)
				}
			}
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
	// Refund requests (Figma 96:1426): what each reason would get, then the request itself.
	mux.HandleFunc("GET /v1/me/orders/{id}/refund", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		o, err := s.Shop.Mine(r.Context(), a.ID, r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		rf, err := s.Shop.RefundFor(r.Context(), a.ID, o.ID)
		if err != nil {
			fail(w, err)
			return
		}
		verdicts := map[string]any{}
		for _, k := range []string{"late", "wrong", "damaged", "never"} {
			if v, err := shop.Judge(o, k, time.Now()); err == nil {
				verdicts[k] = v
			} else {
				verdicts[k] = map[string]any{"blocked": strings.TrimPrefix(err.Error(), shop.ErrBadInput.Error()+": ")}
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"order": o, "refund": rf, "verdicts": verdicts, "late": shop.Late(o)})
	}))
	mux.HandleFunc("POST /v1/me/orders/{id}/refund", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			Reason      string `json:"reason"`
			Note        string `json:"note"`
			Outcome     string `json:"outcome"`
			CreditCents int    `json:"creditCents"`
		}
		if !decode(w, r, &b) {
			return
		}
		rf, o, err := s.Shop.AskRefund(r.Context(), a.ID, r.PathValue("id"), b.Reason, b.Note, b.Outcome, b.CreditCents, time.Now())
		if err != nil {
			fail(w, err)
			return
		}
		// The web app refunds an approved PayPal capture; it gets the capture id only here.
		writeJSON(w, http.StatusCreated, map[string]any{"refund": rf, "order": o, "captureId": o.CaptureID, "method": o.Method})
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
	mux.HandleFunc("GET /v1/shop/refunds", s.internal(func(w http.ResponseWriter, r *http.Request) {
		review, err := s.Shop.PendingRefunds(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		send, err := s.Shop.ToSend(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"review": review, "send": send})
	}))
	mux.HandleFunc("POST /v1/shop/refunds/{id}", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Action string `json:"action"` // approve, decline or sent
		}
		if !decode(w, r, &b) {
			return
		}
		if b.Action == "sent" {
			if err := s.Shop.MarkSent(r.Context(), r.PathValue("id")); err != nil {
				fail(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if b.Action != "approve" && b.Action != "decline" {
			fail(w, shop.ErrBadInput)
			return
		}
		rf, o, err := s.Shop.DecideRefund(r.Context(), r.PathValue("id"), b.Action == "approve")
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"refund": rf, "order": o, "captureId": o.CaptureID, "method": o.Method})
	}))
	mux.HandleFunc("POST /v1/shop/refunds/{id}/paid", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			RefundID string `json:"refundId"`
		}
		if !decode(w, r, &b) {
			return
		}
		if b.RefundID == "" {
			fail(w, shop.ErrBadInput)
			return
		}
		if err := s.Shop.MarkRefundPaid(r.Context(), r.PathValue("id"), b.RefundID); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
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

	// Pay in 6: the web worker saves the card after the first part, then charges the rest.
	mux.HandleFunc("POST /v1/shop/instalments/start", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Reference string `json:"reference"`
			AuthCode  string `json:"authCode"`
			Email     string `json:"email"`
		}
		if !decode(w, r, &b) {
			return
		}
		if err := s.Shop.StartPlan(r.Context(), b.Reference, b.AuthCode, b.Email); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/shop/instalments/due", s.internal(func(w http.ResponseWriter, r *http.Request) {
		due, err := s.Shop.DueParts(r.Context(), 50)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"due": due})
	}))
	mux.HandleFunc("POST /v1/shop/instalments/{order}/result", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Part      int    `json:"part"`
			OK        bool   `json:"ok"`
			Reference string `json:"reference"`
			Error     string `json:"error"`
		}
		if !decode(w, r, &b) {
			return
		}
		o, err := s.Shop.PartResult(r.Context(), r.PathValue("order"), b.Part, b.OK, b.Reference, b.Error)
		if err != nil {
			fail(w, err)
			return
		}
		if o.AccountID != "" && o.Plan != nil {
			title, body := "", ""
			switch {
			case b.OK && o.Plan.Status == "done":
				title, body = fmt.Sprintf("%s is fully paid", o.Number), "All six parts are paid. Thank you."
			case b.OK:
				title, body = fmt.Sprintf("Part %d of %d paid for %s", o.Plan.Paid, o.Plan.Parts, o.Number), fmt.Sprintf("₦%d was charged to your saved card.", PartPaid(o.Plan))
			case o.Plan.Status == "failed":
				title, body = fmt.Sprintf("We could not take part %d for %s", b.Part, o.Number), "Three tries failed. Contact help@e-cinema.net to pay the rest another way."
			default:
				title, body = fmt.Sprintf("Part %d for %s did not go through", b.Part, o.Number), "We will try your card again tomorrow."
			}
			go func() {
				_ = s.Notify.Add(context.Background(), o.AccountID, notify.New{Kind: "payment", Title: title, Body: body, Link: "/shop/orders?o=" + o.ID, Dedupe: fmt.Sprintf("plan:%s:%d:%t:%s", o.ID, b.Part, b.OK, b.Reference)})
			}()
			if s.ChatHub != nil {
				if raw, err := json.Marshal(o); err == nil {
					s.ChatHub.Send([]string{o.AccountID}, chat.Event{Type: "order", Order: raw})
				}
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"plan": o.Plan})
	}))
}

// PartPaid is the amount of the part just paid.
func PartPaid(p *shop.Plan) int {
	if p.Paid == p.Parts {
		return p.PaidNGN - p.PartNGN*(p.Parts-1)
	}
	return p.PartNGN
}
