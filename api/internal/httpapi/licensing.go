package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/licensing"
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
)

func decodeN(w http.ResponseWriter, r *http.Request, limit int64, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, limit)).Decode(v); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
		return false
	}
	return true
}

func reply(w http.ResponseWriter, v any, err error) {
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// Licensed merch partners (Figma 114:1933, 116:38 to 116:726).
func (s *Server) licensingRoutes(mux *http.ServeMux) {
	verified := func(a accounts.Account) bool { return a.FaceVerified && a.IDVerified }

	// The application.
	mux.HandleFunc("GET /v1/me/licence-application", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		app, err := s.Licensing.App(r.Context(), a.ID)
		if err == licensing.ErrNotFound {
			writeJSON(w, http.StatusOK, map[string]any{"application": nil, "identityOk": verified(a)})
			return
		}
		reply(w, map[string]any{"application": app, "identityOk": verified(a)}, err)
	}))
	mux.HandleFunc("PUT /v1/me/licence-application", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var d licensing.Draft
		if decodeN(w, r, 8<<10, &d) {
			app, err := s.Licensing.Save(r.Context(), a.ID, d)
			reply(w, app, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/licence-application/doc", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct {
			Key, Note string
			OK        bool
		}
		if decodeN(w, r, 4<<10, &b) {
			app, err := s.Licensing.SetDoc(r.Context(), a.ID, b.Key, b.Note, b.OK)
			reply(w, app, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/licence-application/photos", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Keys []string }
		if decodeN(w, r, 8<<10, &b) {
			app, err := s.Licensing.SetPhotos(r.Context(), a.ID, b.Keys)
			reply(w, app, err)
		}
	}))
	mux.HandleFunc("POST /v1/me/licence-application/submit", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		app, err := s.Licensing.Submit(r.Context(), a.ID, verified(a))
		if err == nil {
			s.licenceMail(a.ID, "licence_received", app.ID, map[string]any{"company": app.Company, "country": app.Country, "app": appRef(app.ID)})
		}
		reply(w, app, err)
	}))
	mux.HandleFunc("POST /v1/me/licence-application/payment", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ OrderID string }
		if decodeN(w, r, 1<<10, &b) {
			err := s.Licensing.AttachPayment(r.Context(), a.ID, b.OrderID)
			reply(w, map[string]bool{"ok": true}, err)
		}
	}))

	// The brand team.
	mux.HandleFunc("GET /v1/licensing/applications", s.internal(func(w http.ResponseWriter, r *http.Request) {
		apps, err := s.Licensing.Queue(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		products, err := s.Licensing.ProductQueue(r.Context())
		reply(w, map[string]any{"applications": apps, "products": products}, err)
	}))
	mux.HandleFunc("POST /v1/licensing/applications/{id}/review", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Approve bool
			Note    string
			FeeNGN  int `json:"feeNgn"`
		}
		if !decodeN(w, r, 4<<10, &b) {
			return
		}
		app, err := s.Licensing.Review(r.Context(), r.PathValue("id"), b.Approve, b.Note, b.FeeNGN)
		if err == nil {
			title, body := "Your licence application was approved", "Pay the licence fee to start selling official E-Cinema merch."
			if !b.Approve {
				title, body = "Your licence application needs changes", app.ReviewNote
			}
			s.note(app.Account, notify.New{Kind: "payment", Title: title, Body: body, Link: "/licensing/apply", Dedupe: "licapp:" + app.ID + ":" + app.Status})
			if !b.Approve {
				s.licenceMail(app.Account, "licence_changes", app.ID+":"+app.Status, map[string]any{"company": app.Company, "note": app.ReviewNote, "app": appRef(app.ID)})
			}
		}
		reply(w, app, err)
	}))
	mux.HandleFunc("POST /v1/licensing/products/{id}/decide", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Status, Note string }
		if decodeN(w, r, 4<<10, &b) {
			p, err := s.Licensing.DecideProduct(r.Context(), r.PathValue("id"), b.Status, b.Note)
			if err == nil && (p.Status == "live" || p.Status == "rejected" || p.Status == "changes") {
				s.productMail(p)
			}
			reply(w, p, err)
		}
	}))
	mux.HandleFunc("POST /v1/licensing/{licence}/settle", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Month string }
		if decodeN(w, r, 1<<10, &b) {
			err := s.Licensing.Settle(r.Context(), r.PathValue("licence"), b.Month)
			reply(w, map[string]bool{"ok": true}, err)
		}
	}))

	// The partner portal. Invitations sent to the member's email are claimed on the way in.
	partner := func(next func(http.ResponseWriter, *http.Request, accounts.Account, licensing.Licensee)) http.HandlerFunc {
		return s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
			_ = s.Licensing.Claim(r.Context(), a.ID, a.Email)
			l, err := s.Licensing.For(r.Context(), a.ID)
			if err != nil {
				fail(w, err)
				return
			}
			next(w, r, a, l)
		})
	}
	mux.HandleFunc("GET /v1/me/partner", partner(func(w http.ResponseWriter, r *http.Request, a accounts.Account, l licensing.Licensee) {
		writeJSON(w, http.StatusOK, map[string]any{"licensee": l, "identityOk": verified(a)})
	}))
	mux.HandleFunc("GET /v1/me/partner/{page}", partner(func(w http.ResponseWriter, r *http.Request, a accounts.Account, l licensing.Licensee) {
		ctx, now := r.Context(), time.Now()
		var v any
		var err error
		switch r.PathValue("page") {
		case "overview":
			v, err = s.Licensing.Overview(ctx, l, now)
		case "analytics":
			q := r.URL.Query()
			days, _ := strconv.Atoi(q.Get("days"))
			v, err = s.Licensing.Analytics(ctx, l, now, licensing.Filter{Days: days, Country: strings.ToUpper(q.Get("country")), Product: q.Get("product")})
		case "codes":
			v, err = s.Licensing.Codes(ctx, l, now)
		case "royalties":
			v, err = s.Licensing.Royalties(ctx, l, now)
		case "compliance":
			v, err = s.Licensing.Compliance(ctx, l)
		case "products":
			var list []licensing.Product
			list, err = s.Licensing.Products(ctx, l.Licence)
			v = map[string]any{"products": list}
		case "members":
			var list []licensing.Member
			list, err = s.Licensing.Members(ctx, l.Licence)
			v = map[string]any{"members": list}
		default:
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		reply(w, v, err)
	}))
	mux.HandleFunc("POST /v1/me/partner/products", partner(func(w http.ResponseWriter, r *http.Request, a accounts.Account, l licensing.Licensee) {
		var n licensing.NewProduct
		if decodeN(w, r, 16<<10, &n) {
			p, err := s.Licensing.AddProduct(r.Context(), l, n)
			reply(w, p, err)
		}
	}))
	mux.HandleFunc("PUT /v1/me/partner/products/{id}", partner(func(w http.ResponseWriter, r *http.Request, a accounts.Account, l licensing.Licensee) {
		var b struct {
			ImageKey  string            `json:"imageKey"`
			SampleKey string            `json:"sampleKey"`
			Checks    []licensing.Check `json:"checks"`
		}
		if decodeN(w, r, 16<<10, &b) {
			p, err := s.Licensing.Resubmit(r.Context(), l, r.PathValue("id"), b.ImageKey, b.SampleKey, b.Checks)
			reply(w, p, err)
		}
	}))
	mux.HandleFunc("POST /v1/me/partner/sales", partner(func(w http.ResponseWriter, r *http.Request, a accounts.Account, l licensing.Licensee) {
		var b struct{ Sales []licensing.Sale }
		if decodeN(w, r, 2<<20, &b) {
			n, err := s.Licensing.AddSales(r.Context(), l, b.Sales)
			reply(w, map[string]int{"added": n}, err)
		}
	}))
	mux.HandleFunc("POST /v1/me/partner/codes", partner(func(w http.ResponseWriter, r *http.Request, a accounts.Account, l licensing.Licensee) {
		var b struct {
			ProductID string `json:"productId"`
			Count     int
		}
		if decodeN(w, r, 1<<10, &b) {
			batch, codes, err := s.Licensing.Issue(r.Context(), l, b.ProductID, b.Count)
			reply(w, map[string]any{"batch": batch, "codes": codes}, err)
		}
	}))
	mux.HandleFunc("GET /v1/me/partner/codes/{batch}", partner(func(w http.ResponseWriter, r *http.Request, a accounts.Account, l licensing.Licensee) {
		codes, product, err := s.Licensing.Batch(r.Context(), l, r.PathValue("batch"))
		reply(w, map[string]any{"codes": codes, "product": product, "licence": l.Licence, "partner": l.Name}, err)
	}))
	mux.HandleFunc("POST /v1/me/partner/members", partner(func(w http.ResponseWriter, r *http.Request, a accounts.Account, l licensing.Licensee) {
		var b struct {
			Email  string
			Remove bool
		}
		if !decodeN(w, r, 1<<10, &b) {
			return
		}
		var err error
		if b.Remove {
			err = s.Licensing.RemoveMember(r.Context(), l, b.Email)
		} else {
			err = s.Licensing.AddMember(r.Context(), l, b.Email)
		}
		reply(w, map[string]bool{"ok": true}, err)
	}))
	mux.HandleFunc("PUT /v1/me/partner/settings", partner(func(w http.ResponseWriter, r *http.Request, a accounts.Account, l licensing.Licensee) {
		var b struct{ City, Website string }
		if decodeN(w, r, 2<<10, &b) {
			reply(w, map[string]bool{"ok": true}, s.Licensing.Settings(r.Context(), l, b.City, b.Website))
		}
	}))
	mux.HandleFunc("POST /v1/me/partner/renew", partner(func(w http.ResponseWriter, r *http.Request, a accounts.Account, l licensing.Licensee) {
		var b struct {
			Plan    string `json:"plan"`
			OrderID string `json:"orderId"`
		}
		if decodeN(w, r, 1<<10, &b) {
			if b.OrderID == "" {
				// A quote only: the web app asks before it creates the PayPal order.
				p, err := licensing.RenewalQuote(l, b.Plan)
				reply(w, p, err)
				return
			}
			reply(w, map[string]bool{"ok": true}, s.Licensing.StartRenewal(r.Context(), l, a.ID, b.Plan, b.OrderID))
		}
	}))
	// A month's royalty (email 41): a quote first, then the PayPal order that pays it.
	mux.HandleFunc("POST /v1/me/partner/royalty", partner(func(w http.ResponseWriter, r *http.Request, a accounts.Account, l licensing.Licensee) {
		var b struct {
			Month   string `json:"month"`
			OrderID string `json:"orderId"`
		}
		if decodeN(w, r, 1<<10, &b) {
			if b.OrderID == "" {
				q, err := s.Licensing.QuoteRoyalty(r.Context(), l, b.Month)
				reply(w, q, err)
				return
			}
			reply(w, map[string]bool{"ok": true}, s.Licensing.StartRoyaltyPayment(r.Context(), l, a.ID, b.Month, b.OrderID))
		}
	}))
	mux.HandleFunc("PUT /v1/me/partner/payout", partner(func(w http.ResponseWriter, r *http.Request, a accounts.Account, l licensing.Licensee) {
		var b struct{ Bank, Number, Name string }
		if decodeN(w, r, 2<<10, &b) {
			reply(w, map[string]bool{"ok": true}, s.Licensing.SetPayout(r.Context(), l, b.Bank, b.Number, b.Name, verified(a)))
		}
	}))
}

// appRef is the application number shown in licensing emails.
func appRef(id string) string {
	return "LIC-" + strings.ToUpper(strings.ReplaceAll(id, "-", "")[:6])
}

// licenceMail queues a licensing email (Figma 118:2939, 127:303, 127:325) to the applicant.
func (s *Server) licenceMail(accountID, kind, key string, data map[string]any) {
	go func() {
		_ = s.Notify.QueueAccount(context.Background(), accountID, notify.Mail{Kind: kind, Dedupe: kind + ":" + key, Data: data})
	}()
}

// productMail queues email 39 or 40 (Figma 127:347, 127:369) to the licence holder.
func (s *Server) productMail(p licensing.Product) {
	go func() {
		ctx := context.Background()
		var email, company string
		if s.Licensing.DB.QueryRow(ctx, `SELECT a.email, b.name FROM brand_licensees b JOIN accounts a ON a.id = b.account_id WHERE b.licence = $1`, p.Licence).Scan(&email, &company) != nil {
			return
		}
		kind := "design_approved"
		if p.Status != "live" {
			kind = "design_rejected"
		}
		_ = s.Notify.Queue(ctx, notify.Mail{Kind: kind, To: email, Name: company, Dedupe: "design:" + p.ID + ":" + p.Status + ":" + p.Note,
			Data: map[string]any{"company": company, "product": p.Name, "note": p.Note, "status": p.Status,
				"design": "DSN-" + p.Licence + "-" + strings.ToUpper(strings.ReplaceAll(p.ID, "-", "")[:4])}})
	}()
}

func (s *Server) note(accountID string, n notify.New) {
	go func() { _ = s.Notify.Add(context.Background(), accountID, n) }()
}
