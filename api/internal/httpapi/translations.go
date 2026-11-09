package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/Bolajiomo99/E-Cinema/api/internal/translations"
)

// Translation memory for the web app (internal only): look up and store translated site text.
func (s *Server) translationRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/translations/lookup", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Lang   string   `json:"lang"`
			Hashes []string `json:"hashes"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&b) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return
		}
		found, err := s.Translations.Lookup(r.Context(), b.Lang, b.Hashes)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"found": found})
	}))
	mux.HandleFunc("POST /v1/translations", s.internal(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Lang  string              `json:"lang"`
			Items []translations.Item `json:"items"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&b) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return
		}
		n, err := s.Translations.Save(r.Context(), b.Lang, b.Items)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"saved": n})
	}))
}
