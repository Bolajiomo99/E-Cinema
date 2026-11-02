package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/db"
	"github.com/Bolajiomo99/E-Cinema/api/internal/httpapi"
	"github.com/Bolajiomo99/E-Cinema/api/internal/tickets"
	"github.com/coder/websocket"
)

func server(t *testing.T) *httptest.Server {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	pool, err := db.Open(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := db.Migrate(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	// A showtime that is always upcoming, so the tests never depend on today's date.
	if _, err := pool.Exec(context.Background(), `INSERT INTO showtimes VALUES ('api-test-show', 'Tide', 'S', now() + interval '1 hour', 90, 10, 500, 'USD')
	  ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at`); err != nil {
		t.Fatal(err)
	}
	s := &httpapi.Server{Tickets: tickets.Store{DB: pool}, AllowedOrigins: []string{"*"}, InternalToken: "test-token"}
	ts := httptest.NewServer(s.Routes())
	t.Cleanup(ts.Close)
	return ts
}

func TestHoldsNeedTheInternalToken(t *testing.T) {
	ts := server(t)
	body := `{"seats":1,"viewerRef":"v"}`
	res, _ := http.Post(ts.URL+"/v1/showtimes/api-test-show/holds", "application/json", strings.NewReader(body))
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token: got %d", res.StatusCode)
	}
	req, _ := http.NewRequest("POST", ts.URL+"/v1/showtimes/api-test-show/holds", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer test-token")
	res, _ = http.DefaultClient.Do(req)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("with token: got %d", res.StatusCode)
	}
	res, _ = http.Get(ts.URL + "/healthz")
	if res.StatusCode != http.StatusOK || res.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("healthz %d", res.StatusCode)
	}
}

func TestSyncReportsPosition(t *testing.T) {
	ts := server(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/v1/sync/api-test-show", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	now := time.Now().UnixMilli()
	conn.Write(ctx, websocket.MessageText, []byte(`{"c":`+jsonInt(now)+`}`))
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var p struct {
		C     int64  `json:"c"`
		S     int64  `json:"s"`
		State string `json:"state"`
	}
	json.Unmarshal(data, &p)
	if p.C != now || p.S < now || p.State == "" {
		t.Fatalf("bad pong %s", data)
	}
}

func jsonInt(n int64) string { b, _ := json.Marshal(n); return string(b) }
