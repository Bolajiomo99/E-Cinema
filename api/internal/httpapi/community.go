package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
	"github.com/Bolajiomo99/E-Cinema/api/internal/community"
	"github.com/Bolajiomo99/E-Cinema/api/internal/notify"
)

// Community (Figma 32:951 feed, 96:1566 group page).
func (s *Server) communityRoutes(mux *http.ServeMux) {
	postID := func(w http.ResponseWriter, r *http.Request) (int64, bool) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil || id < 1 {
			fail(w, community.ErrNotFound)
			return 0, false
		}
		return id, true
	}
	note := func(to string, n notify.New) {
		go func() { _ = s.Notify.Add(context.Background(), to, n) }()
	}

	mux.HandleFunc("GET /v1/me/communities", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		list, err := s.Community.List(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"communities": list})
	}))
	mux.HandleFunc("POST /v1/me/communities", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ Name, About, Visibility string }
		if !decode(w, r, &b) {
			return
		}
		c, err := s.Community.Create(r.Context(), a.ID, b.Name, b.About, b.Visibility)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, c)
	}))
	mux.HandleFunc("GET /v1/me/communities/{slug}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		c, parties, err := s.Community.Get(r.Context(), a.ID, r.PathValue("slug"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"community": c, "parties": parties})
	}))
	mux.HandleFunc("GET /v1/me/communities/{slug}/members", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		list, err := s.Community.Members(r.Context(), a.ID, r.PathValue("slug"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"members": list})
	}))
	mux.HandleFunc("PUT /v1/me/communities/{slug}/parties/{code}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ On bool }
		if !decode(w, r, &b) {
			return
		}
		if err := s.Community.ListParty(r.Context(), a.ID, r.PathValue("slug"), r.PathValue("code"), b.On); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/me/communities/{slug}/members", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Community.Join(r.Context(), a.ID, r.PathValue("slug")); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("DELETE /v1/me/communities/{slug}/members/me", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if err := s.Community.Leave(r.Context(), a.ID, r.PathValue("slug")); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	mux.HandleFunc("GET /v1/me/posts", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		q := r.URL.Query()
		f := community.Feed{Community: q.Get("community"), Following: q.Get("following") == "1", Author: q.Get("author"), Tag: q.Get("tag")}
		if v := q.Get("before"); v != "" {
			n, err := strconv.ParseInt(v, 10, 64)
			if err != nil || n < 1 {
				fail(w, community.ErrBadInput)
				return
			}
			f.Before = n
		}
		posts, err := s.Community.Posts(r.Context(), a.ID, f)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"posts": posts, "more": len(posts) == community.PageSize})
	}))
	mux.HandleFunc("POST /v1/me/posts", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b community.NewPost
		if !decode(w, r, &b) {
			return
		}
		id, err := s.Community.Post(r.Context(), a.ID, b)
		if err != nil {
			fail(w, err)
			return
		}
		posts, err := s.Community.Posts(r.Context(), a.ID, community.Feed{PostID: id})
		if err != nil || len(posts) == 0 {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, posts[0])
	}))
	mux.HandleFunc("GET /v1/me/posts/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, ok := postID(w, r)
		if !ok {
			return
		}
		posts, err := s.Community.Posts(r.Context(), a.ID, community.Feed{PostID: id})
		if err == nil && len(posts) == 0 {
			err = community.ErrNotFound
		}
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, posts[0])
	}))
	mux.HandleFunc("DELETE /v1/me/posts/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, ok := postID(w, r)
		if !ok {
			return
		}
		if err := s.Community.Delete(r.Context(), a.ID, id); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("PUT /v1/me/posts/{id}/like", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, ok := postID(w, r)
		if !ok {
			return
		}
		var b struct{ On bool }
		if !decode(w, r, &b) {
			return
		}
		n, author, changed, err := s.Community.Like(r.Context(), a.ID, id, b.On)
		if err != nil {
			fail(w, err)
			return
		}
		if b.On && changed && author != a.ID {
			note(author, notify.New{Kind: "like", Title: a.Name + " liked your post", Link: "/community/post/" + strconv.FormatInt(id, 10), Dedupe: "like:" + strconv.FormatInt(id, 10) + ":" + a.ID})
		}
		writeJSON(w, http.StatusOK, map[string]any{"likes": n, "liked": b.On})
	}))
	mux.HandleFunc("PUT /v1/me/posts/{id}/pin", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, ok := postID(w, r)
		if !ok {
			return
		}
		var b struct{ On bool }
		if !decode(w, r, &b) {
			return
		}
		if err := s.Community.Pin(r.Context(), a.ID, id, b.On); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/me/posts/{id}/vote", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, ok := postID(w, r)
		if !ok {
			return
		}
		var b struct{ Option int }
		if !decode(w, r, &b) {
			return
		}
		opts, err := s.Community.Vote(r.Context(), a.ID, id, b.Option)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"options": opts, "myVote": b.Option})
	}))
	mux.HandleFunc("GET /v1/me/posts/{id}/comments", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, ok := postID(w, r)
		if !ok {
			return
		}
		list, err := s.Community.Comments(r.Context(), a.ID, id)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"comments": list})
	}))
	mux.HandleFunc("POST /v1/me/posts/{id}/comments", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, ok := postID(w, r)
		if !ok {
			return
		}
		var b struct{ Body string }
		if !decode(w, r, &b) {
			return
		}
		c, author, err := s.Community.AddComment(r.Context(), a.ID, id, b.Body)
		if err != nil {
			fail(w, err)
			return
		}
		if author != a.ID {
			note(author, notify.New{Kind: "comment", Title: a.Name + " commented on your post", Body: c.Body, Link: "/community/post/" + strconv.FormatInt(id, 10)})
		}
		writeJSON(w, http.StatusCreated, c)
	}))
	mux.HandleFunc("POST /v1/me/posts/{id}/report", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, ok := postID(w, r)
		if !ok {
			return
		}
		var b struct{ Reason string }
		if !decode(w, r, &b) {
			return
		}
		if err := s.Community.Report(r.Context(), a.ID, id, b.Reason); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("POST /v1/me/posts/{id}/share", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, ok := postID(w, r)
		if !ok {
			return
		}
		n, err := s.Community.Shared(r.Context(), a.ID, id)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"shares": n})
	}))
	mux.HandleFunc("GET /v1/me/posts/{id}/translation", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, ok := postID(w, r)
		if !ok {
			return
		}
		body, lang, err := s.Community.Source(r.Context(), a.ID, id)
		if err != nil {
			fail(w, err)
			return
		}
		out := map[string]any{"body": body, "lang": lang}
		if t, src, err := s.Community.Translation(r.Context(), id, r.URL.Query().Get("to")); err == nil {
			out["translation"], out["source"] = t, src
		}
		writeJSON(w, http.StatusOK, out)
	}))
	mux.HandleFunc("PUT /v1/me/posts/{id}/translation", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		id, ok := postID(w, r)
		if !ok {
			return
		}
		var b struct{ Lang, Body, Source string }
		if !decode(w, r, &b) {
			return
		}
		if _, _, err := s.Community.Source(r.Context(), a.ID, id); err != nil {
			fail(w, err)
			return
		}
		if err := s.Community.SaveTranslation(r.Context(), id, b.Lang, b.Body, b.Source); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	mux.HandleFunc("GET /v1/me/people/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		p, err := s.Community.Profile(r.Context(), a.ID, r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, p)
	}))
	// The profile page (Figma 32:1060) and its tabs. {id} is an account id or a username.
	person := func(w http.ResponseWriter, r *http.Request, a accounts.Account) (community.Page, bool) {
		p, err := s.Community.ProfilePage(r.Context(), a.ID, r.PathValue("id"))
		if err != nil {
			fail(w, err)
			return p, false
		}
		return p, true
	}
	mux.HandleFunc("GET /v1/me/people/{id}/page", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		if p, ok := person(w, r, a); ok {
			writeJSON(w, http.StatusOK, p)
		}
	}))
	mux.HandleFunc("GET /v1/me/people/{id}/watched", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		p, ok := person(w, r, a)
		if !ok {
			return
		}
		list, err := s.Community.WatchedList(r.Context(), p.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"watched": list})
	}))
	mux.HandleFunc("GET /v1/me/people/{id}/reviews", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		p, ok := person(w, r, a)
		if !ok {
			return
		}
		list, err := s.Community.ReviewsOf(r.Context(), a.ID, p.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"reviews": list, "hidden": !p.Me && !p.ShowsReviews})
	}))
	mux.HandleFunc("PUT /v1/me/people/{id}/reviews/{showtime}/like", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ On bool }
		if !decode(w, r, &b) {
			return
		}
		p, ok := person(w, r, a)
		if !ok {
			return
		}
		changed, n, err := s.Community.LikeReview(r.Context(), a.ID, p.ID, r.PathValue("showtime"), b.On)
		if err != nil {
			fail(w, err)
			return
		}
		if b.On && changed {
			note(p.ID, notify.New{Kind: "like", Title: a.Name + " liked your review", Link: "/u/" + p.ID + "?tab=reviews", Dedupe: "review-like:" + r.PathValue("showtime") + ":" + a.ID})
		}
		writeJSON(w, http.StatusOK, map[string]any{"liked": b.On, "likes": n})
	}))
	mux.HandleFunc("GET /v1/me/people/{id}/badges", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		p, ok := person(w, r, a)
		if !ok {
			return
		}
		list, err := s.Community.Badges(r.Context(), p.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"badges": list})
	}))
	mux.HandleFunc("PUT /v1/me/public-profile", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b community.ProfileChange
		if !decode(w, r, &b) {
			return
		}
		if err := s.Community.EditProfile(r.Context(), a.ID, b); err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))
	mux.HandleFunc("PUT /v1/me/follows/{id}", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		var b struct{ On bool }
		if !decode(w, r, &b) {
			return
		}
		changed, err := s.Community.Follow(r.Context(), a.ID, r.PathValue("id"), b.On)
		if err != nil {
			fail(w, err)
			return
		}
		if b.On && changed {
			note(r.PathValue("id"), notify.New{Kind: "follow", Title: a.Name + " started following you", Link: "/community?author=" + a.ID, Dedupe: "follow:" + a.ID})
		}
		writeJSON(w, http.StatusOK, map[string]bool{"following": b.On})
	}))
	mux.HandleFunc("GET /v1/me/community-side", s.signedIn(func(w http.ResponseWriter, r *http.Request, a accounts.Account, _ string) {
		country := s.Community.CountryOf(r.Context(), a.ID)
		tags, err := s.Community.Trending(r.Context(), country)
		if err != nil {
			fail(w, err)
			return
		}
		if len(tags) == 0 && country != "" {
			country = ""
			if tags, err = s.Community.Trending(r.Context(), ""); err != nil {
				fail(w, err)
				return
			}
		}
		people, err := s.Community.Suggestions(r.Context(), a.ID)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"country": country, "trending": tags, "people": people})
	}))
}
