package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// The email outbox (Figma page 08 Emails): the web app collects due emails, sends them through
// Resend and reports each outcome. Internal only.
func (s *Server) mailRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/mail/due", s.internal(func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		list, err := s.Notify.DueMail(r.Context(), limit)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"mail": list})
	}))
	mux.HandleFunc("POST /v1/mail/{id}/done", s.internal(func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		var body struct {
			Error string `json:"error"`
		}
		if err != nil || json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return
		}
		if err := s.Notify.MailDone(r.Context(), id, body.Error); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
}
